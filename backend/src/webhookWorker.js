"ruse strict";

/**
 * webhookWorker.js — delivers webhook payloads with HMAC-SHA256 signing
 * and exponential-backoff retry.
 *
 * The worker is intentionally separate from the HTTP ingestion layer so
 * delivery failures never block incoming requests.
 *
 * Usage:
 *   const worker = require('./webhookWorker');
 *   await worker.dispatch('tokens_claimed', { recipient: '...', amount: 500 });
 */

const crypto = require("crypto");
const { createDeliveryLog, updateDeliveryLog, findRegistrationsByEvent } = require("./webhookStore");

const SUPPORTED_EVENTS = [
  "cliff_reached",
  "tokens_claimed",
  "stream_cancelled",
  "stream_expired",
];

const MAX_ATTEMPTS = 3;
// Base delay in ms; actual delay = BASE_DELAY_MS * 2^(attempt-1)
const BASE_DELAY_MS = 1_000;
const DELIVERY_TIMEOUT_MS = 10_000;
// Events older than this threshold are backfill and must not deliver.
const BACKFILL_THRESHOLD_MS = 24 * 60 * 60 * 1_000;

// Lazily required so the worker can be loaded without node-fetch installed
// in test environments that mock it.
let _fetch;
function getFetch() {
  if (!_fetch) _fetch = (...args) => import("node-fetch").then((m) => m.default(...args));
  return _fetch;
}

/**
 * Compute the HMAC-SHA256 hex signature for a payload string.
 * @param {string} secret
 * @param {string} payload
 * @returns {string}
 */
function computeSignature(secret, payload) {
  return "sha256=" + crypto.createHmac("sha256", secret).update(payload).digest("hex");
}

/**
 * Resolve the HMAC signing secret from the environment.
 * The secret must never be hardcoded.
 */
function getSigningSecret() {
  const secret = process.env.WEBHOOK_HMAC_SECRET;
  if (!secret) {
    throw new Error("WEBHOOK_HMAC_SECRET environment variable is not set");
  }
  return secret;
}

/**
 * Verify an incoming signature against the expected HMAC-SHA256 digest.
 * Uses a timing-safe comparison.
 * @param {string} secret
 * @param {string} payload
 * @param {string} signature - value of the X-Vesting-Signature header
 * @returns {boolean}
 */
function verifySignature(secret, payload, signature) {
  if (typeof signature !== "string" || signature.length === 0) return false;
  const expected = computeSignature(secret, payload);
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/**
 * Attempt a single HTTP delivery.
 * Returns { ok: true } or { ok: false, error: string }.
 */
async function attemptDelivery(url, secret, payloadStr) {
  const signature = computeSignature(secret, payloadStr);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DELIVERY_TIMEOUT_MS);

  try {
    const fetchFn = getFetch();
    const res = await fetchFn(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Vesting-Signature": signature,
        "User-Agent": "VestingWebhook/1.0",
      },
      body: payloadStr,
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (res.ok) return { ok: true };
    return { ok: false, error: `HTTP ${res.status} ${res.statusText}` };
  } catch (err) {
    clearTimeout(timer);
    return { ok: false, error: err.message ?? String(err) };
  }
}

/**
 * Deliver a single webhook registration's payload with retries.
 * Updates the delivery log after each attempt.
 */
async function deliverWithRetry(registration, log, payloadStr) {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS ; attempt++) {
    if (attempt > 1) {
      const delay = BASE_DELAY_MS * Math.pow(2, attempt - 2);
      await new Promise((r) => setTimeout(r, delay));
    }

    const result = await attemptDelivery(registration.url, registration.secret, payloadStr);

    await updateDeliveryLog(log.id, {
      attempts: attempt,
      lastError: result.ok ? null : result.error,
      status: result.ok ? "success" : (attempt < MAX_ATTEMPTS ? "pending" : "failed"),
    });

    if (result.ok) return;
  }
}

/**
 * Dispatch an event to all registered webhooks subscribed to that event.
 * Fire-and-forget: errors are recorded in the delivery log, not thrown.
 *
 * Backfill events (events whose timestamp is more than 24 hours old) are
 * skipped entirely and never trigger webhooks.
 *
 * @param {string} eventType - one of SUPPORTED_EVENTS
 * @param {Object} data      - event-specific payload fields
 * @param {Date|string|number} [options.timestamp] - event timestamp (defaults now)
 */
async function dispatch(eventType, data, options = {}) {
  if (!SUPPORTED_EVENTS.includes(eventType)) {
    throw new Error(`Unknown event type: ${eventType}. Supported: ${SUPPORTED_EVENTS.join(", ")}`);
  }

  const eventTime = options.timestamp != null ? new Date(options.timestamp) : new Date();
  if (Number.isNaN(eventTime.getTime())) {
    throw new Error(`Invalid timestamp: ${options.timestamp}`);
  }

  // Backfill guard: skip events that are more than 24 hours old.
  if (Date.now() - eventTime.getTime() > BACKFILL_THRESHOLD_MS) {
    return;
  }

  const registrations = await findRegistrationsByEvent(eventType);
  if (registrations.length === 0) return;

  const envelope = {
    id: crypto.randomUUID(),
    event: eventType,
    timestamp: eventTime.toISOString(),
    data,
  };
  const payloadStr = JSON.stringify(envelope);

  // Deliver to each registration concurrently (failures are independent)
  await Promise.allSettled(
    registrations.map(async (reg) => {
      const log = await createDeliveryLog({
        webhookId: reg.id,
        event: eventType,
        payload: payloadStr,
      });
      await deliverWithRetry(reg, log, payloadStr);
    }),
  );
}

module.exports = {
  dispatch,
  computeSignature,
  verifySignature,
  getSigningSecret,
  SUPPORTED_EVENTS,
  MAX_ATTEMPTS,
  BASE_DELAY_MS,
  BACKFILL_THRESHOLD_MS,
};
