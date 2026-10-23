/**
 * backend/src/indexer/horizonClient.ts
 *
 * Thin wrapper around the Horizon /soroban/events and /ledgers REST endpoints.
 *
 * Responsibilities:
 *   - Build and execute paginated requests to Horizon
 *   - Surface HTTP errors with a typed `.status` property so callers
 *     can distinguish 429/503 (backoff) from other failures
 *   - Provide the `computeBackoff` helper used by the polling loop
 *
 * This module deliberately contains NO retry logic — retries are the
 * responsibility of the StreamIndexer polling loop so they interleave
 * cleanly with cursor management and metrics.
 */

import type {
  FetchPageResult,
  HorizonEventRecord,
  HorizonEventsPage,
  HorizonLedgersPage,
} from './types.js';

// ── HTTP error ────────────────────────────────────────────────────────────────

/** Error subclass that carries the HTTP status code for backoff decisions. */
export class HorizonHttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'HorizonHttpError';
  }
}

// ── Horizon event fetch ───────────────────────────────────────────────────────

/**
 * Fetch one page of Soroban contract events from Horizon.
 *
 * Uses the `/soroban/events` endpoint with:
 *   - `contract_id` filter (the deployed vesting contract)
 *   - `event_type=contract` to exclude system events
 *   - ascending order for deterministic pagination
 *   - opaque `cursor` for resumption
 *
 * @param horizonUrl  Base URL, e.g. "https://horizon-testnet.stellar.org"
 * @param contractId  Deployed contract Strkey (C…)
 * @param cursor      Horizon paging_token from which to start (empty = genesis)
 * @param pageLimit   Maximum records per page (Horizon cap: 200)
 */
export async function fetchEventsPage(
  horizonUrl: string,
  contractId: string,
  cursor: string,
  pageLimit: number,
): Promise<FetchPageResult> {
  const url = buildEventsUrl(horizonUrl, contractId, cursor, pageLimit);

  const [eventsResp, ledgerResp] = await Promise.all([
    fetch(url),
    fetchLatestLedger(horizonUrl),
  ]);

  if (!eventsResp.ok) {
    throw new HorizonHttpError(
      eventsResp.status,
      `Horizon /soroban/events responded HTTP ${eventsResp.status}`,
    );
  }

  const body = (await eventsResp.json()) as HorizonEventsPage;
  const records: HorizonEventRecord[] = body._embedded?.records ?? [];

  const nextCursor =
    records.length > 0
      ? (records[records.length - 1].paging_token ?? null)
      : null;

  return {
    records,
    nextCursor,
    latestLedger: ledgerResp.sequence,
    latestLedgerClosedAt: ledgerResp.closedAt,
  };
}

// ── Latest ledger ─────────────────────────────────────────────────────────────

/**
 * Fetch the latest ledger sequence and close timestamp from Horizon.
 * Returns `{ sequence: 0, closedAt: null }` when the request fails so the
 * caller can continue operating in a degraded state.
 */
export async function fetchLatestLedger(
  horizonUrl: string,
): Promise<{ sequence: number; closedAt: string | null }> {
  try {
    const resp = await fetch(`${horizonUrl}/ledgers?order=desc&limit=1`);
    if (!resp.ok) return { sequence: 0, closedAt: null };

    const body = (await resp.json()) as HorizonLedgersPage;
    const record = body._embedded?.records?.[0];
    return {
      sequence: record?.sequence ?? 0,
      closedAt: record?.closed_at ?? null,
    };
  } catch {
    return { sequence: 0, closedAt: null };
  }
}

// ── Backoff ───────────────────────────────────────────────────────────────────

/**
 * Compute an exponential backoff delay (with ±1 s jitter).
 *
 * - 429 / 503 / 504 responses use a 2 000 ms base (Horizon rate-limit /
 *   overload — back off harder).
 * - All other errors use a 1 000 ms base.
 * - The delay is capped at `maxMs`.
 *
 * @param attempt   1-based attempt counter (resets to 0 on success)
 * @param httpStatus HTTP status code of the failing response, if known
 * @param maxMs     Hard ceiling on the returned delay
 */
export function computeBackoff(
  attempt: number,
  httpStatus: number | undefined,
  maxMs: number,
): number {
  const isHeavyError =
    httpStatus === 429 || httpStatus === 503 || httpStatus === 504;
  const baseMs = isHeavyError ? 2_000 : 1_000;
  const exponent = Math.min(attempt - 1, 6); // cap at 2^6 = 64×
  const exponential = baseMs * Math.pow(2, exponent);
  const jitter = Math.random() * 1_000;
  return Math.min(exponential + jitter, maxMs);
}

// ── URL builder (exported for testing) ───────────────────────────────────────

/** Build the full Horizon events request URL. */
export function buildEventsUrl(
  horizonUrl: string,
  contractId: string,
  cursor: string,
  pageLimit: number,
): string {
  const url = new URL(`${horizonUrl}/soroban/events`);
  url.searchParams.set('contract_id', contractId);
  url.searchParams.set('event_type', 'contract');
  url.searchParams.set('order', 'asc');
  url.searchParams.set('limit', String(pageLimit));
  if (cursor) url.searchParams.set('cursor', cursor);
  return url.toString();
}
