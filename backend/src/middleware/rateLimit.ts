/**
 * Issue #32: Sliding-window rate limiting middleware.
 *
 * Limits are checked in order:
 *   1. Bypass whitelist (RATE_LIMIT_BYPASS_IPS / RATE_LIMIT_BYPASS_KEYS) → skip
 *   2. API key (X-Api-Key header) → 1000 req/min (configurable)
 *   3. IP → 100 req/min (configurable)
 *
 * When Redis is unavailable the middleware fails open (passes the request).
 *
 * Environment variables:
 *   REDIS_URL                   Redis connection URL (default: redis://localhost:6379)
 *   RATE_LIMIT_IP_MAX           Max requests per IP per window (default: 100)
 *   RATE_LIMIT_KEY_MAX          Max requests per API key per window (default: 1000)
 *   RATE_LIMIT_WINDOW_SEC       Window size in seconds (default: 60)
 *   RATE_LIMIT_BYPASS_IPS       Comma-separated IPs to bypass (default: "")
 *   RATE_LIMIT_BYPASS_KEYS      Comma-separated API keys to bypass (default: "")
 */

import type { Request, Response, NextFunction } from "express";
import { createClient } from "redis";

// ---------------------------------------------------------------------------
// Redis client (lazy connect, fail-open)
// ---------------------------------------------------------------------------

let redis: ReturnType<typeof createClient> | null = null;

async function getRedis(): Promise<ReturnType<typeof createClient> | null> {
  if (redis) return redis;
  try {
    redis = createClient({ url: process.env.REDIS_URL ?? "redis://localhost:6379" });
    redis.on("error", () => { /* fail-open: errors are non-fatal */ });
    await redis.connect();
    return redis;
  } catch {
    redis = null;
    return null;
  }
}

// ---------------------------------------------------------------------------
// Sliding-window counter using Redis INCR + EXPIRE
// ---------------------------------------------------------------------------

async function isAllowed(
  client: ReturnType<typeof createClient>,
  key: string,
  max: number,
  windowSec: number
): Promise<{ allowed: boolean; remaining: number; resetAfter: number }> {
  const redisKey = `rl:${key}`;
  const count = await client.incr(redisKey);
  if (count === 1) await client.expire(redisKey, windowSec);
  const ttl = await client.ttl(redisKey);
  const remaining = Math.max(0, max - count);
  return { allowed: count <= max, remaining, resetAfter: ttl > 0 ? ttl : windowSec };
}

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

export async function rateLimitMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  // Read config dynamically so tests can override env vars
  const windowSec = parseInt(process.env.RATE_LIMIT_WINDOW_SEC ?? "60", 10);
  const ipMax = parseInt(process.env.RATE_LIMIT_IP_MAX ?? "100", 10);
  const keyMax = parseInt(process.env.RATE_LIMIT_KEY_MAX ?? "1000", 10);
  const bypassIps = new Set(
    (process.env.RATE_LIMIT_BYPASS_IPS ?? "").split(",").filter(Boolean)
  );
  const bypassKeys = new Set(
    (process.env.RATE_LIMIT_BYPASS_KEYS ?? "").split(",").filter(Boolean)
  );

  const apiKey = req.headers["x-api-key"] as string | undefined;
  const ip =
    (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0].trim() ??
    req.socket.remoteAddress ??
    "unknown";

  // Bypass whitelist
  if (bypassIps.has(ip) || (apiKey && bypassKeys.has(apiKey))) {
    next();
    return;
  }

  const client = await getRedis();
  if (!client) {
    // Fail-open when Redis is unavailable
    next();
    return;
  }

  // Prefer API key limit over IP limit when a key is present
  const { identifier, max } = apiKey
    ? { identifier: `key:${apiKey}`, max: keyMax }
    : { identifier: `ip:${ip}`, max: ipMax };

  const { allowed, remaining, resetAfter } = await isAllowed(client, identifier, max, windowSec);

  res.setHeader("X-RateLimit-Limit", max);
  res.setHeader("X-RateLimit-Remaining", remaining);
  res.setHeader("X-RateLimit-Reset", resetAfter);

  if (!allowed) {
    res.setHeader("Retry-After", resetAfter);
    res.status(429).json({
      error: "Too Many Requests",
      retryAfter: resetAfter,
    });
    return;
  }

  next();
}
