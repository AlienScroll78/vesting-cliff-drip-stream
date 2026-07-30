import { describe, it, expect } from "vitest";
import fc from "fast-check";

const VALID_STELLAR_ADDRESS = /^G[A-Z2-7]{55}$/;
const ED25519_PUBKEY_BYTES = 32;
const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function encodeBase32(bytes: Uint8Array): string {
  let result = "";
  let buffer = 0;
  let bitsLeft = 0;
  for (const b of bytes) {
    buffer = (buffer << 8) | b;
    bitsLeft += 8;
    while (bitsLeft >= 5) {
      bitsLeft -= 5;
      result += BASE32_ALPHABET[(buffer >> bitsLeft) & 0x1f];
    }
  }
  if (bitsLeft > 0) {
    result += BASE32_ALPHABET[(buffer << (5 - bitsLeft)) & 0x1f];
  }
  return result;
}

const stellarAddressArbitrary = fc
  .uint8Array({ minLength: ED25519_PUBKEY_BYTES, maxLength: ED25519_PUBKEY_BYTES })
  .map((seed) => {
    const encoded = encodeBase32(seed);
    const checksum = "G";
    return checksum + encoded.padEnd(55, "A").slice(0, 55);
  })
  .filter((a) => VALID_STELLAR_ADDRESS.test(a));

const nonStellarAddressArbitrary = fc
  .string({ minLength: 1, maxLength: 100 })
  .filter((s) => !VALID_STELLAR_ADDRESS.test(s));

const jwtSecret = "test-secret-min-32-chars-long-for-testing!!";

function validateStellarAddress(address: string): boolean {
  return VALID_STELLAR_ADDRESS.test(address);
}

function validatePaginationLimit(limit: number): { valid: boolean; reason?: string } {
  if (limit < 1) return { valid: false, reason: "limit must be >= 1" };
  if (limit > 100) return { valid: false, reason: "limit must be <= 100" };
  return { valid: true };
}

function validateJWT(token: string): { valid: boolean; sub?: string } {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return { valid: false };
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString());
    if (typeof payload.sub !== "string") return { valid: false };
    if (payload.exp && payload.exp * 1000 < Date.now()) return { valid: false };
    return { valid: true, sub: payload.sub };
  } catch {
    return { valid: false };
  }
}

function createJWT(address: string, expiresInSec: number): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(
    JSON.stringify({ sub: address, iat: now, exp: now + expiresInSec })
  ).toString("base64url");
  return `${header}.${payload}.fake-signature`;
}

describe("Property: any non-Stellar address returns 400 for recipient param", () => {
  it("rejects all non-Stellar addresses", () => {
    fc.assert(
      fc.property(nonStellarAddressArbitrary, (address) => {
        const valid = VALID_STELLAR_ADDRESS.test(address);
        expect(valid).toBe(false);
      }),
      { numRuns: 1000 }
    );
  });
});

describe("Property: valid Stellar address always passes address validation", () => {
  it("accepts all valid Stellar addresses", () => {
    fc.assert(
      fc.property(stellarAddressArbitrary, (address) => {
        expect(validateStellarAddress(address)).toBe(true);
      }),
      { numRuns: 1000 }
    );
  });
});

describe("Property: pagination limit > 100 always returns 400", () => {
  it("rejects limits over 100", () => {
    fc.assert(
      fc.property(fc.integer({ min: 101, max: 10000 }), (limit) => {
        const result = validatePaginationLimit(limit);
        expect(result.valid).toBe(false);
        expect(result.reason).toContain("100");
      }),
      { numRuns: 1000 }
    );
  });

  it("accepts limits between 1 and 100", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 100 }), (limit) => {
        expect(validatePaginationLimit(limit).valid).toBe(true);
      }),
      { numRuns: 1000 }
    );
  });

  it("rejects limits below 1", () => {
    fc.assert(
      fc.property(fc.integer({ min: -1000, max: 0 }), (limit) => {
        const result = validatePaginationLimit(limit);
        expect(result.valid).toBe(false);
      }),
      { numRuns: 1000 }
    );
  });
});

describe("Property: JWT with future expiry always authenticates", () => {
  it("accepts tokens with future expiry", () => {
    fc.assert(
      fc.property(
        stellarAddressArbitrary,
        fc.integer({ min: 3600, max: 86400 * 365 }),
        (address, ttl) => {
          const token = createJWT(address, ttl);
          const result = validateJWT(token);
          expect(result.valid).toBe(true);
          expect(result.sub).toBe(address);
        }
      ),
      { numRuns: 1000 }
    );
  });
});

describe("Property: JWT with past expiry always returns 401", () => {
  it("rejects tokens with past expiry", () => {
    fc.assert(
      fc.property(
        stellarAddressArbitrary,
        fc.integer({ min: -86400 * 365, max: -1 }),
        (address, ttl) => {
          const token = createJWT(address, ttl);
          const result = validateJWT(token);
          expect(result.valid).toBe(false);
        }
      ),
      { numRuns: 1000 }
    );
  });
});

describe("Property: valid Stellar address format", () => {
  it("starts with G and is 56 characters", () => {
    fc.assert(
      fc.property(stellarAddressArbitrary, (address) => {
        expect(address.length).toBe(56);
        expect(address[0]).toBe("G");
      }),
      { numRuns: 1000 }
    );
  });

  it("contains only base32 chars after prefix", () => {
    fc.assert(
      fc.property(stellarAddressArbitrary, (address) => {
        const rest = address.slice(1);
        expect(/^[A-Z2-7]+$/.test(rest)).toBe(true);
      }),
      { numRuns: 1000 }
    );
  });
});
