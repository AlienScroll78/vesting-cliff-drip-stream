/**
 * Redis-backed cache for view-function responses (Issue #29).
 *
 * Cache key format : `view:<recipient>:<fn>`
 * Default TTL      : CACHE_TTL_MS (default 5 000 ms ≈ one ledger close)
 *
 * When REDIS_URL is absent the module falls back to a plain in-process
 * Map so the server starts without Redis in development / CI.
 *
 * Every cacheGet/cacheSet call is wrapped in an OTel span via withCacheSpan
 * so that cache hit/miss rates are visible in distributed traces.
 */

import { createRequire } from "module";

const require = createRequire(import.meta.url);

const CACHE_TTL_MS = parseInt(process.env.CACHE_TTL_MS ?? "5000", 10);

/** @type {any | null} */
let _redis = null;

function getRedis() {
  if (_redis) return _redis;
  const url = process.env.REDIS_URL;
  if (!url) return null;
  try {
    const Redis = require("ioredis");
    _redis = new Redis(url, { lazyConnect: false, enableReadyCheck: false });
    _redis.on("error", (err) => {
      console.warn("[cache] Redis error:", err.message);
    });
    return _redis;
  } catch {
    return null;
  }
}

// ── In-process fallback ───────────────────────────────────────────────────────

/** @type {Map<string, { value: string; expiresAt: number }>} */
const _local = new Map();

/** @type {{ hits: number; misses: number }} */
const _stats = { hits: 0, misses: 0 };

function localGet(key) {
  const entry = _local.get(key);
  if (!entry) { _stats.misses++; return null; }
  if (Date.now() > entry.expiresAt) {
    _local.delete(key);
    _stats.misses++;
    return null;
  }
  _stats.hits++;
  return entry.value;
}

function localSet(key, value, ttlMs) {
  _local.set(key, { value, expiresAt: Date.now() + ttlMs });
}

function localDel(pattern) {
  for (const key of _local.keys()) {
    if (key.startsWith(pattern)) _local.delete(key);
  }
}

// ── Metrics counters ──────────────────────────────────────────────────────────

let _hits = 0;
let _misses = 0;

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Build a cache key for a view response scoped to a recipient and function.
 * @param {string} recipient
 * @param {string} fn  - view function name (e.g. "get_schedule")
 */
export function viewKey(recipient, ledger) {
  return `view:${recipient}:${ledger}`;
}

/**
 * Retrieve a cached view response.
 * Records a cache.get span with a cache.hit=true/false attribute.
 * @param {string} key
 * @returns {Promise<string | null>}
 */
export async function cacheGet(key) {
  const redis = getRedis();
  let value = null;
  if (redis) {
    try {
      const val = await redis.get(key);
      if (val !== null) { _stats.hits++; return val; }
      _stats.misses++;
    } catch {
      value = localGet(key);
    }
    return localGet(key);
  });
}

/**
 * Store a view response.
 * Records a cache.set span.
 * @param {string} key
 * @param {string} value   JSON-serialised payload
 * @param {number} [ttlMs] TTL in milliseconds (defaults to CACHE_TTL_MS)
 */
export async function cacheSet(key, value) {
  const redis = getRedis();
  if (redis) {
    try {
      await redis.set(key, value, "PX", ttlMs);
      return;
    } catch {
      // fall through to local
    }
    localSet(key, value);
  });
}

/**
 * Invalidate all cached entries for a recipient (called on claim / cancel /
 * any state-changing stream event).
 * @param {string} recipient
 */
export async function cacheInvalidate(recipient) {
  const prefix = `view:${recipient}:`;
  const redis = getRedis();
  if (redis) {
    try {
      let cursor = "0";
      do {
        const [next, keys] = await redis.scan(cursor, "MATCH", `${prefix}*`, "COUNT", 100);
        cursor = next;
        if (keys.length) await redis.del(...keys);
      } while (cursor !== "0");
      return;
    } catch {
      // fall through to local
    }
  }
  localDel(prefix);
}

/**
 * Return current cache statistics (hits, misses, total, hitRate).
 * Used by the /api/v1/metrics legacy JSON endpoint.
 */
export function getCacheMetrics() {
  const total = _stats.hits + _stats.misses;
  return {
    hits: _stats.hits,
    misses: _stats.misses,
    total,
    hitRate: total === 0 ? 0 : _stats.hits / total,
  };
}
