/**
 * UUID generation utility with dynamic polyfill.
 *
 * Uses the native crypto.randomUUID() when available (all modern browsers).
 * Dynamically imports the 'uuid' package as a polyfill only in older Safari
 * where crypto.randomUUID is not available — so no extra bytes are shipped
 * to browsers that don't need it.
 */

/**
 * Generates a RFC 4122 v4 UUID string.
 * Falls back to a dynamic `uuid` polyfill when `crypto.randomUUID` is absent.
 */
export async function generateUUID(): Promise<string> {
  if (
    typeof crypto !== 'undefined' &&
    typeof crypto.randomUUID === 'function'
  ) {
    return crypto.randomUUID();
  }

  // Dynamic import — only loaded when native API is unavailable
  const { v4 } = await import('uuid');
  return v4();
}

/**
 * Synchronous UUID fallback for contexts where async is not feasible.
 * Uses crypto.getRandomValues which is available in all target browsers.
 */
export function generateUUIDSync(): string {
  if (
    typeof crypto !== 'undefined' &&
    typeof crypto.randomUUID === 'function'
  ) {
    return crypto.randomUUID();
  }

  // Manual v4 using crypto.getRandomValues (universally supported)
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);

  // Set version (4) and variant bits per RFC 4122
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join('-');
}
