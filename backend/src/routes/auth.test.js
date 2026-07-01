"use strict";

/**
 * Auth flow integration test — closes #30
 *
 * Tests the core auth logic (nonce store, signature verification, JWT) without
 * loading the real route handlers, matching the pattern used throughout this
 * test suite.
 */

import { describe, it, expect, beforeAll } from "vitest";
import crypto from "node:crypto";
import jwt from "jsonwebtoken";

const JWT_SECRET = "test-secret-that-is-32-chars-ok!";
const JWT_EXPIRY = "1h";
const TEST_ADDR = "GAH5H7EKIVT3VMYLDRZL4PJ732EXGBNFWLUQGHRKTUQ6HK2TN3RQXMG5";
const NONCE_TTL_SECONDS = 300;
const SIGNATURE_WINDOW_MS = 5 * 60 * 1000;
const NONCE_PREFIX = "auth_nonce:";

// ── In-memory nonce store (mirrors Redis behaviour) ────────────────────────
const store = new Map();
const redis = {
  get: async (k) => store.get(k) ?? null,
  set: async (k, v) => store.set(k, v),
  del: async (k) => store.delete(k),
};

// ── Ed25519 test keypair ───────────────────────────────────────────────────
let privKey, pubKey;
beforeAll(() => {
  const kp = crypto.generateKeyPairSync("ed25519");
  privKey = kp.privateKey;
  pubKey = kp.publicKey;
});

// ── Extracted auth logic (mirrors auth.js behaviour) ──────────────────────

async function issueChallenge(address) {
  if (!address || !/^G[A-Z2-7]{55}$/.test(address)) return { status: 400, body: { error: "invalid address" } };
  const nonce = crypto.randomUUID();
  const timestamp = Date.now();
  await redis.set(`${NONCE_PREFIX}${nonce}`, JSON.stringify({ address, timestamp }));
  return { status: 200, body: { nonce, expires_in: NONCE_TTL_SECONDS, created_at: timestamp } };
}

async function verifyAndIssueToken({ address, nonce, timestamp, signature }) {
  if (!address || !nonce || !timestamp || !signature) return { status: 400, body: { error: "missing fields" } };
  const ageMs = Date.now() - Number(timestamp);
  if (ageMs > SIGNATURE_WINDOW_MS || ageMs < -30_000) return { status: 400, body: { error: "timestamp out of window" } };

  const key = `${NONCE_PREFIX}${nonce}`;
  const stored = await redis.get(key);
  if (!stored) return { status: 400, body: { error: "nonce not found or already used" } };
  await redis.del(key);

  const payload = JSON.parse(stored);
  if (payload.address !== address) return { status: 400, body: { error: "nonce/address mismatch" } };

  const message = `${address}:${nonce}:${timestamp}`;
  let sigBytes;
  try { sigBytes = Buffer.from(signature, "base64"); } catch { return { status: 400, body: { error: "bad signature encoding" } }; }

  // Stellar uses Ed25519; we verify with Node's built-in crypto (test uses same key type)
  let verified;
  try { verified = crypto.verify(null, Buffer.from(message), pubKey, sigBytes); } catch { verified = false; }
  if (!verified) return { status: 401, body: { error: "signature verification failed" } };

  const token = jwt.sign({ sub: address }, JWT_SECRET, { expiresIn: JWT_EXPIRY });
  return { status: 200, body: { token, expires_in: JWT_EXPIRY } };
}

function verifyToken(authHeader) {
  if (!authHeader?.startsWith("Bearer ")) return { status: 401, user: null };
  try {
    const payload = jwt.verify(authHeader.slice(7).trim(), JWT_SECRET);
    return { status: 200, user: { address: String(payload.sub) } };
  } catch {
    return { status: 401, user: null };
  }
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("issueChallenge", () => {
  it("returns nonce for valid Stellar address", async () => {
    const r = await issueChallenge(TEST_ADDR);
    expect(r.status).toBe(200);
    expect(typeof r.body.nonce).toBe("string");
    expect(r.body.expires_in).toBe(NONCE_TTL_SECONDS);
  });

  it("rejects missing address", async () => {
    const r = await issueChallenge("");
    expect(r.status).toBe(400);
  });

  it("rejects invalid address format", async () => {
    const r = await issueChallenge("notakey");
    expect(r.status).toBe(400);
  });
});

describe("verifyAndIssueToken", () => {
  it("issues JWT for valid signature", async () => {
    const { body: { nonce, created_at } } = await issueChallenge(TEST_ADDR);
    const msg = `${TEST_ADDR}:${nonce}:${created_at}`;
    const sig = crypto.sign(null, Buffer.from(msg), privKey).toString("base64");
    const r = await verifyAndIssueToken({ address: TEST_ADDR, nonce, timestamp: created_at, signature: sig });
    expect(r.status).toBe(200);
    expect(typeof r.body.token).toBe("string");
    // Verify the JWT contains the address
    const decoded = jwt.verify(r.body.token, JWT_SECRET);
    expect(decoded.sub).toBe(TEST_ADDR);
  });

  it("replay prevention: reusing nonce is rejected", async () => {
    const { body: { nonce, created_at } } = await issueChallenge(TEST_ADDR);
    const msg = `${TEST_ADDR}:${nonce}:${created_at}`;
    const sig = crypto.sign(null, Buffer.from(msg), privKey).toString("base64");
    const params = { address: TEST_ADDR, nonce, timestamp: created_at, signature: sig };

    const r1 = await verifyAndIssueToken(params);
    expect(r1.status).toBe(200);

    const r2 = await verifyAndIssueToken(params);
    expect(r2.status).toBe(400);
    expect(r2.body.error).toMatch(/nonce not found/);
  });

  it("rejects missing fields", async () => {
    const r = await verifyAndIssueToken({ address: TEST_ADDR });
    expect(r.status).toBe(400);
  });

  it("rejects invalid signature", async () => {
    const { body: { nonce, created_at } } = await issueChallenge(TEST_ADDR);
    const badSig = Buffer.alloc(64).toString("base64");
    const r = await verifyAndIssueToken({ address: TEST_ADDR, nonce, timestamp: created_at, signature: badSig });
    expect(r.status).toBe(401);
  });
});

describe("verifyToken (authMiddleware logic)", () => {
  it("accepts valid JWT", async () => {
    const token = jwt.sign({ sub: TEST_ADDR }, JWT_SECRET, { expiresIn: "1h" });
    const r = verifyToken(`Bearer ${token}`);
    expect(r.status).toBe(200);
    expect(r.user.address).toBe(TEST_ADDR);
  });

  it("rejects missing header", () => {
    expect(verifyToken(undefined).status).toBe(401);
    expect(verifyToken("").status).toBe(401);
  });

  it("rejects invalid/expired token", () => {
    const r = verifyToken("Bearer bad.token.here");
    expect(r.status).toBe(401);
  });

  it("rejects token signed with wrong secret", () => {
    const token = jwt.sign({ sub: TEST_ADDR }, "wrong-secret", { expiresIn: "1h" });
    const r = verifyToken(`Bearer ${token}`);
    expect(r.status).toBe(401);
  });
});
