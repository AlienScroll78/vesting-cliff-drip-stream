/**
 * Authentication routes — closes #742
 *
 * POST /api/auth/challenge  → issue a nonce for a Stellar address
 * POST /api/auth/token      → verify Stellar wallet signature → RS256 JWT
 * POST /api/auth/refresh    → exchange a refresh token for a new access token
 * GET  /.well-known/jwks.json → public keys for RS256 verification
 *
 * JWT payload: { sub: address, role: 'admin'|'user', iat, exp, kid }
 * Access token TTL:  24 h  (AUTH_ACCESS_TOKEN_TTL_H env, default 24)
 * Refresh token TTL: 30 d  (AUTH_REFRESH_TOKEN_TTL_DAYS env, default 30)
 */

"use strict";

import crypto from "crypto";
import jwt from "jsonwebtoken";
import type { Request, Response } from "express";
import { getCurrentKey, getPublicKeyByKid, initKeyStore } from "../auth/keyStore.js";
import { createRedisClient } from "../redisClient.js";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const NONCE_TTL_SECONDS = 300;          // 5 min challenge window
const SIGNATURE_WINDOW_MS = 5 * 60 * 1000;
const NONCE_PREFIX = "auth_nonce:";
const REFRESH_PREFIX = "auth_refresh:";

const ACCESS_TTL_H = parseInt(process.env.AUTH_ACCESS_TOKEN_TTL_H ?? "24", 10);
const REFRESH_TTL_DAYS = parseInt(process.env.AUTH_REFRESH_TOKEN_TTL_DAYS ?? "30", 10);
const ACCESS_TTL_S = ACCESS_TTL_H * 3600;
const REFRESH_TTL_S = REFRESH_TTL_DAYS * 86400;

/**
 * Comma-separated list of Stellar addresses that are admin users.
 * Example env: ADMIN_ADDRESSES=GABC...,GDEF...
 */
const ADMIN_ADDRESSES = new Set(
  (process.env.ADMIN_ADDRESSES ?? "").split(",").map((s) => s.trim()).filter(Boolean)
);

// Initialise key store on module load
initKeyStore();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function unauthorized(res: Response, message = "Unauthorized"): void {
  res.status(401).json({ error: message });
}

function badRequest(res: Response, message: string): void {
  res.status(400).json({ error: message });
}

function unexpected(res: Response, message: string): void {
  res.status(500).json({ error: message });
}

/**
 * Determine the role for a given Stellar address.
 * Addresses in ADMIN_ADDRESSES env var receive the 'admin' role.
 */
function roleFor(address: string): "admin" | "user" {
  return ADMIN_ADDRESSES.has(address) ? "admin" : "user";
}

/**
 * Sign an RS256 JWT access token.
 */
function signAccessToken(address: string, role: "admin" | "user"): string {
  const key = getCurrentKey();
  return jwt.sign(
    { sub: address, role, kid: key.kid },
    key.privateKey.export({ type: "pkcs8", format: "pem" }) as string,
    {
      algorithm: "RS256",
      expiresIn: ACCESS_TTL_S,
      header: { alg: "RS256", kid: key.kid },
    }
  );
}

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------

/**
 * POST /api/auth/challenge
 * Body: { address: "G..." }
 * Returns a nonce that the wallet must sign.
 */
export async function challengeHandler(req: Request, res: Response): Promise<void> {
  const address = String(req.body?.address || "").trim();
  if (!address) {
    badRequest(res, "address is required");
    return;
  }

  if (!/^G[A-Z2-7]{55}$/.test(address)) {
    badRequest(res, "address must be a valid Stellar public key (G...)");
    return;
  }

  let redis: Awaited<ReturnType<typeof createRedisClient>>;
  try {
    redis = await createRedisClient();
  } catch (err) {
    unexpected(res, "cache unavailable");
    return;
  }

  const nonce = crypto.randomUUID();
  const timestamp = Date.now();
  const value = JSON.stringify({ address, timestamp });

  await redis.set(`${NONCE_PREFIX}${nonce}`, value, { EX: NONCE_TTL_SECONDS });

  res.status(200).json({
    nonce,
    expires_in: NONCE_TTL_SECONDS,
    created_at: timestamp,
    message: `${address}:${nonce}:${timestamp}`,
  });
}

/**
 * POST /api/auth/token
 * Body: { address, nonce, timestamp, signature }
 *   signature: base64-encoded Ed25519 signature of "${address}:${nonce}:${timestamp}"
 *
 * Returns:
 *   { access_token, refresh_token, token_type, expires_in, role }
 */
export async function tokenHandler(req: Request, res: Response): Promise<void> {
  const { address, nonce, timestamp, signature } = req.body ?? {};

  if (!address || !nonce || !timestamp || !signature) {
    badRequest(res, "address, nonce, timestamp, and signature are required");
    return;
  }

  const createdAt = Number(timestamp);
  if (Number.isNaN(createdAt) || createdAt <= 0) {
    badRequest(res, "timestamp must be a valid positive number");
    return;
  }

  const ageMs = Date.now() - createdAt;
  if (ageMs > SIGNATURE_WINDOW_MS || ageMs < -30_000) {
    badRequest(res, "timestamp is outside the allowed window (±5 min)");
    return;
  }

  let redis: Awaited<ReturnType<typeof createRedisClient>>;
  try {
    redis = await createRedisClient();
  } catch {
    unexpected(res, "cache unavailable");
    return;
  }

  // One-time nonce consumption (replay prevention)
  const key = `${NONCE_PREFIX}${nonce}`;
  const stored = await redis.get(key);
  if (!stored) {
    badRequest(res, "nonce not found or already used");
    return;
  }
  await redis.del(key);

  let storedPayload: { address: string; timestamp: number };
  try {
    storedPayload = JSON.parse(stored);
  } catch {
    badRequest(res, "invalid nonce payload");
    return;
  }

  if (storedPayload.address !== address) {
    badRequest(res, "nonce does not belong to the provided address");
    return;
  }

  // Verify Stellar Ed25519 signature
  const message = `${address}:${nonce}:${timestamp}`;
  let signatureBytes: Buffer;
  try {
    signatureBytes = Buffer.from(signature, "base64");
  } catch {
    badRequest(res, "signature must be base64-encoded");
    return;
  }

  try {
    // Import as StellarSdk lazily to avoid pulling in the full SDK if not needed
    // Stellar Keypair.verify wraps the raw Ed25519 verify
    const { StellarSdk } = await import("../lib.js");
    const keypair = StellarSdk.Keypair.fromPublicKey(address);
    const verified = keypair.verify(Buffer.from(message), signatureBytes);
    if (!verified) {
      unauthorized(res, "signature verification failed");
      return;
    }
  } catch {
    badRequest(res, "invalid Stellar address or malformed signature");
    return;
  }

  const role = roleFor(address);
  const accessToken = signAccessToken(address, role);

  // Generate opaque refresh token and store in Redis
  const refreshToken = crypto.randomBytes(40).toString("hex");
  await redis.set(
    `${REFRESH_PREFIX}${refreshToken}`,
    JSON.stringify({ address, role }),
    { EX: REFRESH_TTL_S }
  );

  res.status(200).json({
    access_token: accessToken,
    refresh_token: refreshToken,
    token_type: "Bearer",
    expires_in: ACCESS_TTL_S,
    role,
  });
}

/**
 * POST /api/auth/refresh
 * Body: { refresh_token }
 * Returns a new access token. The refresh token is NOT rotated (use REFRESH_TTL to limit window).
 */
export async function refreshHandler(req: Request, res: Response): Promise<void> {
  const { refresh_token } = req.body ?? {};
  if (!refresh_token) {
    badRequest(res, "refresh_token is required");
    return;
  }

  let redis: Awaited<ReturnType<typeof createRedisClient>>;
  try {
    redis = await createRedisClient();
  } catch {
    unexpected(res, "cache unavailable");
    return;
  }

  const stored = await redis.get(`${REFRESH_PREFIX}${refresh_token}`);
  if (!stored) {
    unauthorized(res, "refresh token not found or expired");
    return;
  }

  let payload: { address: string; role: "admin" | "user" };
  try {
    payload = JSON.parse(stored);
  } catch {
    unexpected(res, "invalid refresh token data");
    return;
  }

  const accessToken = signAccessToken(payload.address, payload.role);

  res.status(200).json({
    access_token: accessToken,
    token_type: "Bearer",
    expires_in: ACCESS_TTL_S,
    role: payload.role,
  });
}

/**
 * GET /.well-known/jwks.json
 * Returns the current (and previously rotated) public keys.
 */
export async function jwksHandler(_req: Request, res: Response): Promise<void> {
  const { getJwks } = await import("../auth/keyStore.js");
  res.status(200).json({ keys: getJwks() });
}

/**
 * Express middleware: verify RS256 JWT and attach req.user.
 * Does NOT enforce role — use requireRole() for that.
 */
export function authMiddleware(
  req: Request & { user?: { address: string; role: string } },
  res: Response,
  next: Parameters<typeof unauthorized>[0] & { (): void }
): void {
  const header = String(req.headers["authorization"] || "");
  if (!header.startsWith("Bearer ")) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const token = header.slice(7).trim();

  // Decode header to get kid before verifying
  let decoded: jwt.JwtHeader | null = null;
  try {
    const parts = token.split(".");
    if (parts.length !== 3) throw new Error("malformed");
    decoded = JSON.parse(Buffer.from(parts[0], "base64url").toString()) as jwt.JwtHeader;
  } catch {
    res.status(401).json({ error: "malformed token" });
    return;
  }

  const kid = (decoded as Record<string, string>).kid;
  const pubKey = kid
    ? getPublicKeyByKid(kid)
    : getCurrentKey().publicKey;

  if (!pubKey) {
    res.status(401).json({ error: "unknown key id" });
    return;
  }

  const pubPem = pubKey.export({ type: "spki", format: "pem" }) as string;

  try {
    const payload = jwt.verify(token, pubPem, { algorithms: ["RS256"] }) as jwt.JwtPayload;
    (req as Request & { user: { address: string; role: string } }).user = {
      address: String(payload.sub),
      role: String(payload.role ?? "user"),
    };
    next();
  } catch {
    res.status(401).json({ error: "invalid or expired token" });
  }
}

/**
 * Middleware factory: require a specific role.
 * Must be used after authMiddleware.
 *
 * Usage: router.post('/admin/xyz', authMiddleware, requireRole('admin'), handler)
 */
export function requireRole(role: "admin" | "user") {
  return function roleGuard(
    req: Request & { user?: { address: string; role: string } },
    res: Response,
    next: () => void
  ): void {
    if (!req.user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    if (req.user.role !== role) {
      res.status(403).json({ error: "Forbidden: insufficient role" });
      return;
    }
    next();
  };
}
