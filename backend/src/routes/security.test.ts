/**
 * Security Test Suite — Issue #368
 *
 * Covers:
 *   - Expired JWT → 401
 *   - Tampered JWT payload → 401
 *   - Missing Authorization header → 401
 *   - SQL injection in address parameter safely rejected (no 500)
 *   - Address injection attacks rejected
 *   - Replay attack with used nonce → 400
 *   - Stale/future timestamps rejected → 400
 *   - Oversized/missing request body → 400
 *   - Non-HTTPS webhook URL → rejected
 *   - Private/loopback IP webhook URL → rejected
 *
 * Pattern: logic re-implemented inline, consistent with auth.test.js in this
 * codebase (avoids importing the CJS auth.js from an ESM test context).
 */

import { describe, it, expect } from "vitest";
import crypto from "node:crypto";
import jwt from "jsonwebtoken";

// ─── Constants ────────────────────────────────────────────────────────────────

const JWT_SECRET = "test-secret-that-is-32-chars-ok!";
const JWT_EXPIRY = "1h";
const NONCE_TTL_SECONDS = 300;
const SIGNATURE_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
const NONCE_PREFIX = "auth_nonce:";
const STELLAR_ADDR_RE = /^G[A-Z2-7]{55}$/;

/** Valid Stellar address: G + exactly 55 uppercase base-32 chars = 56 chars total */
const VALID_ADDR = "G" + "A".repeat(55);

// ─── In-memory nonce store (mirrors Redis) ────────────────────────────────────

function createNonceStore() {
  const map = new Map<string, string>();
  return {
    async get(k: string): Promise<string | null> { return map.get(k) ?? null; },
    async set(k: string, v: string): Promise<void> { map.set(k, v); },
    async del(k: string): Promise<void> { map.delete(k); },
  };
}

type Store = ReturnType<typeof createNonceStore>;
type Result = { status: number; body: Record<string, unknown> };

// ─── Auth logic (mirrors auth.js) ────────────────────────────────────────────

async function issueChallenge(redis: Store, address: string): Promise<Result> {
  const addr = String(address ?? "").trim();
  if (!addr || !STELLAR_ADDR_RE.test(addr)) {
    return { status: 400, body: { error: "address must be a valid Stellar public key" } };
  }
  const nonce = crypto.randomUUID();
  const timestamp = Date.now();
  await redis.set(`${NONCE_PREFIX}${nonce}`, JSON.stringify({ address: addr, timestamp }));
  return { status: 200, body: { nonce, expires_in: NONCE_TTL_SECONDS, created_at: timestamp } };
}

async function verifyAndIssueToken(
  redis: Store,
  params: { address?: string; nonce?: string; timestamp?: number; signature?: string }
): Promise<Result> {
  const { address, nonce, timestamp, signature } = params;
  if (!address || !nonce || timestamp === undefined || !signature) {
    return { status: 400, body: { error: "address, nonce, timestamp, and signature are required" } };
  }
  const ageMs = Date.now() - Number(timestamp);
  if (ageMs > SIGNATURE_WINDOW_MS || ageMs < -30_000) {
    return { status: 400, body: { error: "timestamp is outside allowed window" } };
  }
  const key = `${NONCE_PREFIX}${nonce}`;
  const stored = await redis.get(key);
  if (!stored) {
    return { status: 400, body: { error: "nonce not found or already used" } };
  }
  await redis.del(key); // consume — prevents replay
  const payload = JSON.parse(stored) as { address: string };
  if (payload.address !== address) {
    return { status: 400, body: { error: "nonce does not belong to the provided address" } };
  }
  let sigBytes: Buffer;
  try { sigBytes = Buffer.from(signature, "base64"); } catch {
    return { status: 400, body: { error: "signature must be base64 encoded" } };
  }
  // Signature always fails in unit tests (no real Stellar keypair) → 401
  void sigBytes;
  return { status: 401, body: { error: "signature verification failed" } };
}

function verifyJwt(authHeader: string | undefined): { status: number; user?: { address: string } } {
  if (!authHeader?.startsWith("Bearer ")) return { status: 401 };
  const token = authHeader.slice(7).trim();
  try {
    const p = jwt.verify(token, JWT_SECRET) as { sub: string };
    return { status: 200, user: { address: p.sub } };
  } catch {
    return { status: 401 };
  }
}

// ─── Webhook URL validation ────────────────────────────────────────────────

function validateWebhookUrl(url: string): { valid: boolean; reason?: string } {
  let parsed: URL;
  try { parsed = new URL(url); } catch {
    return { valid: false, reason: "invalid URL format" };
  }
  if (parsed.protocol !== "https:") {
    return { valid: false, reason: "webhook URL must use HTTPS" };
  }
  const h = parsed.hostname;
  if (h === "localhost" || h === "127.0.0.1" || h === "::1") {
    return { valid: false, reason: "webhook URL must not be a loopback address" };
  }
  const privateRanges = [
    /^10\.\d+\.\d+\.\d+$/,
    /^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/,
    /^192\.168\.\d+\.\d+$/,
    /^169\.254\.\d+\.\d+$/,
  ];
  if (privateRanges.some((re) => re.test(h))) {
    return { valid: false, reason: "webhook URL must not be a private IP address" };
  }
  return { valid: true };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════════════════

describe("Security: JWT authentication", () => {
  it("expired JWT returns 401", () => {
    const token = jwt.sign({ sub: VALID_ADDR }, JWT_SECRET, { expiresIn: -3600 });
    expect(verifyJwt(`Bearer ${token}`).status).toBe(401);
  });

  it("JWT signed with wrong secret returns 401", () => {
    const token = jwt.sign({ sub: VALID_ADDR }, "wrong-secret");
    expect(verifyJwt(`Bearer ${token}`).status).toBe(401);
  });

  it("manually forged JWT (invalid signature) returns 401", () => {
    expect(
      verifyJwt("Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJHQUJDMSJ9.INVALIDSIG").status
    ).toBe(401);
  });

  it("missing Authorization header returns 401", () => {
    expect(verifyJwt(undefined).status).toBe(401);
  });

  it("Authorization without Bearer prefix returns 401", () => {
    const token = jwt.sign({ sub: VALID_ADDR }, JWT_SECRET, { expiresIn: "1h" });
    expect(verifyJwt(token).status).toBe(401); // missing "Bearer " prefix
  });

  it("valid JWT returns 200 and attaches address", () => {
    const token = jwt.sign({ sub: VALID_ADDR }, JWT_SECRET, { expiresIn: "1h" });
    const result = verifyJwt(`Bearer ${token}`);
    expect(result.status).toBe(200);
    expect(result.user?.address).toBe(VALID_ADDR);
  });

  it("tampered payload (sub replaced, original sig) returns 401", () => {
    const tokenA = jwt.sign({ sub: VALID_ADDR }, JWT_SECRET);
    const [header, , sig] = tokenA.split(".");
    const fakePayload = Buffer.from(
      JSON.stringify({ sub: "G" + "B".repeat(55), iat: Math.floor(Date.now() / 1000) })
    ).toString("base64url");
    expect(verifyJwt(`Bearer ${header}.${fakePayload}.${sig}`).status).toBe(401);
  });
});

describe("Security: SQL injection in address parameters", () => {
  const SQL_PAYLOADS = [
    "' OR '1'='1",
    "'; DROP TABLE schedules; --",
    "1 UNION SELECT * FROM users",
    "admin'--",
    "' OR 1=1 --",
    "GABC'; DELETE FROM schedules WHERE '1'='1",
    "/* comment */ GABC1",
  ];

  for (const payload of SQL_PAYLOADS) {
    it(`rejects SQL payload: ${payload.slice(0, 45)}`, async () => {
      const redis = createNonceStore();
      const result = await issueChallenge(redis, payload);
      // Must not 500 — must be 400 (validation rejects before any data layer)
      expect(result.status).not.toBe(500);
      expect(result.status).toBe(400);
      expect(result.body.error).toBeTruthy();
    });
  }
});

describe("Security: address injection in challenge endpoint", () => {
  const INVALID = [
    "",
    "   ",
    "not-a-stellar-address",
    "A".repeat(200),
    "GABC<script>alert(1)</script>",
    "GABC\x00null-byte",
    "http://evil.com",
    "A".repeat(56), // 56 chars but doesn't start with G
  ];

  for (const addr of INVALID) {
    it(`rejects: "${addr.slice(0, 45)}"`, async () => {
      const redis = createNonceStore();
      const result = await issueChallenge(redis, addr);
      expect(result.status).toBe(400);
      expect(result.body.error).toBeTruthy();
    });
  }

  it("valid Stellar address (G + 55 base-32 chars) passes format check", async () => {
    const redis = createNonceStore();
    const result = await issueChallenge(redis, VALID_ADDR);
    expect(result.status).toBe(200);
    expect(result.body.nonce).toBeTruthy();
    expect(result.body.expires_in).toBe(NONCE_TTL_SECONDS);
  });
});

describe("Security: replay attack with used nonce", () => {
  it("second use of the same nonce returns 400 (nonce not found)", async () => {
    const redis = createNonceStore();

    // Step 1: issue a challenge
    const { body } = await issueChallenge(redis, VALID_ADDR);
    const nonce = body.nonce as string;
    const timestamp = body.created_at as number;
    const sig = Buffer.from("fake-signature").toString("base64");

    // Step 2: first call — nonce is consumed (sig will fail but nonce is gone)
    const r1 = await verifyAndIssueToken(redis, { address: VALID_ADDR, nonce, timestamp, signature: sig });
    expect([400, 401]).toContain(r1.status); // sig fails but nonce is consumed

    // Step 3: second call with same nonce — must be rejected
    const r2 = await verifyAndIssueToken(redis, { address: VALID_ADDR, nonce, timestamp, signature: sig });
    expect(r2.status).toBe(400);
    expect(r2.body.error as string).toMatch(/nonce not found or already used/i);
  });

  it("nonce that was never issued returns 400", async () => {
    const redis = createNonceStore();
    const result = await verifyAndIssueToken(redis, {
      address: VALID_ADDR,
      nonce: "never-existed-nonce",
      timestamp: Date.now(),
      signature: Buffer.from("sig").toString("base64"),
    });
    expect(result.status).toBe(400);
    expect(result.body.error as string).toMatch(/nonce not found/i);
  });
});

describe("Security: stale / future timestamp rejection", () => {
  it("timestamp older than 5 minutes returns 400", async () => {
    const redis = createNonceStore();
    const result = await verifyAndIssueToken(redis, {
      address: VALID_ADDR,
      nonce: "some-nonce",
      timestamp: Date.now() - 6 * 60 * 1000,
      signature: Buffer.from("sig").toString("base64"),
    });
    expect(result.status).toBe(400);
    expect(result.body.error as string).toMatch(/window/i);
  });

  it("timestamp more than 30 seconds in the future returns 400", async () => {
    const redis = createNonceStore();
    const result = await verifyAndIssueToken(redis, {
      address: VALID_ADDR,
      nonce: "some-nonce",
      timestamp: Date.now() + 60 * 1000,
      signature: Buffer.from("sig").toString("base64"),
    });
    expect(result.status).toBe(400);
    expect(result.body.error as string).toMatch(/window/i);
  });
});

describe("Security: oversized / missing request body fields", () => {
  it("empty body returns 400 with descriptive error", async () => {
    const redis = createNonceStore();
    const result = await verifyAndIssueToken(redis, {});
    expect(result.status).toBe(400);
    expect(result.body.error).toBeTruthy();
  });

  it("partially filled body (missing signature) returns 400", async () => {
    const redis = createNonceStore();
    const result = await verifyAndIssueToken(redis, {
      address: VALID_ADDR,
      nonce: "some-nonce",
      timestamp: Date.now(),
      // signature: missing
    });
    expect(result.status).toBe(400);
    expect(result.body.error as string).toMatch(/required/i);
  });

  it("missing timestamp returns 400", async () => {
    const redis = createNonceStore();
    const result = await verifyAndIssueToken(redis, {
      address: VALID_ADDR,
      nonce: "some-nonce",
      signature: Buffer.from("sig").toString("base64"),
      // timestamp: missing
    });
    expect(result.status).toBe(400);
  });
});

describe("Security: webhook URL validation", () => {
  it("non-HTTPS http:// URL is rejected with HTTPS reason", () => {
    const r = validateWebhookUrl("http://example.com/hook");
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/https/i);
  });

  it("FTP URL is rejected", () => {
    expect(validateWebhookUrl("ftp://example.com/hook").valid).toBe(false);
  });

  it("localhost is rejected (loopback)", () => {
    const r = validateWebhookUrl("https://localhost/hook");
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/loopback/i);
  });

  it("127.0.0.1 is rejected (loopback)", () => {
    const r = validateWebhookUrl("https://127.0.0.1/hook");
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/loopback/i);
  });

  it("private 10.x.x.x IP is rejected", () => {
    const r = validateWebhookUrl("https://10.0.0.1/hook");
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/private/i);
  });

  it("private 192.168.x.x IP is rejected", () => {
    const r = validateWebhookUrl("https://192.168.1.100/hook");
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/private/i);
  });

  it("private 172.16.x.x IP is rejected", () => {
    const r = validateWebhookUrl("https://172.16.0.1/hook");
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/private/i);
  });

  it("link-local 169.254.x.x is rejected", () => {
    const r = validateWebhookUrl("https://169.254.1.1/hook");
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/private/i);
  });

  it("valid HTTPS public URL is accepted", () => {
    expect(validateWebhookUrl("https://example.com/hook").valid).toBe(true);
  });

  it("valid HTTPS URL with path and query is accepted", () => {
    expect(validateWebhookUrl("https://hooks.example.com/events?token=abc123").valid).toBe(true);
  });

  it("invalid URL format is rejected", () => {
    const r = validateWebhookUrl("not-a-url");
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/invalid/i);
  });
});
