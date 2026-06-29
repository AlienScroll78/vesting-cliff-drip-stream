/**
 * Issue 1: Idempotency keys
 * Middleware that caches responses keyed by (user, idempotency_key) for 24 hours.
 * Only applies to POST/PUT requests that include an Idempotency-Key header.
 */

import type { Request, Response, NextFunction } from "express";

const TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

interface CachedResponse {
  status: number;
  body: unknown;
  expiresAt: number;
}

// In-memory store: "userId:key" → cached response
// Replace with Redis in production for multi-instance deployments.
const cache = new Map<string, CachedResponse>();

/** Extract user identifier from request (Authorization header or fallback). */
function getUserId(req: Request): string | null {
  const auth = req.headers.authorization;
  if (!auth) return null;
  // Accepts "Bearer <token>" — use the token as the user identifier directly.
  // In production, decode and verify the JWT to extract a stable user ID.
  return auth.startsWith("Bearer ") ? auth.slice(7) : auth;
}

export function idempotencyMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  if (req.method !== "POST" && req.method !== "PUT") {
    next();
    return;
  }

  const key = req.headers["idempotency-key"];
  if (!key || typeof key !== "string") {
    next();
    return;
  }

  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authorization required for idempotent requests" });
    return;
  }

  const cacheKey = `${userId}:${key}`;

  // Evict expired entry if present
  const existing = cache.get(cacheKey);
  if (existing) {
    if (Date.now() < existing.expiresAt) {
      res.status(existing.status).json(existing.body);
      return;
    }
    cache.delete(cacheKey);
  }

  // Intercept the response to cache it
  const originalJson = res.json.bind(res);
  res.json = (body: unknown) => {
    if (res.statusCode < 500) {
      cache.set(cacheKey, {
        status: res.statusCode,
        body,
        expiresAt: Date.now() + TTL_MS,
      });
    }
    return originalJson(body);
  };

  next();
}

/** Exposed for testing — clears the in-memory cache. */
export function clearIdempotencyCache(): void {
  cache.clear();
}
