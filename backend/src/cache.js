"use strict";

/**
 * cache.js — Redis-backed cache using ioredis.
 *
 * Cache keys follow the pattern:
 *   vesting:{contractId}:{function}:{recipient}
 *
 * TTLs (configurable via env, with sensible defaults):
 *   claimable_amount  → 3 s   (one ledger)
 *   get_schedule      → 30 s
 *   is_cliff_passed   → 60 s  (changes infrequently)
 *
 * Graceful degradation: if Redis is unavailable, all operations
 * resolve as cache-miss without throwing.
 */

let Redis;
try {
  Redis = require("ioredis");
} catch {
  // ioredis not installed — all operations become no-ops
  Redis = null;
}

// TTLs in seconds
const TTL = {
  claimable_amount: Number(process.env.CACHE_TTL_CLAIMABLE ?? 3),
  get_schedule:     Number(process.env.CACHE_TTL_SCHEDULE  ?? 30),
  is_cliff_passed:  Number(process.env.CACHE_TTL_CLIFF     ?? 60),
};

// Cache-hit / miss counters (in-process; expose via metrics endpoint)
const metrics = { hits: 0, misses: 0 };

let _client = null;
let _connectAttempted = false;

function getClient() {
  if (_client) return _client;
  if (!Redis) return null;
  if (_connectAttempted) return null; // already failed once; don't retry inline

  const url = process.env.REDIS_URL;
  if (!url) return null;

  _connectAttempted = true;

  _client = new Redis(url, {
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    lazyConnect: true,
    connectTimeout: 2000,
  });

  _client.on("error", (err) => {
    // Swallow connection errors so callers degrade gracefully
    if (process.env.NODE_ENV !== "test") {
      process.stderr.write(`[cache] Redis error: ${err.message}\n`);
    }
  });

  return _client;
}

/**
 * Build a cache key.
 * @param {string} contractId
 * @param {'claimable_amount'|'get_schedule'|'is_cliff_passed'} fn
 * @param {string} recipient
 */
function buildKey(contractId, fn, recipient) {
  return `vesting:${contractId}:${fn}:${recipient}`;
}

/**
 * Get a cached value.
 * @returns {Promise<any|null>} parsed value, or null on miss / error
 */
async function get(contractId, fn, recipient) {
  const client = getClient();
  if (!client) {
    metrics.misses++;
    return null;
  }
  try {
    const raw = await client.get(buildKey(contractId, fn, recipient));
    if (raw === null) {
      metrics.misses++;
      return null;
    }
    metrics.hits++;
    return JSON.parse(raw);
  } catch {
    metrics.misses++;
    return null;
  }
}

/**
 * Set a cached value with the appropriate TTL for the function.
 * @param {string} contractId
 * @param {'claimable_amount'|'get_schedule'|'is_cliff_passed'} fn
 * @param {string} recipient
 * @param {any} value
 */
async function set(contractId, fn, recipient, value) {
  const client = getClient();
  if (!client) return;
  const ttl = TTL[fn];
  if (!ttl) return;
  try {
    await client.setex(buildKey(contractId, fn, recipient), ttl, JSON.stringify(value));
  } catch {
    // Graceful degradation — cache write failure is non-fatal
  }
}

/**
 * Invalidate all cached entries for a given recipient (e.g. after claim / cancel).
 */
async function invalidate(contractId, recipient) {
  const client = getClient();
  if (!client) return;
  try {
    const keys = Object.keys(TTL).map((fn) => buildKey(contractId, fn, recipient));
    await client.del(...keys);
  } catch {
    // Non-fatal
  }
}

/**
 * Return a snapshot of hit/miss counts.
 * The ratio is: hitRate = hits / (hits + misses).
 */
function getCacheMetrics() {
  const total = metrics.hits + metrics.misses;
  return {
    hits: metrics.hits,
    misses: metrics.misses,
    total,
    hitRate: total > 0 ? (metrics.hits / total).toFixed(4) : "0.0000",
  };
}

/** Reset counters (used in tests). */
function resetMetrics() {
  metrics.hits = 0;
  metrics.misses = 0;
}

/** Close the Redis connection (used in graceful shutdown / tests). */
async function close() {
  if (_client) {
    await _client.quit().catch(() => {});
    _client = null;
    _connectAttempted = false;
  }
}

module.exports = { get, set, invalidate, getCacheMetrics, resetMetrics, close, TTL };
