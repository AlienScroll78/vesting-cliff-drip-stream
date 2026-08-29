/**
 * webhookWorker.js – Issue #552
 *
 * Reliable webhook delivery with:
 *   - Exponential backoff retries (up to 5 attempts: 1s, 2s, 4s, 8s, 16s)
 *   - HMAC-SHA256 signature on every delivery (X-Webhook-Signature header)
 *   - Dead-letter queue (DLQ) persistence after all retries are exhausted
 *   - Structured logging for each attempt / failure
 */

import { createHmac } from "crypto";
import { pool } from "./db.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const MAX_RETRIES = 5;
export const BASE_DELAY_MS = 1_000; // 1 s → 2 s → 4 s → 8 s → 16 s
const DELIVERY_TIMEOUT_MS = 10_000;

// ---------------------------------------------------------------------------
// Internal: sign a payload
// ---------------------------------------------------------------------------

/**
 * Creates an HMAC-SHA256 hex digest of the JSON payload using the shared secret.
 * The signature is included in the `X-Webhook-Signature` request header as
 * `sha256=<hex>` so consumers can verify authenticity.
 *
 * @param {string} secret  Shared webhook secret from config.
 * @param {string} body    JSON-serialised payload string.
 * @returns {string}  `sha256=<hex>`
 */
export function signPayload(secret, body) {
  const hmac = createHmac("sha256", secret);
  hmac.update(body, "utf8");
  return `sha256=${hmac.digest("hex")}`;
}

// ---------------------------------------------------------------------------
// Internal: single HTTP attempt
// ---------------------------------------------------------------------------

/**
 * Performs one HTTP POST to the target URL.
 *
 * @param {string} url      Destination URL.
 * @param {object} payload  Event payload (will be JSON-serialised).
 * @param {string} secret   Webhook HMAC secret.
 * @returns {Promise<void>} Resolves on HTTP 2xx, rejects otherwise.
 */
async function attemptDelivery(url, payload, secret) {
  const body = JSON.stringify(payload);
  const signature = signPayload(secret, body);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), DELIVERY_TIMEOUT_MS);

  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Webhook-Signature": signature,
      },
      body,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status}: ${text}`);
  }
}

// ---------------------------------------------------------------------------
// Internal: persist to DLQ
// ---------------------------------------------------------------------------

/**
 * Writes a permanently-failed delivery to the dead_letter_queue table.
 *
 * @param {string} webhookUrl
 * @param {object} payload
 * @param {string} lastError   Error message from the final attempt.
 */
export async function moveToDlq(webhookUrl, payload, lastError) {
  try {
    await pool.query(
      `INSERT INTO webhook_dead_letter_queue
         (webhook_url, payload, last_error, failed_at, retry_count)
       VALUES ($1, $2, $3, NOW(), $4)`,
      [webhookUrl, JSON.stringify(payload), lastError, MAX_RETRIES]
    );
    console.warn(`[webhookWorker] DLQ: stored failed delivery for ${webhookUrl}`);
  } catch (dbErr) {
    console.error("[webhookWorker] Failed to write to DLQ:", dbErr);
  }
}

// ---------------------------------------------------------------------------
// Public: deliverWebhook
// ---------------------------------------------------------------------------

/**
 * Delivers a webhook payload with exponential-backoff retries.
 * After {@link MAX_RETRIES} failed attempts the item is moved to the DLQ.
 *
 * @param {string} webhookUrl  Destination URL.
 * @param {object} payload     Event payload.
 * @param {string} secret      HMAC secret used to sign the payload.
 * @returns {Promise<{ok: boolean, attempts: number, error?: string}>}
 */
export async function deliverWebhook(webhookUrl, payload, secret) {
  let delay = BASE_DELAY_MS;
  let lastError = "";

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      await attemptDelivery(webhookUrl, payload, secret);
      console.info(
        `[webhookWorker] Delivered ${payload.event ?? "event"} to ${webhookUrl} (attempt ${attempt})`
      );
      return { ok: true, attempts: attempt };
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      console.warn(
        `[webhookWorker] Attempt ${attempt}/${MAX_RETRIES} failed for ${webhookUrl}: ${lastError}`
      );

      if (attempt < MAX_RETRIES) {
        await new Promise((resolve) => setTimeout(resolve, delay));
        delay *= 2;
      }
    }
  }

  // All retries exhausted → DLQ
  await moveToDlq(webhookUrl, payload, lastError);
  return { ok: false, attempts: MAX_RETRIES, error: lastError };
}

// ---------------------------------------------------------------------------
// Public: replayDlqItem
// ---------------------------------------------------------------------------

/**
 * Replays a single DLQ item by id.
 * On success the row is removed from the DLQ.
 * On failure the error and retry timestamp are updated.
 *
 * @param {number|string} dlqId  PK of the DLQ row.
 * @param {string}        secret HMAC secret.
 * @returns {Promise<{ok: boolean, error?: string}>}
 */
export async function replayDlqItem(dlqId, secret) {
  const { rows } = await pool.query(
    "SELECT * FROM webhook_dead_letter_queue WHERE id = $1",
    [dlqId]
  );

  if (!rows.length) {
    throw new Error(`DLQ item ${dlqId} not found`);
  }

  const row = rows[0];
  const payload =
    typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload;

  try {
    await attemptDelivery(row.webhook_url, payload, secret);

    // Success → remove from DLQ
    await pool.query("DELETE FROM webhook_dead_letter_queue WHERE id = $1", [dlqId]);
    console.info(`[webhookWorker] DLQ replay succeeded for id=${dlqId}, removed from queue`);
    return { ok: true };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    await pool.query(
      `UPDATE webhook_dead_letter_queue
          SET last_error = $1, last_retry_at = NOW()
        WHERE id = $2`,
      [error, dlqId]
    );
    console.warn(`[webhookWorker] DLQ replay failed for id=${dlqId}: ${error}`);
    return { ok: false, error };
  }
}
