/**
 * webhookValidator.js – Issue #552
 *
 * HMAC-SHA256 signature validation for incoming webhook callbacks.
 *
 * The webhook sender (our backend) signs every request body with the shared
 * WEBHOOK_SECRET and attaches the signature as:
 *
 *   X-Webhook-Signature: sha256=<hex>
 *
 * Consumers validate the incoming request by calling `validateWebhookSignature`.
 * This module also exposes an Express middleware factory `webhookSignatureMiddleware`
 * that can be applied to inbound webhook routes.
 */

import { createHmac, timingSafeEqual } from "crypto";

// ---------------------------------------------------------------------------
// Core validation helper
// ---------------------------------------------------------------------------

/**
 * Validates an HMAC-SHA256 webhook signature.
 *
 * @param {string}      secret         Shared webhook secret.
 * @param {string}      rawBody        Raw request body string (must be the exact
 *                                     bytes that were signed – do NOT parse first).
 * @param {string|undefined} signature Value of the `X-Webhook-Signature` header.
 * @returns {boolean}  `true` if the signature is valid.
 */
export function validateWebhookSignature(secret, rawBody, signature) {
  if (!signature || !secret || !rawBody) return false;

  // Accept "sha256=<hex>" prefix or bare hex
  const hex = signature.startsWith("sha256=") ? signature.slice(7) : signature;

  const hmac = createHmac("sha256", secret);
  hmac.update(rawBody, "utf8");
  const expected = hmac.digest("hex");

  try {
    // Use timing-safe comparison to prevent timing attacks
    return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(hex, "hex"));
  } catch {
    // Buffers were different lengths – invalid signature
    return false;
  }
}

// ---------------------------------------------------------------------------
// Express middleware factory
// ---------------------------------------------------------------------------

/**
 * Creates an Express middleware that validates the `X-Webhook-Signature` header
 * against the raw request body.
 *
 * Usage:
 *   router.post(
 *     "/webhooks/incoming",
 *     express.raw({ type: "application/json" }),  // must use raw body parser
 *     webhookSignatureMiddleware(process.env.WEBHOOK_SECRET),
 *     handler
 *   );
 *
 * @param {string} secret  Shared webhook secret.
 * @returns {import("express").RequestHandler}
 */
export function webhookSignatureMiddleware(secret) {
  return (req, res, next) => {
    const signature = req.headers["x-webhook-signature"];

    // req.body must be a Buffer when using express.raw()
    const rawBody =
      Buffer.isBuffer(req.body)
        ? req.body.toString("utf8")
        : typeof req.body === "string"
          ? req.body
          : JSON.stringify(req.body);

    if (!validateWebhookSignature(secret, rawBody, signature)) {
      res.status(401).json({ error: "Invalid webhook signature" });
      return;
    }

    next();
  };
}
