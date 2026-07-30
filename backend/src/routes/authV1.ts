/**
 * backend/src/routes/authV1.ts  (#288)
 *
 * JWT authentication for sponsor-only API endpoints.
 *
 * Routes:
 *   POST /api/v1/auth/challenge   — issue one-time nonce
 *   POST /api/v1/auth/verify      — verify Stellar signature, return JWT
 *   POST /api/v1/auth/refresh     — refresh a non-expired JWT
 *
 * Design:
 *   - RS256 asymmetric JWT (JWT_PRIVATE_KEY / JWT_PUBLIC_KEY env vars)
 *   - Falls back to HS256 with JWT_SECRET for development convenience
 *   - Challenge nonces stored in Redis with 5-minute TTL (replay protection)
 *   - Auth endpoints rate-limited to 10 req/min per IP (via authRateLimit)
 *   - authMiddlewareV1 exported for use on protected routes
 */

import crypto from "crypto";
import { Router, Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { createClient } from "redis";

// ── Config ────────────────────────────────────────────────────────────────────

const NONCE_TTL_SECONDS = 300; // 5 minutes
const JWT_EXPIRY = process.env.JWT_EXPIRY ?? "1h";
const NONCE_PREFIX = "auth_nonce_v1:";
const AUTH_RATE_WINDOW_SEC = 60;
const AUTH_RATE_MAX = 10;

// ── Redis client (shared lazy singleton) ─────────────────────────────────────

let _redis: ReturnType<typeof createClient> | null = null;

async function getRedis() {
  if (_redis?.isOpen) return _redis;
  const url = process.env.REDIS_URL;
  if (!url) throw new Error("REDIS_URL is required for auth");
  _redis = createClient({ url });
  _redis.on("error", (err) =>
    console.warn("[auth] Redis error:", err.message)
  );
  await _redis.connect();
  return _redis;
}

// ── Key helpers (RS256 preferred, HS256 fallback) ─────────────────────────────

function getSignKey(): string | Buffer {
  const pem = process.env.JWT_PRIVATE_KEY;
  if (pem) return Buffer.from(pem.replace(/\\n/g, "\n"), "utf8");
  const secret = process.env.JWT_SECRET;
  if (secret) return secret;
  throw new Error("JWT_PRIVATE_KEY or JWT_SECRET must be set");
}

function getVerifyKey(): string | Buffer {
  const pem = process.env.JWT_PUBLIC_KEY;
  if (pem) return Buffer.from(pem.replace(/\\n/g, "\n"), "utf8");
  const secret = process.env.JWT_SECRET;
  if (secret) return secret;
  throw new Error("JWT_PUBLIC_KEY or JWT_SECRET must be set");
}

function getAlgorithm(): jwt.Algorithm {
  return process.env.JWT_PRIVATE_KEY ? "RS256" : "HS256";
}

// ── Stellar signature verification ────────────────────────────────────────────

/**
 * Verify a Stellar Ed25519 keypair signature.
 *
 * The message signed by the wallet is:
 *   `${address}:${nonce}:${timestamp}`
 *
 * Signature must be base64-encoded. We rely on Node.js built-in crypto for
 * Ed25519 verification — the public key is the raw 32-byte key extracted
 * from the Stellar G... address (base32 encoded with version byte stripped).
 *
 * Note: A production implementation should use stellar-sdk's
 *   Keypair.fromPublicKey(address).verify(message, signature)
 * When stellar-sdk is available at runtime.
 */
function buildMessage(address: string, nonce: string, timestamp: string): Buffer {
  return Buffer.from(`${address}:${nonce}:${timestamp}`, "utf8");
}

function verifyEd25519Signature(
  address: string,
  message: Buffer,
  signatureBase64: string
): boolean {
  try {
    // Decode the Stellar G... address to raw public key bytes
    // Stellar uses a custom base32 encoding with a version byte (0x06 << 3 = 0x30)
    // and a 2-byte CRC16 checksum appended.
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
    const chars = address.split("");

    let bits = 0;
    let value = 0;
    const bytes: number[] = [];

    for (const char of chars) {
      const idx = alphabet.indexOf(char);
      if (idx === -1) throw new Error("Invalid Stellar address character");
      value = (value << 5) | idx;
      bits += 5;
      if (bits >= 8) {
        bytes.push((value >>> (bits - 8)) & 0xff);
        bits -= 8;
      }
    }

    // Stellar address: [version(1)] + [pubkey(32)] + [checksum(2)] = 35 bytes decoded
    if (bytes.length < 35) throw new Error("Address too short");
    const rawPubKey = Buffer.from(bytes.slice(1, 33)); // 32-byte Ed25519 key

    const signature = Buffer.from(signatureBase64, "base64");

    // Node.js crypto.verify with Ed25519
    const keyObject = crypto.createPublicKey({
      key: rawPubKey,
      format: "der",
      type: "spki",
    });

    return crypto.verify(null, message, keyObject, signature);
  } catch {
    // Fallback: if the above fails (e.g. when stellar-sdk is present),
    // the caller can inject a verifier. Return false to force rejection.
    return false;
  }
}

// ── Rate limit helper (per-IP sliding window using Redis INCR) ────────────────

async function checkAuthRateLimit(
  ip: string
): Promise<{ allowed: boolean; retryAfter: number }> {
  try {
    const redis = await getRedis();
    const key = `rl:auth:${ip}`;
    const count = await redis.incr(key);
    if (count === 1) await redis.expire(key, AUTH_RATE_WINDOW_SEC);
    const ttl = await redis.ttl(key);
    return {
      allowed: count <= AUTH_RATE_MAX,
      retryAfter: ttl > 0 ? ttl : AUTH_RATE_WINDOW_SEC,
    };
  } catch {
    // Fail open when Redis unavailable
    return { allowed: true, retryAfter: 0 };
  }
}

// ── Route handlers ────────────────────────────────────────────────────────────

/**
 * POST /api/v1/auth/challenge
 *
 * Body: { address: string }
 * Returns: { nonce, expires_in, created_at }
 */
async function challengeHandlerV1(req: Request, res: Response): Promise<void> {
  const ip = extractIp(req);
  const { allowed, retryAfter } = await checkAuthRateLimit(ip);
  if (!allowed) {
    res.status(429).json({ error: "Too Many Requests", retry_after: retryAfter });
    return;
  }

  const address = String(req.body?.address ?? "").trim();
  if (!address) {
    res.status(400).json({ error: "address is required" });
    return;
  }
  if (!/^G[A-Z2-7]{55}$/.test(address)) {
    res.status(400).json({ error: "address must be a valid Stellar public key (G...)" });
    return;
  }

  try {
    const redis = await getRedis();
    const nonce = crypto.randomUUID();
    const createdAt = Date.now();
    const value = JSON.stringify({ address, createdAt });

    await redis.set(`${NONCE_PREFIX}${nonce}`, value, { EX: NONCE_TTL_SECONDS });

    res.status(200).json({
      nonce,
      expires_in: NONCE_TTL_SECONDS,
      created_at: createdAt,
      message_to_sign: `${address}:${nonce}:${createdAt}`,
    });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to create challenge" });
  }
}

/**
 * POST /api/v1/auth/verify
 *
 * Body: { address, nonce, timestamp, signature }
 * Returns: { token, expires_in }
 */
async function verifyHandlerV1(req: Request, res: Response): Promise<void> {
  const ip = extractIp(req);
  const { allowed, retryAfter } = await checkAuthRateLimit(ip);
  if (!allowed) {
    res.status(429).json({ error: "Too Many Requests", retry_after: retryAfter });
    return;
  }

  const { address, nonce, timestamp, signature } = req.body ?? {};
  if (!address || !nonce || !timestamp || !signature) {
    res.status(400).json({
      error: "address, nonce, timestamp, and signature are required",
    });
    return;
  }

  if (!/^G[A-Z2-7]{55}$/.test(address)) {
    res.status(400).json({ error: "Invalid Stellar address" });
    return;
  }

  const ts = Number(timestamp);
  if (Number.isNaN(ts) || ts <= 0) {
    res.status(400).json({ error: "timestamp must be a positive number" });
    return;
  }

  // Reject stale signatures (outside ±5-minute window)
  const ageMs = Date.now() - ts;
  if (ageMs > NONCE_TTL_SECONDS * 1000 || ageMs < -30_000) {
    res.status(400).json({ error: "timestamp is outside allowed window" });
    return;
  }

  try {
    const redis = await getRedis();
    const storedRaw = await redis.get(`${NONCE_PREFIX}${nonce}`);
    if (!storedRaw) {
      res.status(400).json({ error: "nonce not found or already used" });
      return;
    }

    // Consume nonce immediately (replay protection)
    await redis.del(`${NONCE_PREFIX}${nonce}`);

    let stored: { address: string; createdAt: number };
    try {
      stored = JSON.parse(storedRaw);
    } catch {
      res.status(400).json({ error: "Invalid nonce payload" });
      return;
    }

    if (stored.address !== address) {
      res.status(400).json({ error: "nonce does not belong to this address" });
      return;
    }

    const message = buildMessage(address, nonce, String(timestamp));
    const sigBuffer = Buffer.from(signature, "base64");
    const valid = verifyEd25519Signature(address, message, sigBuffer.toString("base64"));

    if (!valid) {
      res.status(401).json({ error: "signature verification failed" });
      return;
    }

    const signKey = getSignKey();
    const algo = getAlgorithm();
    const token = jwt.sign({ sub: address, wallet: address }, signKey, {
      expiresIn: JWT_EXPIRY,
      algorithm: algo,
      issuer: "vesting-drips",
      audience: "vesting-api",
    });

    res.status(200).json({
      token,
      expires_in: JWT_EXPIRY,
      wallet_address: address,
    });
  } catch (err: any) {
    console.error("[auth] verify error:", err?.message);
    res.status(500).json({ error: "Internal server error" });
  }
}

/**
 * POST /api/v1/auth/refresh
 *
 * Refreshes a valid, non-expired JWT. Accepts the current token in the
 * Authorization header and returns a new one with a fresh expiry.
 */
async function refreshHandlerV1(req: Request, res: Response): Promise<void> {
  const header = req.headers["authorization"] ?? "";
  if (!header.startsWith("Bearer ")) {
    res.status(401).json({ error: "Bearer token required" });
    return;
  }

  const token = header.slice(7).trim();
  try {
    const verifyKey = getVerifyKey();
    const algo = getAlgorithm();
    const payload = jwt.verify(token, verifyKey, {
      algorithms: [algo],
      issuer: "vesting-drips",
      audience: "vesting-api",
    }) as jwt.JwtPayload;

    const address = String(payload.sub ?? "");
    const signKey = getSignKey();
    const newToken = jwt.sign({ sub: address, wallet: address }, signKey, {
      expiresIn: JWT_EXPIRY,
      algorithm: algo,
      issuer: "vesting-drips",
      audience: "vesting-api",
    });

    res.status(200).json({
      token: newToken,
      expires_in: JWT_EXPIRY,
      wallet_address: address,
    });
  } catch (err: any) {
    res.status(401).json({ error: "invalid or expired token" });
  }
}

// ── Auth middleware ───────────────────────────────────────────────────────────

/**
 * Express middleware that validates the JWT and sets req.user.
 * Returns 401 if the token is missing, invalid, or expired.
 *
 * Usage:
 *   import { authMiddlewareV1 } from "./routes/authV1.js";
 *   router.get("/protected", authMiddlewareV1, handler);
 */
export function authMiddlewareV1(
  req: Request & { user?: { address: string } },
  res: Response,
  next: NextFunction
): void {
  const header = req.headers["authorization"] ?? "";
  if (!header.startsWith("Bearer ")) {
    res.status(401).json({ error: "Authorization header with Bearer token required" });
    return;
  }

  const token = header.slice(7).trim();
  try {
    const verifyKey = getVerifyKey();
    const algo = getAlgorithm();
    const payload = jwt.verify(token, verifyKey, {
      algorithms: [algo],
      issuer: "vesting-drips",
      audience: "vesting-api",
    }) as jwt.JwtPayload;

    req.user = { address: String(payload.sub ?? "") };
    next();
  } catch (err: any) {
    res.status(401).json({ error: "invalid or expired token" });
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function extractIp(req: Request): string {
  return (
    (req.headers["x-forwarded-for"] as string | undefined)
      ?.split(",")[0]
      .trim() ??
    req.socket?.remoteAddress ??
    "unknown"
  );
}

// ── Router ────────────────────────────────────────────────────────────────────

const authRouterV1 = Router();

authRouterV1.post("/challenge", challengeHandlerV1);
authRouterV1.post("/verify", verifyHandlerV1);
authRouterV1.post("/refresh", refreshHandlerV1);

export { authRouterV1 };
