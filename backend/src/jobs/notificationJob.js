"use strict";

const cron = require("node-cron");
const sgMail = require("@sendgrid/mail");
const { pool } = require("../db");
const { createRedisClient } = require("../redisClient");
const { StellarSdk, loadConfig } = require("../lib");

const NOTIFICATION_LEAD_TIME = Number(process.env.NOTIFICATION_LEAD_TIME ?? 100);
const MAX_RETRIES = 3;
const WEBHOOK_RETRY_BASE_MS = 1000;
const NOTIFICATION_CRON = process.env.NOTIFICATION_CRON ?? "*/5 * * * *";
const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY;

if (SENDGRID_API_KEY) {
  sgMail.setApiKey(SENDGRID_API_KEY);
}

async function fetchUpcomingNotifications(currentLedger) {
  const client = await pool.connect();
  try {
    const low = currentLedger;
    const high = currentLedger + NOTIFICATION_LEAD_TIME;
    const sql = `
      SELECT id, sponsor, recipient, token, rate_per_ledger, cliff_ledger, end_ledger,
             email, webhook_url, notify_email, notify_webhook, notify_opt_out
      FROM streams
      WHERE notify_opt_out = false
        AND (
          cliff_ledger BETWEEN $1 AND $2
          OR end_ledger BETWEEN $1 AND $2
        )
      ORDER BY cliff_ledger, end_ledger
    `;
    const { rows } = await client.query(sql, [low, high]);
    return rows;
  } finally {
    client.release();
  }
}

function buildNotificationPayload(stream, eventType) {
  return {
    event: eventType,
    stream: {
      id: stream.id,
      sponsor: stream.sponsor,
      recipient: stream.recipient,
      token: stream.token,
      rate_per_ledger: stream.rate_per_ledger,
      cliff_ledger: stream.cliff_ledger,
      end_ledger: stream.end_ledger,
    },
  };
}

async function sendWebhook(url, payload) {
  let attempt = 0;
  let delay = WEBHOOK_RETRY_BASE_MS;

  while (attempt < MAX_RETRIES) {
    attempt += 1;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (res.ok) return;
      const text = await res.text();
      throw new Error(`Webhook failed ${res.status}: ${text}`);
    } catch (err) {
      if (attempt >= MAX_RETRIES) {
        throw err;
      }
      await new Promise((resolve) => setTimeout(resolve, delay));
      delay *= 2;
    }
  }
}

async function sendEmail(to, subject, text) {
  if (!SENDGRID_API_KEY) {
    throw new Error("SENDGRID_API_KEY not configured");
  }
  await sgMail.send({ to, from: process.env.SENDGRID_FROM_EMAIL, subject, text });
}

async function dispatchNotification(stream, currentLedger) {
  const cliffDistance = stream.cliff_ledger > currentLedger ? stream.cliff_ledger - currentLedger : Number.POSITIVE_INFINITY;
  const endDistance = stream.end_ledger > currentLedger ? stream.end_ledger - currentLedger : Number.POSITIVE_INFINITY;
  const event = cliffDistance <= endDistance ? "cliff_reached" : "stream_completed";
  const eventLedger = event === "cliff_reached" ? stream.cliff_ledger : stream.end_ledger;
  const webhookPayload = buildNotificationPayload(stream, event);
  const emailText = `Your stream ${stream.id} is ${event.replace("_", " ")} at ledger ${eventLedger}.`;

  if (stream.notify_webhook && stream.webhook_url) {
    await sendWebhook(stream.webhook_url, webhookPayload);
  }

  if (stream.notify_email && stream.email) {
    await sendEmail(stream.email, `Stream Notification: ${event}`, emailText);
  }
}

async function processNotifications() {
  const redis = await createRedisClient();
  const lockKey = "notification_job_lock";
  const gotLock = await redis.set(lockKey, "1", { NX: true, EX: 240 });
  if (!gotLock) {
    return;
  }

  try {
    const config = loadConfig();
    config.SOROBAN_RPC_URL = process.env.SOROBAN_RPC_URL;
    if (!config.SOROBAN_RPC_URL) {
      throw new Error("SOROBAN_RPC_URL is required for notification job");
    }

    const server = new StellarSdk.SorobanRpc.Server(config.SOROBAN_RPC_URL);
    const latest = await server.getLatestLedger();
    const currentLedger = latest.sequence;
    const streams = await fetchUpcomingNotifications(currentLedger);
    for (const stream of streams) {
      try {
        await dispatchNotification(stream, currentLedger);
      } catch (err) {
        console.error("[notification] Failed to dispatch notification for stream", stream.id, err);
      }
    }
  } finally {
    await redis.del(lockKey);
  }
}

function scheduleNotificationJob() {
  cron.schedule(NOTIFICATION_CRON, () => {
    processNotifications().catch((err) => console.error("[notification] Job failed:", err));
  });
  console.log(`[notification] Scheduled job with cron '${NOTIFICATION_CRON}'`);
}

module.exports = { scheduleNotificationJob, processNotifications };
