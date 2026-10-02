/**
 * backend/src/indexer/decoder.ts
 *
 * XDR event decoder for the vesting contract's five event types.
 *
 * Horizon returns Soroban event topics and values as base64-encoded XDR
 * ScVal blobs.  This module decodes them WITHOUT the stellar-sdk (which
 * would add a heavy runtime dependency) by understanding the binary layout
 * of the ScVal variants we care about:
 *
 *   ScSymbol  : 4-byte big-endian type tag (6 = SCV_SYMBOL)
 *               + 4-byte big-endian length
 *               + <length> UTF-8 bytes
 *               (padded to 4-byte boundary in XDR but length field is exact)
 *
 *   ScAddress : Multiple possible layouts depending on XDR encoding version;
 *               we return the raw base64 and let the API layer display it.
 *               If it looks like a 56-char Strkey we return it directly.
 *
 *   ScInt128  : 4-byte type tag (11 = SCV_INT128)
 *               + 8-byte big-endian signed hi word
 *               + 8-byte big-endian unsigned lo word
 *
 * For values that cannot be decoded we fall back to the raw base64 string
 * rather than throwing, so a single malformed event never stops the indexer.
 *
 * Contract event shapes (from events.rs):
 *
 *   StreamCreated:
 *     topics: [Symbol("StreamCreated"), sponsor_addr, recipient_addr]
 *     data:   StreamCreatedData { token, rate, start_ledger, cliff_ledger,
 *                                 end_ledger, total_deposit }
 *             → XDR struct/map; we pull token (field 0) and total_deposit (field 5)
 *
 *   TokensClaimed:
 *     topics: [Symbol("vc_claim"), recipient_addr]
 *     data:   (amount: i128, ledger_claimed_through: u32)
 *             → XDR tuple; amount is value[0]
 *
 *   StreamCancelled:
 *     topics: [Symbol("vc_cancel"), recipient_addr]
 *     data:   refunded_amount: i128   (single ScVal)
 *
 *   StreamClawedBack:
 *     topics: [Symbol("vc_claw"), recipient_addr]
 *     data:   (sponsor, token, amount: i128, reason)
 *             → value[0]=sponsor, value[1]=token, value[2]=amount
 *
 *   StreamDrained:
 *     topics: [Symbol("vc_drain"), recipient_addr]
 *     data:   (caller, sponsor, token, amount: i128)
 *             → value[0]=caller, value[1]=sponsor, value[2]=token, value[3]=amount
 */

import type {
  DecodedStreamEvent,
  HorizonEventRecord,
  StreamEventType,
} from './types.js';

// ── Symbol → EventType mapping ────────────────────────────────────────────────

const SYMBOL_TO_EVENT_TYPE: Record<string, StreamEventType> = {
  StreamCreated:  'StreamCreated',
  vc_claim:       'TokensClaimed',
  vc_cancel:      'StreamCancelled',
  vc_claw:        'StreamClawedBack',
  vc_drain:       'StreamDrained',
};

// ── Public decode entry-point ─────────────────────────────────────────────────

/**
 * Decode a raw Horizon event record into a `DecodedStreamEvent`.
 *
 * Returns `null` for unknown or malformed events so the indexer can skip
 * them safely without crashing.
 */
export function decodeEvent(
  record: HorizonEventRecord,
): DecodedStreamEvent | null {
  try {
    const topics: string[] = record.topic ?? [];
    if (topics.length === 0) return null;

    const symbolStr = decodeSymbol(topics[0] ?? '');
    const eventType = SYMBOL_TO_EVENT_TYPE[symbolStr];
    if (!eventType) return null;

    const valueXdrs = extractValueXdrs(record.value);

    const txHash =
      record.transaction_hash ||
      // Fallback: Horizon sometimes encodes hash in the id as "<hash>-<n>"
      (record.id?.includes('-') ? record.id.split('-')[0] : record.id) ||
      record.id ||
      '';

    const ledger =
      typeof record.ledger === 'number'
        ? record.ledger
        : parseInt(String(record.ledger ?? '0'), 10);

    switch (eventType) {
      case 'StreamCreated':
        return decodeStreamCreated(topics, valueXdrs, ledger, txHash);

      case 'TokensClaimed':
        return decodeTokensClaimed(topics, valueXdrs, ledger, txHash);

      case 'StreamCancelled':
        return decodeStreamCancelled(topics, valueXdrs, ledger, txHash);

      case 'StreamClawedBack':
        return decodeStreamClawedBack(topics, valueXdrs, ledger, txHash);

      case 'StreamDrained':
        return decodeStreamDrained(topics, valueXdrs, ledger, txHash);
    }
  } catch {
    return null;
  }
}

// ── Per-event decoders ────────────────────────────────────────────────────────

function decodeStreamCreated(
  topics: string[],
  values: string[],
  ledger: number,
  txHash: string,
): DecodedStreamEvent | null {
  // topics: [Symbol("StreamCreated"), sponsor, recipient]
  const sponsor    = decodeAddress(topics[1] ?? '');
  const recipient  = decodeAddress(topics[2] ?? '');
  if (!recipient) return null;

  // data: StreamCreatedData struct
  // Field layout: token(0), rate(1), start_ledger(2), cliff_ledger(3),
  //               end_ledger(4), total_deposit(5)
  const token  = decodeAddress(values[0] ?? '');
  // total_deposit is field index 5; however Horizon may flatten the struct
  // into a sequence of XDR values.  Try index 5, then 1 as a fallback.
  const amount = decodeI128(values[5] ?? values[1] ?? undefined);

  return {
    event_type:       'StreamCreated',
    recipient,
    sponsor,
    token,
    amount,
    ledger_sequence:  ledger,
    transaction_hash: txHash,
  };
}

function decodeTokensClaimed(
  topics: string[],
  values: string[],
  ledger: number,
  txHash: string,
): DecodedStreamEvent | null {
  // topics: [Symbol("vc_claim"), recipient]
  // data:   (amount: i128, ledger_claimed_through: u32)
  const recipient = decodeAddress(topics[1] ?? '');
  if (!recipient) return null;

  const amount = decodeI128(values[0] ?? undefined);

  return {
    event_type:       'TokensClaimed',
    recipient,
    sponsor:          '',
    token:            '',
    amount,
    ledger_sequence:  ledger,
    transaction_hash: txHash,
  };
}

function decodeStreamCancelled(
  topics: string[],
  values: string[],
  ledger: number,
  txHash: string,
): DecodedStreamEvent | null {
  // topics: [Symbol("vc_cancel"), recipient]
  // data:   refunded_amount: i128
  const recipient = decodeAddress(topics[1] ?? '');
  if (!recipient) return null;

  const amount = decodeI128(values[0] ?? undefined);

  return {
    event_type:       'StreamCancelled',
    recipient,
    sponsor:          '',
    token:            '',
    amount,
    ledger_sequence:  ledger,
    transaction_hash: txHash,
  };
}

function decodeStreamClawedBack(
  topics: string[],
  values: string[],
  ledger: number,
  txHash: string,
): DecodedStreamEvent | null {
  // topics: [Symbol("vc_claw"), recipient]
  // data:   (sponsor, token, amount: i128, reason)
  const recipient = decodeAddress(topics[1] ?? '');
  if (!recipient) return null;

  const sponsor = decodeAddress(values[0] ?? '');
  const token   = decodeAddress(values[1] ?? '');
  const amount  = decodeI128(values[2] ?? undefined);

  return {
    event_type:       'StreamClawedBack',
    recipient,
    sponsor,
    token,
    amount,
    ledger_sequence:  ledger,
    transaction_hash: txHash,
  };
}

function decodeStreamDrained(
  topics: string[],
  values: string[],
  ledger: number,
  txHash: string,
): DecodedStreamEvent | null {
  // topics: [Symbol("vc_drain"), recipient]
  // data:   (caller, sponsor, token, amount: i128)
  const recipient = decodeAddress(topics[1] ?? '');
  if (!recipient) return null;

  // caller is values[0]; we don't store it in the schema
  const sponsor = decodeAddress(values[1] ?? '');
  const token   = decodeAddress(values[2] ?? '');
  const amount  = decodeI128(values[3] ?? undefined);

  return {
    event_type:       'StreamDrained',
    recipient,
    sponsor,
    token,
    amount,
    ledger_sequence:  ledger,
    transaction_hash: txHash,
  };
}

// ── XDR primitive decoders ────────────────────────────────────────────────────

/**
 * Decode a base64-encoded XDR ScSymbol to its UTF-8 string value.
 *
 * Layout:
 *   bytes 0-3:  4-byte big-endian type discriminant (ignored)
 *   bytes 4-7:  4-byte big-endian string byte-length N
 *   bytes 8-(8+N-1): N UTF-8 bytes
 */
export function decodeSymbol(xdr: string): string {
  if (!xdr) return '';
  try {
    const buf = Buffer.from(xdr, 'base64');
    // Need at least 8 bytes for the header
    if (buf.length < 8) {
      // Short buffers may be a plain text symbol from test fixtures
      return buf.toString('utf8').replace(/[^\x20-\x7e]/g, '').trim();
    }
    const len = buf.readUInt32BE(4);
    if (len === 0 || buf.length < 8 + len) {
      // Fallback: strip non-printable bytes
      return buf.subarray(8).toString('utf8').replace(/[^\x20-\x7e]/g, '').trim();
    }
    return buf.subarray(8, 8 + len).toString('utf8');
  } catch {
    return xdr;
  }
}

/**
 * Decode a base64-encoded XDR ScAddress (or any address-like ScVal).
 *
 * Without stellar-sdk we cannot fully decode the binary address to a Strkey.
 * If the raw input already looks like a Stellar Strkey (G…/C… 56 chars)
 * we return it unchanged.  Otherwise we return the raw base64 so the data
 * is never silently dropped.
 */
export function decodeAddress(xdr: string): string {
  if (!xdr) return '';
  // Already a Strkey — common in test environments and pre-decoded responses
  if (/^[GC][A-Z0-9]{55}$/.test(xdr)) return xdr;
  // Return raw XDR; the API layer can use stellar-sdk to render it if needed
  return xdr;
}

/**
 * Decode a base64-encoded XDR ScInt128 to a decimal string.
 *
 * Layout (after stripping the 4-byte type tag that Horizon may or may not
 * include depending on encoding version):
 *   8-byte big-endian SIGNED hi word
 *   8-byte big-endian UNSIGNED lo word
 *
 * Returns the decimal string representation (preserving full i128 range),
 * or null if the input is missing or cannot be decoded.
 */
export function decodeI128(xdr: string | undefined): string | null {
  if (!xdr) return null;
  try {
    const buf = Buffer.from(xdr, 'base64');

    let hiOffset = 0;
    // If the buffer is 20 bytes it includes the 4-byte type tag; skip it.
    if (buf.length === 20) hiOffset = 4;
    // If it's 12 bytes there may be a 4-byte discrim prefix.
    else if (buf.length === 12) hiOffset = 4;
    // Standard 16-byte i128 without tag
    else if (buf.length >= 16) hiOffset = buf.length - 16;
    else return null;

    const hi = buf.readBigInt64BE(hiOffset);
    const lo = buf.readBigUInt64BE(hiOffset + 8);

    // Reconstruct the 128-bit value: value = hi * 2^64 + lo
    const value = (hi << 64n) | lo;
    return value.toString(10);
  } catch {
    return null;
  }
}

// ── Value extraction helper ───────────────────────────────────────────────────

/**
 * Normalise the `value` field of a Horizon event record into a flat array
 * of base64 XDR strings.
 *
 * Horizon encodes event data in one of three ways depending on the version
 * and whether the contract used a tuple or a single value:
 *   1. `{ xdr: "<base64>" }` — single ScVal wrapper
 *   2. `string[]`            — array of base64 ScVal strings
 *   3. `{ fields: [...] }`   — parsed struct fields (test fixtures / mock)
 */
function extractValueXdrs(
  value: HorizonEventRecord['value'],
): string[] {
  if (!value) return [];

  // Array of XDR strings (tuple data)
  if (Array.isArray(value)) {
    return value.map((v) => (typeof v === 'string' ? v : ''));
  }

  // { xdr: "<base64>" } wrapper
  if (typeof (value as any).xdr === 'string') {
    return [(value as any).xdr as string];
  }

  // { fields: [...] } — test fixture format used by the existing codebase
  if (Array.isArray((value as any).fields)) {
    return (value as any).fields as string[];
  }

  return [];
}
