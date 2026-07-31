"use strict";

/**
 * routes/webhooks.js
 *
 * POST   /api/v1/webhooks        — register a webhook
 * DELETE /api/v1/webhooks/:id    — remove a webhook registration
 * GET    /api/v1/webhooks/:id/deliveries — list delivery logs
 *
 * Authentication: sponsors identify themselves via their sponsor public key
 * in the X-Sponsor-Id header.  In production this should be replaced with
 * proper JWT / signed-request auth.
 */

const { randomBytes } = require("crypto");
const { validateWebhookUrl } = require("../webhookValidator");
const {
  createRegistration,
  getRegistration,
  deleteRegistration,
  listDeliveryLogs,
} = require("../webhookStore");
const { SUPPORTED_EVENTS } = require("../webhookWorker");

/**
 * Read the full request body as a string.
 */
function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

/**
 * Send a JSON response.
 */
function json(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(payload));
}

/**
 * POST /api/v1/webhooks
 *
 * Body:
 *   {
 *     "url":       "https://example.com/hooks/vesting",
 *     "events":    ["tokens_claimed", "stream_cancelled"],
 *     "secret":    "optional-user-provided-secret"   // generated if omitted
 *   }
 *
 * Response 201:
 *   { "id": "...", "url": "...", "events": [...], "secret": "..." }
 */
async function registerWebhookHandler(req, res) {
  const sponsorId = req.headers["x-sponsor-id"];
  if (!sponsorId) {
    return json(res, 400, { error: "X-Sponsor-Id header is required" });
  }

  let body;
  try {
    body = await readBody(req);
  } catch {
    return json(res, 400, { error: "Failed to read request body" });
  }

  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    return json(res, 400, { error: "Invalid JSON" });
  }

  const { url, events, secret: userSecret } = parsed;

  // Validate URL
  if (typeof url !== "string" || !url) {
    return json(res, 422, { error: "url is required and must be a string" });
  }
  const urlCheck = validateWebhookUrl(url);
  if (!urlCheck.valid) {
    return json(res, 422, { error: urlCheck.reason });
  }

  // Validate events
  if (!Array.isArray(events) || events.length === 0) {
    return json(res, 422, {
      error: `events must be a non-empty array. Supported: ${SUPPORTED_EVENTS.join(", ")}`,
    });
  }
  const unknownEvents = events.filter((e) => !SUPPORTED_EVENTS.includes(e));
  if (unknownEvents.length > 0) {
    return json(res, 422, {
      error: `Unknown event types: ${unknownEvents.join(", ")}. Supported: ${SUPPORTED_EVENTS.join(", ")}`,
    });
  }

  // Use provided secret or generate a 32-byte hex secret
  const secret = typeof userSecret === "string" && userSecret.length > 0
    ? userSecret
    : randomBytes(32).toString("hex");

  const registration = await createRegistration({ sponsorId, url, secret, events });

  return json(res, 201, {
    id: registration.id,
    url: registration.url,
    events: registration.events,
    secret: registration.secret,
    createdAt: registration.createdAt,
  });
}

/**
 * DELETE /api/v1/webhooks/:id
 *
 * Response 204 on success, 404 if not found, 403 if not the owner.
 */
async function deleteWebhookHandler(req, res, id) {
  const sponsorId = req.headers["x-sponsor-id"];
  if (!sponsorId) {
    return json(res, 400, { error: "X-Sponsor-Id header is required" });
  }

  const registration = await getRegistration(id);
  if (!registration) {
    return json(res, 404, { error: "Webhook not found" });
  }
  if (registration.sponsorId !== sponsorId) {
    return json(res, 403, { error: "Forbidden: you do not own this webhook" });
  }

  await deleteRegistration(id);
  res.writeHead(204);
  res.end();
}

/**
 * GET /api/v1/webhooks/:id/deliveries
 *
 * Response 200: array of delivery log entries.
 */
async function listDeliveriesHandler(req, res, id) {
  const sponsorId = req.headers["x-sponsor-id"];
  if (!sponsorId) {
    return json(res, 400, { error: "X-Sponsor-Id header is required" });
  }

  const registration = await getRegistration(id);
  if (!registration) {
    return json(res, 404, { error: "Webhook not found" });
  }
  if (registration.sponsorId !== sponsorId) {
    return json(res, 403, { error: "Forbidden: you do not own this webhook" });
  }

  const logs = await listDeliveryLogs(id);
  return json(res, 200, { deliveries: logs });
}

module.exports = {
  registerWebhookHandler,
  deleteWebhookHandler,
  listDeliveriesHandler,
};
