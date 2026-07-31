"use strict";

/**
 * webhookStore.js — in-process storage for webhook registrations and
 * delivery logs.  In production replace this with a real database (Postgres,
 * SQLite, etc.).  The interface is deliberately async so swapping the
 * backing store requires no changes to callers.
 */

const { randomUUID } = require("crypto");

// Map<id, WebhookRegistration>
const registrations = new Map();

// Map<deliveryId, DeliveryLog>
const deliveryLogs = new Map();

/**
 * @typedef {Object} WebhookRegistration
 * @property {string}   id         - UUID
 * @property {string}   sponsorId  - sponsor public key / identifier
 * @property {string}   url        - delivery endpoint
 * @property {string}   secret     - HMAC signing secret
 * @property {string[]} events     - subscribed event types
 * @property {string}   createdAt  - ISO timestamp
 */

/**
 * @typedef {Object} DeliveryLog
 * @property {string}      id           - UUID
 * @property {string}      webhookId    - parent registration id
 * @property {string}      event        - event type
 * @property {string}      payload      - JSON string sent
 * @property {string}      status       - 'pending' | 'success' | 'failed'
 * @property {number}      attempts     - number of attempts made
 * @property {string|null} lastError    - last error message, if any
 * @property {string}      createdAt    - ISO timestamp
 * @property {string}      updatedAt    - ISO timestamp
 */

async function createRegistration({ sponsorId, url, secret, events }) {
  const id = randomUUID();
  const now = new Date().toISOString();
  const reg = { id, sponsorId, url, secret, events, createdAt: now };
  registrations.set(id, reg);
  return reg;
}

async function getRegistration(id) {
  return registrations.get(id) ?? null;
}

async function deleteRegistration(id) {
  return registrations.delete(id);
}

async function findRegistrationsByEvent(eventType) {
  const results = [];
  for (const reg of registrations.values()) {
    if (reg.events.includes(eventType) || reg.events.includes("*")) {
      results.push(reg);
    }
  }
  return results;
}

async function createDeliveryLog({ webhookId, event, payload }) {
  const id = randomUUID();
  const now = new Date().toISOString();
  const log = {
    id,
    webhookId,
    event,
    payload,
    status: "pending",
    attempts: 0,
    lastError: null,
    createdAt: now,
    updatedAt: now,
  };
  deliveryLogs.set(id, log);
  return log;
}

async function updateDeliveryLog(id, updates) {
  const log = deliveryLogs.get(id);
  if (!log) return null;
  const updated = { ...log, ...updates, updatedAt: new Date().toISOString() };
  deliveryLogs.set(id, updated);
  return updated;
}

async function getDeliveryLog(id) {
  return deliveryLogs.get(id) ?? null;
}

async function listDeliveryLogs(webhookId) {
  const results = [];
  for (const log of deliveryLogs.values()) {
    if (log.webhookId === webhookId) results.push(log);
  }
  return results.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

module.exports = {
  createRegistration,
  getRegistration,
  deleteRegistration,
  findRegistrationsByEvent,
  createDeliveryLog,
  updateDeliveryLog,
  getDeliveryLog,
  listDeliveryLogs,
};
