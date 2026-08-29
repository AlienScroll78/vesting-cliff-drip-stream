/**
 * Redis-backed cache for view-function responses (Issue #29).
 *
 * Cache key format : `view:<recipient>:<fn>`
 * Default TTL      : CACHE_TTL_MS (default 5 000 ms ≈ one ledger close)
 *
 * When REDIS_URL is absent the module falls back to a plain in-process
 * Map so the server starts without Redis in development / CI.
 *
 * Per-function TTLs are passed explicitly to cacheSet() so each view
 * can choose an appropriate staleness window:
 *   get_schedule      : 60 000 ms
 *   claimable_amount  :  5 000 ms
 *   is_cliff_passed   : cliff-ledger-aware (caller computes)
 *   get_min_deposit   : 300 000 ms
 */

import { createRequire } from "module";
const _require = createRequire(import.meta.url);

const DEFAULT_TTL_MS = parseInt(process.env.CACHE_TTL_MS ?? "5000", 10);

/** @type {any} */
let _redis = null;

function getRedis() {
  if (_redis) return _redis;
  const url = process.env.REDIS_URL;
  if (!url) return null;
  // Lazy-require so the module loads even when ioredis is not installed.
  const Redis = _require("ioredis");
  _redis = new Redis(url, { lazyConnect: false, enableReadyCheck: false });
  _redis.on("error", (err) => {
    console.warn("[cache] Redis error:", err.message);
  });
  return _redis;
}

// ── In-process fallback ───────────────────────────────────────────────────────

/** @type {Map<string, { value: string; expiresAt: number }>} */
const _local = new Map();

function localGet(key) {
  const entry = _local.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    _local.delete(key);
    return null;
  }
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
export function viewKey(recipient, fn) {
  return `view:${recipient}:${fn}`;
}

/**
 * Retrieve a cached view response.
 * Increments hit/miss counters.
 * @param {string} key
 * @returns {Promise<string | null>}
 */
export async function cacheGet(key) {
  const redis = getRedis();
  let value = null;
  if (redis) {
    try {
      value = await redis.get(key);
    } catch {
      value = localGet(key);
    }
  } else {
    value = localGet(key);
  }

  if (value !== null) {
    _hits++;
  } else {
    _misses++;
  }
  return value;
}

/**
 * Store a view response with an explicit TTL.
 * @param {string} key
 * @param {string} value   JSON-serialised payload
 * @param {number} [ttlMs] TTL in milliseconds (defaults to CACHE_TTL_MS)
 */
export async function cacheSet(key, value, ttlMs = DEFAULT_TTL_MS) {
  const redis = getRedis();
  if (redis) {
    try {
      await redis.set(key, value, "PX", ttlMs);
      return;
    } catch {
      // fall through to local
    }
  }
  localSet(key, value, ttlMs);
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
      // SCAN + DEL to avoid blocking KEYS on large keyspaces.
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
 * Return accumulated hit/miss counters for the metrics endpoint.
 * @returns {{ hits: number; misses: number; total: number; hitRate: number }}
 */
export function getCacheMetrics() {
  const total = _hits + _misses;
  return {
    hits: _hits,
    misses: _misses,
    total,
    hitRate: total === 0 ? 0 : _hits / total,
  };
}

/**
 * Reset counters (used in tests).
 */
export function resetCacheMetrics() {
  _hits = 0;
  _misses = 0;
}
