"use strict";

const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const { createRedisClient } = require("../redisClient");
const { StellarSdk } = require("../lib");

const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRY = process.env.JWT_EXPIRY ?? "1h";
const NONCE_TTL_SECONDS = 300;
const SIGNATURE_WINDOW_MS = Number(process.env.AUTH_SIGNATURE_WINDOW_MS ?? 5 * 60 * 1000);
const NONCE_PREFIX = "auth_nonce:";

function buildAuthPayload(address, nonce, timestamp) {
  return `${address}:${nonce}:${timestamp}`;
}

function unauthorized(res, message = "Unauthorized") {
  res.status(401).json({ error: message });
}

function badRequest(res, message) {
  res.status(400).json({ error: message });
}

function unexpected(res, message) {
  res.status(500).json({ error: message });
}

async function challengeHandler(req, res) {
  const address = String(req.query.address || "").trim();
  if (!address) {
    badRequest(res, "address query parameter is required");
    return;
  }

  if (!/^G[A-Z2-7]{55}$/.test(address)) {
    badRequest(res, "address must be a valid Stellar public key");
    return;
  }

  const redis = await createRedisClient();
  const nonce = crypto.randomUUID();
  const timestamp = Date.now();
  const value = JSON.stringify({ address, timestamp });

  await redis.set(`${NONCE_PREFIX}${nonce}`, value, { EX: NONCE_TTL_SECONDS });

  res.status(200).json({ nonce, expires_in: NONCE_TTL_SECONDS, created_at: timestamp });
}

async function tokenHandler(req, res) {
  if (!JWT_SECRET) {
    unexpected(res, "JWT_SECRET is not configured");
    return;
  }

  const { address, nonce, timestamp, signature } = req.body;
  if (!address || !nonce || !timestamp || !signature) {
    badRequest(res, "address, nonce, timestamp, and signature are required");
    return;
  }

  const createdAt = Number(timestamp);
  if (Number.isNaN(createdAt) || createdAt <= 0) {
    badRequest(res, "timestamp must be a valid number");
    return;
  }

  const ageMs = Date.now() - createdAt;
  if (ageMs > SIGNATURE_WINDOW_MS || ageMs < -30 * 1000) {
    badRequest(res, "timestamp is outside allowed window");
    return;
  }

  const redis = await createRedisClient();
  const key = `${NONCE_PREFIX}${nonce}`;
  const stored = await redis.get(key);
  if (!stored) {
    badRequest(res, "nonce not found or already used");
    return;
  }

  await redis.del(key);

  let payload;
  try {
    payload = JSON.parse(stored);
  } catch {
    badRequest(res, "invalid nonce payload");
    return;
  }

  if (payload.address !== address) {
    badRequest(res, "nonce does not belong to the provided address");
    return;
  }

  const message = buildAuthPayload(address, nonce, timestamp);
  let signatureBytes;
  try {
    signatureBytes = Buffer.from(signature, "base64");
  } catch {
    badRequest(res, "signature must be base64 encoded");
    return;
  }

  try {
    const keypair = StellarSdk.Keypair.fromPublicKey(address);
    const verified = keypair.verify(Buffer.from(message), signatureBytes);
    if (!verified) {
      unauthorized(res, "signature verification failed");
      return;
    }
  } catch (err) {
    badRequest(res, "invalid Stellar address or signature");
    return;
  }

  const token = jwt.sign({ sub: address }, JWT_SECRET, { expiresIn: JWT_EXPIRY });
  res.status(200).json({ token, expires_in: JWT_EXPIRY });
}

function authMiddleware(req, res, next) {
  if (!JWT_SECRET) {
    unexpected(res, "JWT_SECRET is not configured");
    return;
  }

  const header = String(req.headers["authorization"] || "");
  if (!header.startsWith("Bearer ")) {
    unauthorized(res);
    return;
  }

  const token = header.slice(7).trim();
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = { address: String(payload.sub) };
    next();
  } catch (err) {
    unauthorized(res, "invalid or expired token");
  }
}

module.exports = { challengeHandler, tokenHandler, authMiddleware };
