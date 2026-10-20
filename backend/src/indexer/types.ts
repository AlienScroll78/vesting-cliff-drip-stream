/**
 * backend/src/indexer/types.ts
 *
 * Shared type definitions for the Horizon event indexer.  All other indexer
 * modules import from this file; nothing here has side-effects.
 */

// ── Event taxonomy ─────────────────────────────────────────────────────────────

/**
 * The five on-chain vesting contract event types the indexer understands.
 *
 * Mapped from the Soroban Symbol topics emitted by events.rs:
 *   StreamCreated   ← Symbol("StreamCreated")
 *   TokensClaimed   ← symbol_short!("vc_claim")
 *   StreamCancelled ← symbol_short!("vc_cancel")
 *   StreamClawedBack← symbol_short!("vc_claw")
 *   StreamDrained   ← symbol_short!("vc_drain")
 */
export type StreamEventType =
  | 'StreamCreated'
  | 'TokensClaimed'
  | 'StreamCancelled'
  | 'StreamClawedBack'
  | 'StreamDrained';

// ── Decoded event ─────────────────────────────────────────────────────────────

/**
 * A fully decoded stream event ready for insertion into `stream_events`.
 *
 * Addresses are stored as their raw XDR base64 representation (or Strkey
 * if stellar-sdk is available at runtime).  The `amount` field uses a
 * string to preserve full i128 precision for the NUMERIC column.
 */
export interface DecodedStreamEvent {
  event_type: StreamEventType;
  recipient: string;
  sponsor: string;
  token: string;
  /** Decimal string representation of an i128 amount; null when not applicable. */
  amount: string | null;
  ledger_sequence: number;
  transaction_hash: string;
}

// ── Horizon wire types ────────────────────────────────────────────────────────

/**
 * A single event record returned by the Horizon /soroban/events endpoint.
 */
export interface HorizonEventRecord {
  /** Horizon-assigned unique ID for this event. */
  id: string;
  /** Opaque cursor token used for pagination resumption. */
  paging_token: string;
  /** Ledger sequence number in which the transaction was included. */
  ledger: number;
  /** Hex-encoded SHA-256 hash of the transaction. */
  transaction_hash: string;
  /** Base64-encoded XDR ScVal[] — each element is one topic. */
  topic: string[];
  /**
   * Event data payload.  Horizon returns either:
   *   { xdr: string }  — a single base64-encoded ScVal
   *   string[]         — multiple base64-encoded ScVals (rare)
   */
  value:
    | { xdr: string }
    | string[]
    | Record<string, unknown>;
}

/** Paginated response body from GET /soroban/events */
export interface HorizonEventsPage {
  _embedded: {
    records: HorizonEventRecord[];
  };
}

/** Paginated response body from GET /ledgers */
export interface HorizonLedgersPage {
  _embedded: {
    records: Array<{
      sequence: number;
      closed_at: string;
    }>;
  };
}

// ── Fetch result ──────────────────────────────────────────────────────────────

/** Result of one Horizon page fetch. */
export interface FetchPageResult {
  /** Raw event records for this page. */
  records: HorizonEventRecord[];
  /** Paging token to use for the NEXT page, or null when at the tip. */
  nextCursor: string | null;
  /** Latest ledger sequence known to Horizon. */
  latestLedger: number;
  /** ISO-8601 close timestamp of the latest ledger, for lag calculation. */
  latestLedgerClosedAt: string | null;
}

// ── Configuration ─────────────────────────────────────────────────────────────

/** Runtime configuration for the StreamIndexer. */
export interface IndexerConfig {
  /** Base URL of the Horizon instance to poll. */
  horizonUrl: string;
  /** Soroban contract ID to filter events for. */
  contractId: string;
  /** Milliseconds between poll cycles when there are no errors. */
  pollIntervalMs: number;
  /** Maximum events per page (Horizon cap: 200). */
  pageLimit: number;
  /** Maximum backoff delay in milliseconds (applied on 429/503 errors). */
  maxBackoffMs: number;
  /**
   * Minimum ledgers behind the chain tip required before an event is
   * considered finalised and persisted.
   */
  finalityDepth: number;
  /** TCP port on which the Prometheus /metrics endpoint is served. */
  metricsPort: number;
}
