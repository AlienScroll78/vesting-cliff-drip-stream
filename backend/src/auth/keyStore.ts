/**
 * RSA key generation and key-rotation utilities for RS256 JWT signing.
 *
 * Closes #742 — JWT-based auth with RS256 + key rotation support.
 *
 * Design:
 *  - Two RSA 2048-bit key-pairs are kept in memory: "current" and "previous".
 *  - JWTs are signed with the current private key and carry a `kid` claim so
 *    verifiers can select the right public key.
 *  - Rotation replaces the current key with a fresh one and demotes the old
 *    current key to the "previous" slot (grace window for in-flight tokens).
 *  - Keys can also be loaded from PEM environment variables for persistent
 *    deployments (SIGNING_PRIVATE_KEY_PEM / SIGNING_PUBLIC_KEY_PEM).
 */

import crypto from "crypto";

export interface RsaKeyPair {
  kid: string;            // Key ID – SHA-256 fingerprint (first 16 hex chars)
  privateKey: crypto.KeyObject;
  publicKey: crypto.KeyObject;
  createdAt: number;      // Unix ms
}

// ---------------------------------------------------------------------------
// In-memory store
// ---------------------------------------------------------------------------

let currentKey: RsaKeyPair | null = null;
let previousKey: RsaKeyPair | null = null;

// ---------------------------------------------------------------------------
// Key generation
// ---------------------------------------------------------------------------

function generateKeyPair(): RsaKeyPair {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });

  // Derive a stable kid from the public key's DER fingerprint
  const pubDer = publicKey
    .export({ type: "spki", format: "der" });
  const kid = crypto
    .createHash("sha256")
    .update(pubDer as Buffer)
    .digest("hex")
    .slice(0, 16);

  return {
    kid,
    privateKey: privateKey as unknown as crypto.KeyObject,
    publicKey: publicKey as unknown as crypto.KeyObject,
    createdAt: Date.now(),
  };
}

/**
 * Attempt to load a key-pair from environment variables.
 * Returns null if variables are absent or malformed.
 */
function loadKeyPairFromEnv(): RsaKeyPair | null {
  const privPem = process.env.SIGNING_PRIVATE_KEY_PEM;
  const pubPem = process.env.SIGNING_PUBLIC_KEY_PEM;
  if (!privPem || !pubPem) return null;

  try {
    const privateKey = crypto.createPrivateKey(privPem);
    const publicKey = crypto.createPublicKey(pubPem);

    const pubDer = publicKey.export({ type: "spki", format: "der" }) as Buffer;
    const kid = crypto
      .createHash("sha256")
      .update(pubDer)
      .digest("hex")
      .slice(0, 16);

    return { kid, privateKey, publicKey, createdAt: Date.now() };
  } catch (err) {
    console.error("[keyStore] Failed to load key from env:", err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Initialise the key store.  Tries env PEMs first; falls back to generating
 * an ephemeral pair.  Idempotent — safe to call multiple times.
 */
export function initKeyStore(): void {
  if (currentKey) return; // already initialised
  currentKey = loadKeyPairFromEnv() ?? generateKeyPair();
  console.log(`[keyStore] Initialised with kid=${currentKey.kid}`);
}

/**
 * Rotate keys: generates a fresh pair as the new current key and keeps the
 * old current key as the previous key for the grace window.
 */
export function rotateKeys(): { newKid: string; retiredKid: string | null } {
  const retired = currentKey;
  previousKey = retired;
  currentKey = generateKeyPair();
  console.log(
    `[keyStore] Rotated keys — new kid=${currentKey.kid}, retired kid=${retired?.kid ?? "none"}`
  );
  return { newKid: currentKey.kid, retiredKid: retired?.kid ?? null };
}

/**
 * Retrieve the current (signing) key pair.
 * Automatically initialises if not yet set up.
 */
export function getCurrentKey(): RsaKeyPair {
  if (!currentKey) initKeyStore();
  return currentKey!;
}

/**
 * Return the public key for a given kid, searching both current and previous.
 * Returns null if no match.
 */
export function getPublicKeyByKid(kid: string): crypto.KeyObject | null {
  if (currentKey?.kid === kid) return currentKey.publicKey;
  if (previousKey?.kid === kid) return previousKey.publicKey;
  return null;
}

/**
 * Return a JWKS-style array of all known public keys (for /.well-known/jwks.json).
 */
export function getJwks(): Array<{
  kty: string;
  kid: string;
  use: string;
  alg: string;
  n: string;
  e: string;
}> {
  const keys: RsaKeyPair[] = [];
  if (currentKey) keys.push(currentKey);
  if (previousKey) keys.push(previousKey);

  return keys.map(({ kid, publicKey }) => {
    const jwk = publicKey.export({ format: "jwk" }) as {
      kty: string; n: string; e: string;
    };
    return { kty: jwk.kty, kid, use: "sig", alg: "RS256", n: jwk.n, e: jwk.e };
  });
}

/**
 * Export current private key as PEM (for secret rotation scripts).
 */
export function exportCurrentPrivateKeyPem(): string {
  if (!currentKey) initKeyStore();
  return currentKey!.privateKey.export({ type: "pkcs8", format: "pem" }) as string;
}

/**
 * Export current public key as PEM.
 */
export function exportCurrentPublicKeyPem(): string {
  if (!currentKey) initKeyStore();
  return currentKey!.publicKey.export({ type: "spki", format: "pem" }) as string;
}
