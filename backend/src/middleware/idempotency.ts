/**
 * Issue #569: Request deduplication idempotency middleware using Redis.
 *
 * Deduplicates POST and DELETE requests by (Idempotency-Key header, caller IP).
 * Cached responses are served with X-Idempotent-Replay: true for 24 hours.
 *
 * Redis key format: `idempotency:{idempotency-key}:{caller_ip}`
 *
 * Falls back to an in-memory Map when Redis is unavailable (e.g. in tests).
 */

import type { Request, Response, NextFunction } from "express";
import { createRedisClient } from "../redisClient.js";

const TTL_SECONDS = 24 * 60 * 60; // 24 hours
const TTL_MS = TTL_SECONDS * 1000;

interface CachedResponse {
  status: number;
  body: unknown;
  expiresAt: number;
}

// In-memory fallback used when Redis is unavailable.
const memoryCache = new Map<string, CachedResponse>();

// Lazily resolved Redis client — null means unavailable / not yet attempted.
let redisClient: Awaited<ReturnType<typeof createRedisClient>> | null = null;
let redisUnavailable = false;

async function getRedis(): Promise<typeof redisClient> {
  if (redisUnavailable) return null;
  if (redisClient !== null) return redisClient;
  try {
    redisClient = await createRedisClient();
    return redisClient;
  } catch {
    redisUnavailable = true;
    return null;
  }
}

/** Derive the caller IP from the request. */
function getCallerIp(req: Request): string {
  return req.ip ?? (req.socket?.remoteAddress) ?? "unknown";
}

/** Build the Redis / memory-cache key. */
function buildCacheKey(idempotencyKey: string, callerIp: string): string {
  return `idempotency:${idempotencyKey}:${callerIp}`;
}

export function idempotencyMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  // Only deduplicate mutation methods.
  if (req.method !== "POST" && req.method !== "DELETE") {
    next();
    return;
  }

  const idempotencyKey = req.headers["idempotency-key"];
  if (!idempotencyKey || typeof idempotencyKey !== "string") {
    next();
    return;
  }

  const callerIp = getCallerIp(req);
  const cacheKey = buildCacheKey(idempotencyKey, callerIp);

  // Run async logic but keep the Express middleware synchronous at the surface.
  void (async () => {
    const redis = await getRedis();

    if (redis !== null) {
      // ── Redis path ────────────────────────────────────────────────────────
      try {
        const raw = await redis.get(cacheKey);
        if (raw !== null) {
          // Cache hit — replay cached response.
          const cached: CachedResponse = JSON.parse(raw) as CachedResponse;
          res.set("X-Idempotent-Replay", "true");
          res.status(cached.status).json(cached.body);
          return;
        }

        // Cache miss — intercept the outgoing response to store it.
        const originalJson = res.json.bind(res);
        res.json = (body: unknown) => {
          if (res.statusCode < 500) {
            const payload: CachedResponse = {
              status: res.statusCode,
              body,
              expiresAt: Date.now() + TTL_MS,
            };
            // Fire-and-forget; errors are non-fatal.
            void redis
              .set(cacheKey, JSON.stringify(payload), { EX: TTL_SECONDS })
              .catch((err: unknown) => {
                console.error("[idempotency] Redis set error:", err);
              });
          }
          return originalJson(body);
        };

        next();
      } catch (err) {
        // Redis error during get — fall through rather than blocking the request.
        console.error("[idempotency] Redis get error, falling through:", err);
        next();
      }
    } else {
      // ── In-memory fallback path ───────────────────────────────────────────
      const existing = memoryCache.get(cacheKey);
      if (existing) {
        if (Date.now() < existing.expiresAt) {
          res.set("X-Idempotent-Replay", "true");
          res.status(existing.status).json(existing.body);
          return;
        }
        memoryCache.delete(cacheKey);
      }

      const originalJson = res.json.bind(res);
      res.json = (body: unknown) => {
        if (res.statusCode < 500) {
          memoryCache.set(cacheKey, {
            status: res.statusCode,
            body,
            expiresAt: Date.now() + TTL_MS,
          });
        }
        return originalJson(body);
      };

      next();
    }
  })();
}

/**
 * Clears all cached entries.
 * - In tests (Redis unavailable): clears the in-memory fallback Map.
 * - In production: optionally flushes the Redis namespace (no-op by default
 *   to avoid accidentally wiping unrelated keys; call explicitly when needed).
 */
export function clearIdempotencyCache(): void {
  memoryCache.clear();
  // Also reset the Redis availability flag so tests that mock Redis
  // can reconfigure the client between test suites.
  redisClient = null;
  redisUnavailable = false;
}
