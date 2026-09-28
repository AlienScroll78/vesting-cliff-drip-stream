/**
 * Admin API — Bearer token authentication middleware.
 *
 * Reads the expected key from the ADMIN_API_KEY environment variable.
 * Every request to an admin route must include:
 *
 *   Authorization: Bearer <ADMIN_API_KEY>
 *
 * Responds with 401 when the header is absent and 403 when the token
 * does not match.  The check is performed with a constant-time comparison
 * to mitigate timing-based side-channel leaks.
 */

import type { Request, Response, NextFunction } from "express";
import { timingSafeEqual } from "crypto";

/**
 * Express middleware that enforces Bearer token authentication.
 *
 * Mount this on any router that should be admin-only:
 *
 *   import { requireAdminAuth } from "./auth.js";
 *   router.use(requireAdminAuth);
 */
export function requireAdminAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const apiKey = process.env.ADMIN_API_KEY ?? "";

  if (!apiKey) {
    // Fail-closed: if the key is not configured the endpoint is unreachable.
    res.status(503).json({ error: "Admin API is not configured" });
    return;
  }

  const authHeader = req.headers["authorization"] ?? "";

  if (!authHeader.startsWith("Bearer ")) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const providedToken = authHeader.slice("Bearer ".length);

  // Use constant-time comparison to prevent timing attacks.
  let isValid = false;
  try {
    const expected = Buffer.from(apiKey, "utf8");
    const provided = Buffer.from(providedToken, "utf8");
    // Buffers must be the same length for timingSafeEqual; pre-check length
    // separately (this leaks length, which is acceptable for a static key).
    if (expected.length === provided.length) {
      isValid = timingSafeEqual(expected, provided);
    }
  } catch {
    isValid = false;
  }

  if (!isValid) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  next();
}
