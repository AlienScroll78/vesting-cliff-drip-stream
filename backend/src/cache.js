"use strict";

/**
 * Redis-backed cache for view-function responses (Issue #29).
 *
 * Cache key format : `view:<recipient>:<ledger>`
 * TTL              : CACHE_TTL_MS (default 5 000 ms ≈ one ledger close)
 *
 * When REDIS_URL is absent the module falls back to a plain in-process
 * Map so the server starts without Redis in development / CI.
 *
 * Every cacheGet/cacheSet call is wrapped in an OTel span via withCacheSpan
 * so that cache hit/miss rates are visible in distributed traces.
 */

// Lazily import withCacheSpan from tracing.ts so that cache.js can be loaded
// independently of whether the SDK has started (e.g. in unit tests).
let _withCacheSpan = null;
function getWithCacheSpan() {
  if (_withCacheSpan !== null) return _withCacheSpan;
  try {
    // tracing.ts is a TS/ESM module; in tests the helper may be mocked.
    // We use a dynamic require fallback so JS files can consume it too.
    const mod = require("./tracing");
    _withCacheSpan = mod.withCacheSpan ?? null;
  } catch {
    _withCacheSpan = undefined;
  }
  return _withCacheSpan;
}

/**
 * Small shim so we don't need to guard every call site.
 * Falls back to a pass-through when withCacheSpan is unavailable.
 */
async function tracedCacheOp(operation, key, fn) {
  const span = getWithCacheSpan();
  if (typeof span === "function") {
    return span(operation, key, fn);
  }
  return fn();
}

const CACHE_TTL_MS = parseInt(process.env.CACHE_TTL_MS ?? "5000", 10);

/** @type {import("ioredis").Redis | null} */
let _redis = null;

function getRedis() {
  if (_redis) return _redis;
  const url = process.env.REDIS_URL;
  if (!url) return null;
  // Lazy-require so the module loads even when ioredis is not installed.
  const Redis = require("ioredis");
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

function localSet(key, value) {
  _local.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
}

function localDel(pattern) {
  for (const key of _local.keys()) {
    if (key.startsWith(pattern)) _local.delete(key);
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Build a cache key for a view response scoped to one ledger.
 * @param {string} recipient
 * @param {number} ledger
 */
function viewKey(recipient, ledger) {
  return `view:${recipient}:${ledger}`;
}

/**
 * Retrieve a cached view response.
 * Records a cache.get span with a cache.hit=true/false attribute.
 * @param {string} key
 * @returns {Promise<string | null>}
 */
async function cacheGet(key) {
  return tracedCacheOp("get", key, async () => {
    const redis = getRedis();
    if (redis) {
      try {
        return await redis.get(key);
      } catch {
        // fall through to local
      }
    }
    return localGet(key);
  });
}

/**
 * Store a view response.
 * Records a cache.set span.
 * @param {string} key
 * @param {string} value  JSON-serialised payload
 */
async function cacheSet(key, value) {
  return tracedCacheOp("set", key, async () => {
    const redis = getRedis();
    if (redis) {
      try {
        await redis.set(key, value, "PX", CACHE_TTL_MS);
        return;
      } catch {
        // fall through to local
      }
    }
    localSet(key, value);
  });
}

/**
 * Invalidate all cached entries for a recipient (called on claim / cancel).
 * @param {string} recipient
 */
async function cacheInvalidate(recipient) {
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

module.exports = { viewKey, cacheGet, cacheSet, cacheInvalidate };
