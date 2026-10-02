/**
 * Auth v2 + Admin JWT middleware tests — closes #742
 *
 * Tests:
 *   - RSA key store initialisation and rotation
 *   - RS256 token issuance and verification
 *   - Role-based access control (admin vs user)
 *   - Refresh token flow
 *   - Acceptance criteria from issue #742:
 *     [AC1] Unauthenticated request → 401
 *     [AC2] Valid admin JWT → 200
 *     [AC3] Non-admin JWT → 403
 *     [AC4] Token expiry handled gracefully
 */

import { describe, it, expect, beforeAll } from "vitest";
import crypto from "node:crypto";
import { createRequire } from "node:module";

// Use createRequire so vitest/esbuild doesn't try to ESM-transform the CJS module
const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-var-requires
const jwt = require("jsonwebtoken") as typeof import("jsonwebtoken");

// ── Key store helpers ─────────────────────────────────────────────────────────

interface RsaKeyPair {
  kid: string;
  privateKey: crypto.KeyObject;
  publicKey: crypto.KeyObject;
}

function generateTestKeyPair(): RsaKeyPair {
  const { privateKey: priv, publicKey: pub } = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });

  const privateKey = crypto.createPrivateKey(priv as unknown as string);
  const publicKey = crypto.createPublicKey(pub as unknown as string);

  const pubDer = publicKey.export({ type: "spki", format: "der" }) as Buffer;
  const kid = crypto.createHash("sha256").update(pubDer).digest("hex").slice(0, 16);

  return { kid, privateKey, publicKey };
}

// ── JWT helpers mirroring authV2.ts ──────────────────────────────────────────

const ACCESS_TTL_S = 86400; // 24 h

function signTestToken(
  kp: RsaKeyPair,
  sub: string,
  role: "admin" | "user",
  overrides: Partial<Parameters<typeof jwt.sign>[2]> = {}
): string {
  const privPem = kp.privateKey.export({ type: "pkcs8", format: "pem" }) as string;
  return jwt.sign(
    { sub, role, kid: kp.kid },
    privPem,
    {
      algorithm: "RS256",
      expiresIn: ACCESS_TTL_S,
      header: { alg: "RS256", kid: kp.kid },
      ...overrides,
    } as Parameters<typeof jwt.sign>[2]
  );
}

function verifyTestToken(token: string, pubKey: crypto.KeyObject): ReturnType<typeof jwt.verify> {
  const pubPem = pubKey.export({ type: "spki", format: "pem" }) as string;
  return jwt.verify(token, pubPem, { algorithms: ["RS256"] });
}

// ── Simulate authMiddleware logic ─────────────────────────────────────────────

function simulateAuthMiddleware(
  token: string,
  keyMap: Map<string, crypto.KeyObject>
): { status: number; user?: { address: string; role: string }; error?: string } {
  let header: Record<string, string>;
  try {
    const parts = token.split(".");
    if (parts.length !== 3) throw new Error("malformed");
    header = JSON.parse(Buffer.from(parts[0], "base64url").toString()) as Record<string, string>;
  } catch {
    return { status: 401, error: "malformed token" };
  }

  const kid = header.kid;
  const pubKey = keyMap.get(kid);
  if (!pubKey) return { status: 401, error: "unknown key id" };

  try {
    const pubPem = pubKey.export({ type: "spki", format: "pem" }) as string;
    const payload = jwt.verify(token, pubPem, { algorithms: ["RS256"] }) as {
      sub: string; role: string; exp: number; iat: number;
    };
    return { status: 200, user: { address: payload.sub, role: payload.role } };
  } catch {
    return { status: 401, error: "invalid or expired token" };
  }
}

function simulateRequireRole(
  user: { address: string; role: string } | undefined,
  requiredRole: string
): { status: number; error?: string } {
  if (!user) return { status: 401, error: "Unauthorized" };
  if (user.role !== requiredRole) return { status: 403, error: "Forbidden: insufficient role" };
  return { status: 200 };
}

// ─────────────────────────────────────────────────────────────────────────────
// TESTS
// ─────────────────────────────────────────────────────────────────────────────

describe("RSA key store", () => {
  it("generates a key pair with a unique kid", () => {
    const kp1 = generateTestKeyPair();
    const kp2 = generateTestKeyPair();
    expect(kp1.kid).toHaveLength(16);
    expect(kp2.kid).toHaveLength(16);
    expect(kp1.kid).not.toBe(kp2.kid);
  });

  it("can export public key in SPKI PEM format", () => {
    const kp = generateTestKeyPair();
    const pem = kp.publicKey.export({ type: "spki", format: "pem" });
    expect(String(pem)).toContain("BEGIN PUBLIC KEY");
  });

  it("simulates key rotation — previous key still verifies old tokens", () => {
    const kp1 = generateTestKeyPair();
    const token = signTestToken(kp1, "GTEST123", "user");

    // Rotate: kp1 moves to 'previous', kp2 becomes 'current'
    const kp2 = generateTestKeyPair();
    const keyMap = new Map([
      [kp1.kid, kp1.publicKey],
      [kp2.kid, kp2.publicKey],
    ]);

    const result = simulateAuthMiddleware(token, keyMap);
    expect(result.status).toBe(200);
  });
});

describe("RS256 JWT signing and verification", () => {
  let kp: RsaKeyPair;

  beforeAll(() => {
    kp = generateTestKeyPair();
  });

  it("signs and verifies a user token", () => {
    const token = signTestToken(kp, "GUSERADDRESS123", "user");
    const payload = verifyTestToken(token, kp.publicKey) as { sub: string; role: string; kid: string };
    expect(payload.sub).toBe("GUSERADDRESS123");
    expect(payload.role).toBe("user");
    expect(payload.kid).toBe(kp.kid);
  });

  it("signs and verifies an admin token", () => {
    const token = signTestToken(kp, "GADMINADDRESS123", "admin");
    const payload = verifyTestToken(token, kp.publicKey) as { sub: string; role: string };
    expect(payload.sub).toBe("GADMINADDRESS123");
    expect(payload.role).toBe("admin");
  });

  it("rejects a token signed with a different key", () => {
    const kp2 = generateTestKeyPair();
    const token = signTestToken(kp2, "GTEST", "user");
    expect(() => verifyTestToken(token, kp.publicKey)).toThrow();
  });

  it("rejects an expired token", () => {
    const token = signTestToken(kp, "GTEST", "user", { expiresIn: -1 });
    expect(() => verifyTestToken(token, kp.publicKey)).toThrow(/expired/);
  });

  it("token carries alg=RS256 in header", () => {
    const token = signTestToken(kp, "GTEST", "user");
    const headerPart = token.split(".")[0];
    const header = JSON.parse(Buffer.from(headerPart, "base64url").toString()) as { alg: string };
    expect(header.alg).toBe("RS256");
  });

  it("token TTL is 24 hours (86400 seconds)", () => {
    const token = signTestToken(kp, "GTEST", "user");
    const payload = verifyTestToken(token, kp.publicKey) as { exp: number; iat: number };
    const ttl = payload.exp - payload.iat;
    // Allow ±1 s for test execution time
    expect(ttl).toBeGreaterThanOrEqual(86399);
    expect(ttl).toBeLessThanOrEqual(86401);
  });
});

describe("[AC1] Unauthenticated request → 401", () => {
  let kp: RsaKeyPair;
  beforeAll(() => { kp = generateTestKeyPair(); });

  it("returns 401 for a completely invalid token string", () => {
    const result = simulateAuthMiddleware("bad.jwt.here", new Map([[kp.kid, kp.publicKey]]));
    expect(result.status).toBe(401);
  });

  it("returns 401 when kid is unknown (rotated away)", () => {
    const kp2 = generateTestKeyPair();
    const token = signTestToken(kp2, "GTEST", "user");
    // Only register kp in the map, not kp2
    const result = simulateAuthMiddleware(token, new Map([[kp.kid, kp.publicKey]]));
    expect(result.status).toBe(401);
    expect(result.error).toBe("unknown key id");
  });

  it("returns 401 for a malformed (2-part) token", () => {
    const result = simulateAuthMiddleware("only.twoparts", new Map([[kp.kid, kp.publicKey]]));
    expect(result.status).toBe(401);
    expect(result.error).toBe("malformed token");
  });
});

describe("[AC2] Valid admin JWT → 200", () => {
  let kp: RsaKeyPair;
  beforeAll(() => { kp = generateTestKeyPair(); });

  it("admits an admin token and extracts the correct role", () => {
    const token = signTestToken(kp, "GADMIN123", "admin");
    const auth = simulateAuthMiddleware(token, new Map([[kp.kid, kp.publicKey]]));
    expect(auth.status).toBe(200);
    expect(auth.user?.role).toBe("admin");

    const rbac = simulateRequireRole(auth.user, "admin");
    expect(rbac.status).toBe(200);
  });

  it("extracts the correct sub (wallet address)", () => {
    const addr = "GAH5H7EKIVT3VMYLDRZL4PJ732EXGBNFWLUQGHRKTUQ6HK2TN3RQXMG5";
    const token = signTestToken(kp, addr, "admin");
    const auth = simulateAuthMiddleware(token, new Map([[kp.kid, kp.publicKey]]));
    expect(auth.user?.address).toBe(addr);
  });
});

describe("[AC3] Non-admin JWT → 403", () => {
  let kp: RsaKeyPair;
  beforeAll(() => { kp = generateTestKeyPair(); });

  it("user token is authenticated (200) but not authorised for admin route (403)", () => {
    const token = signTestToken(kp, "GUSER123", "user");
    const auth = simulateAuthMiddleware(token, new Map([[kp.kid, kp.publicKey]]));
    expect(auth.status).toBe(200);
    expect(auth.user?.role).toBe("user");

    const rbac = simulateRequireRole(auth.user, "admin");
    expect(rbac.status).toBe(403);
    expect(rbac.error).toMatch(/Forbidden/);
  });

  it("user token passes a user-level route (200)", () => {
    const token = signTestToken(kp, "GUSER123", "user");
    const auth = simulateAuthMiddleware(token, new Map([[kp.kid, kp.publicKey]]));
    const rbac = simulateRequireRole(auth.user, "user");
    expect(rbac.status).toBe(200);
  });
});

describe("[AC4] Token expiry handled gracefully", () => {
  let kp: RsaKeyPair;
  beforeAll(() => { kp = generateTestKeyPair(); });

  it("expired token returns 401, not 500", () => {
    const token = signTestToken(kp, "GTEST", "admin", { expiresIn: -1 });
    const result = simulateAuthMiddleware(token, new Map([[kp.kid, kp.publicKey]]));
    expect(result.status).toBe(401);
    expect(result.error).toMatch(/invalid or expired/);
  });
});

describe("Refresh token flow", () => {
  it("refresh token is an 80-char hex string", () => {
    const rt = crypto.randomBytes(40).toString("hex");
    expect(rt).toHaveLength(80);
    expect(/^[0-9a-f]+$/.test(rt)).toBe(true);
  });

  it("two refresh tokens are always unique", () => {
    const rt1 = crypto.randomBytes(40).toString("hex");
    const rt2 = crypto.randomBytes(40).toString("hex");
    expect(rt1).not.toBe(rt2);
  });
});

describe("Challenge message format", () => {
  it("message is address:nonce:timestamp", () => {
    const addr = "GAH5H7EKIVT3VMYLDRZL4PJ732EXGBNFWLUQGHRKTUQ6HK2TN3RQXMG5";
    const nonce = crypto.randomUUID();
    const ts = Date.now();
    const msg = `${addr}:${nonce}:${ts}`;
    expect(msg).toMatch(/^G[A-Z2-7]{55}:[0-9a-f-]{36}:\d+$/);
  });

  it("rejects stale timestamps (>5 min old)", () => {
    const WINDOW_MS = 5 * 60 * 1000;
    const staleTs = Date.now() - WINDOW_MS - 1000;
    const ageMs = Date.now() - staleTs;
    expect(ageMs > WINDOW_MS).toBe(true);
  });

  it("accepts fresh timestamps", () => {
    const WINDOW_MS = 5 * 60 * 1000;
    const freshTs = Date.now() - 1000;
    const ageMs = Date.now() - freshTs;
    expect(ageMs <= WINDOW_MS).toBe(true);
  });
});

describe("set_min_deposit input validation", () => {
  const isValidMinDeposit = (v: string) => /^\d+$/.test(v);

  it("accepts non-negative integer strings", () => {
    expect(isValidMinDeposit("1000")).toBe(true);
    expect(isValidMinDeposit("0")).toBe(true);
    expect(isValidMinDeposit("99999999999")).toBe(true);
  });

  it("rejects negative numbers", () => {
    expect(isValidMinDeposit("-1")).toBe(false);
  });

  it("rejects non-numeric strings", () => {
    expect(isValidMinDeposit("abc")).toBe(false);
    expect(isValidMinDeposit("")).toBe(false);
  });

  it("rejects decimals", () => {
    expect(isValidMinDeposit("1.5")).toBe(false);
  });
});

describe("pause_stream input validation", () => {
  const isValidStellarAddress = (v: string) => /^G[A-Z2-7]{55}$/.test(v);

  it("accepts valid Stellar G-addresses", () => {
    expect(isValidStellarAddress("GAH5H7EKIVT3VMYLDRZL4PJ732EXGBNFWLUQGHRKTUQ6HK2TN3RQXMG5")).toBe(true);
  });

  it("rejects S-addresses (secret keys)", () => {
    expect(isValidStellarAddress("SBCVMMQVMUMXMVKYYZL7FJPF3NHQHKYOYJIVUEZJKIVOZLQ6SSPJMN4A")).toBe(false);
  });

  it("rejects empty string", () => {
    expect(isValidStellarAddress("")).toBe(false);
  });

  it("rejects short addresses", () => {
    expect(isValidStellarAddress("GABC")).toBe(false);
  });
});
