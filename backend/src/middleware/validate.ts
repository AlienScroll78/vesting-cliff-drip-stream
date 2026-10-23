/**
 * Issue #752 — Centralized request validation middleware
 *
 * Validates path params, query strings, request headers, and request bodies
 * against Zod schemas. Returns structured 400 responses with field-level
 * error details on failure.
 *
 * Usage:
 *
 *   import { validate } from "../middleware/validate.js";
 *   import { RecipientParamsSchema } from "../validation.js";
 *
 *   router.get(
 *     "/streams/:recipient",
 *     validate({ params: RecipientParamsSchema }),
 *     handler,
 *   );
 *
 * On failure the middleware responds with:
 *
 *   HTTP 400
 *   {
 *     "error": "validation_failed",
 *     "fields": [
 *       { "field": "recipient", "message": "must be a valid Stellar address" }
 *     ]
 *   }
 *
 * On success the parsed & coerced values are written back into
 * req.params / req.query / req.body so downstream handlers receive clean data.
 *
 * Debug logging:
 *   Validation failures are logged at DEBUG level with a SHA-256 hash of the
 *   request body (never the raw body) and the path, so they are traceable
 *   without leaking sensitive payload data.
 */

import type { Request, Response, NextFunction } from "express";
import { ZodSchema, ZodError } from "zod";
import crypto from "crypto";

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

export interface FieldError {
  field: string;
  message: string;
}

export interface ValidationErrorResponse {
  error: "validation_failed";
  fields: FieldError[];
}

// ── Logger ────────────────────────────────────────────────────────────────────

/**
 * Log validation failures at DEBUG level.
 * Uses the LOG_LEVEL env var to gate output — no pino required.
 */
function debugLog(
  path: string,
  method: string,
  fields: FieldError[],
  bodyHash: string,
): void {
  const level = (process.env.LOG_LEVEL ?? "info").toLowerCase();
  if (level !== "debug" && level !== "trace") return;

  process.stderr.write(
    JSON.stringify({
      level: "debug",
      time: new Date().toISOString(),
      msg: "validation_failed",
      path,
      method,
      body_sha256: bodyHash,
      field_count: fields.length,
      fields: fields.map((f) => f.field),
    }) + "\n",
  );
}

/**
 * Compute a SHA-256 hash of the request body for debug logging.
 * Returns "empty" when there is no body.
 */
function hashBody(body: unknown): string {
  if (body === undefined || body === null) return "empty";
  try {
    const raw =
      typeof body === "string" ? body : JSON.stringify(body);
    return crypto.createHash("sha256").update(raw, "utf8").digest("hex");
  } catch {
    return "unknown";
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Flatten a ZodError into an array of { field, message } objects.
 * Nested paths are joined with "." (e.g. "address.street").
 */
export function flattenZodError(error: ZodError): FieldError[] {
  return error.errors.map((issue) => ({
    field: issue.path.length > 0 ? issue.path.join(".") : "_root",
    message: issue.message,
  }));
}

// ── Middleware factory ────────────────────────────────────────────────────────

/**
 * Returns an Express middleware that validates the specified request targets
 * against Zod schemas. Invalid requests are rejected with a structured 400
 * containing field-level error details.
 *
 * Validation failures are logged at DEBUG level with a hash of the request
 * body to aid debugging without exposing sensitive data.
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
      // Log at DEBUG level with body hash (never raw body)
      debugLog(
        req.path,
        req.method,
        fieldErrors,
        hashBody(req.body),
      );

      const responseBody: ValidationErrorResponse = {
        error: "validation_failed",
        fields: fieldErrors,
      };

      res.status(400).json(responseBody);
      return;
    }

    next();
  };
}
