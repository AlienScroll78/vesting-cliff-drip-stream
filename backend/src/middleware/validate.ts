/**
 * Zod-based validation middleware for Express.
 *
 * Usage:
 *
 *   import { validate } from "../middleware/validate.js";
 *   import { RecipientParamsSchema } from "../validation.js";
 *
 *   router.get(
 *     "/schedules/:recipient",
 *     validate({ params: RecipientParamsSchema }),
 *     handler,
 *   );
 *
 * On failure the middleware responds with:
 *
 *   HTTP 400
 *   {
 *     "error": "Validation failed",
 *     "fields": [
 *       { "field": "recipient", "message": "Must be a valid Stellar public key ..." },
 *       ...
 *     ]
 *   }
 *
 * On success the parsed & coerced values are written back into
 * req.params / req.query / req.body so downstream handlers receive clean data.
 */

import type { Request, Response, NextFunction } from "express";
import { ZodSchema, ZodError } from "zod";

// ── Types ─────────────────────────────────────────────────────────────────────

interface ValidationTargets {
  /** Validate req.params against this schema */
  params?: ZodSchema<any>;
  /** Validate req.query against this schema */
  query?: ZodSchema<any>;
  /** Validate req.body against this schema */
  body?: ZodSchema<any>;
  /** Validate req.headers against this schema */
  headers?: ZodSchema<any>;
}

interface FieldError {
  field: string;
  message: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Flatten a ZodError into an array of { field, message } objects.
 * Nested paths are joined with "." (e.g. "address.street").
 */
function flattenZodError(error: ZodError): FieldError[] {
  return error.errors.map((issue) => ({
    field: issue.path.length > 0 ? issue.path.join(".") : "_root",
    message: issue.message,
  }));
}

// ── Middleware factory ────────────────────────────────────────────────────────

/**
 * Returns an Express middleware that validates the specified request targets
 * against Zod schemas.  Invalid requests are rejected with a structured 400.
 */
export function validate(targets: ValidationTargets) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const fieldErrors: FieldError[] = [];

    // Validate params
    if (targets.params) {
      const result = targets.params.safeParse(req.params);
      if (!result.success) {
        fieldErrors.push(...flattenZodError(result.error));
      } else {
        req.params = result.data;
      }
    }

    // Validate query
    if (targets.query) {
      const result = targets.query.safeParse(req.query);
      if (!result.success) {
        fieldErrors.push(...flattenZodError(result.error));
      } else {
        // Express query objects are read-only by type, but we can safely cast here
        (req as any).query = result.data;
      }
    }

    // Validate body
    if (targets.body) {
      const result = targets.body.safeParse(req.body);
      if (!result.success) {
        fieldErrors.push(...flattenZodError(result.error));
      } else {
        req.body = result.data;
      }
    }

    // Validate headers (lowercased by Node/Express)
    if (targets.headers) {
      const result = targets.headers.safeParse(req.headers);
      if (!result.success) {
        fieldErrors.push(...flattenZodError(result.error));
      }
    }

    if (fieldErrors.length > 0) {
      res.status(400).json({
        error: "Validation failed",
        fields: fieldErrors,
      });
      return;
    }

    next();
  };
}
