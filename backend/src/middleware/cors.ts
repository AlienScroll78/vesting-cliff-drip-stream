import { type Request, type Response, type NextFunction } from 'express';

/**
 * Parses the CORS_ALLOWED_ORIGINS environment variable into a Set of allowed origins.
 * Falls back to an empty set (block all cross-origin requests) if the variable is unset.
 */
function buildAllowlist(): Set<string> {
  const raw = process.env.CORS_ALLOWED_ORIGINS ?? '';
  if (!raw.trim()) {
    return new Set();
  }
  return new Set(
    raw
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean),
  );
}

const ALLOWED_METHODS = 'GET, POST, OPTIONS';
const ALLOWED_HEADERS = 'Content-Type, Authorization, X-Correlation-ID';
const MAX_AGE = '3600';

/**
 * Custom CORS middleware with origin whitelist enforcement.
 *
 * Behaviour:
 * - No Origin header → pass through (same-origin or non-browser request).
 * - Origin present and whitelisted → add CORS headers and continue.
 *   For OPTIONS preflight: respond 204 and end the request.
 * - Origin present but NOT whitelisted → respond 403 Forbidden immediately.
 *
 * Unlike the `cors` npm package, this middleware actively rejects unlisted
 * origins with a 403 rather than silently omitting the CORS headers.
 */
export function corsMiddleware(req: Request, res: Response, next: NextFunction): void {
  const origin = req.headers.origin as string | undefined;

  // No Origin header — not a cross-origin browser request; let it through.
  if (!origin) {
    next();
    return;
  }

  const allowlist = buildAllowlist();

  if (!allowlist.has(origin)) {
    res.status(403).json({ error: 'Forbidden: origin not allowed' });
    return;
  }

  // Origin is whitelisted — set CORS response headers.
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', ALLOWED_METHODS);
  res.setHeader('Access-Control-Allow-Headers', ALLOWED_HEADERS);
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Max-Age', MAX_AGE);
  // Vary so caches don't serve one origin's response to another.
  res.setHeader('Vary', 'Origin');

  // OPTIONS preflight — respond immediately with 204 No Content.
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  next();
}
