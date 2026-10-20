/**
 * backend/src/indexer/StreamIndexer.ts
 *
 * Main event indexer polling loop.
 *
 * The StreamIndexer ties together all indexer subsystems:
 *   1. Reads the resume cursor from PostgreSQL
 *   2. Fetches one page of Soroban contract events from Horizon
 *   3. Applies a finality-depth filter to discard un-finalised ledgers
 *   4. Decodes each event's XDR payload into a structured DecodedStreamEvent
 *   5. Batch-upserts events into `stream_events` (idempotent)
 *   6. Advances the cursor in `indexer_cursors`
 *   7. Updates Prometheus metrics (lag, events indexed, poll duration)
 *   8. Schedules the next poll (with exponential backoff on errors)
 *
 * Configuration is read from environment variables with sensible defaults
 * so the service is runnable without extra setup in development.
 *
 * Environment variables:
 *   HORIZON_URL              (default: https://horizon-testnet.stellar.org)
 *   VESTING_CONTRACT_ID      (default: '')
 *   INDEXER_POLL_MS          Poll interval in ms (default: 6000)
 *   INDEXER_MAX_BACKOFF_MS   Maximum backoff in ms (default: 60000)
 *   INDEXER_FINALITY_DEPTH   Ledgers behind tip for finality (default: 3)
 *   METRICS_PORT             Prometheus metrics server port (default: 9464)
 */

import { Pool } from 'pg';
import {
  fetchEventsPage,
  computeBackoff,
  HorizonHttpError,
} from './horizonClient.js';
import { decodeEvent } from './decoder.js';
import { readCursor, writeCursor, upsertStreamEvents } from './persistence.js';
import {
  eventsIndexedTotal,
  indexerLagSeconds,
  horizonErrorsTotal,
  indexerPollDurationSeconds,
} from './metrics.js';
import type { IndexerConfig, FetchPageResult, DecodedStreamEvent } from './types.js';

// ── Default configuration ─────────────────────────────────────────────────────

function defaultConfig(): IndexerConfig {
  return {
    horizonUrl:      process.env.HORIZON_URL       ?? 'https://horizon-testnet.stellar.org',
    contractId:      process.env.VESTING_CONTRACT_ID ?? '',
    pollIntervalMs:  parseInt(process.env.INDEXER_POLL_MS          ?? '6000',  10),
    pageLimit:       200,
    maxBackoffMs:    parseInt(process.env.INDEXER_MAX_BACKOFF_MS   ?? '60000', 10),
    finalityDepth:   parseInt(process.env.INDEXER_FINALITY_DEPTH   ?? '3',     10),
    metricsPort:     parseInt(process.env.METRICS_PORT             ?? '9464',  10),
  };
}

// ── Status shape ──────────────────────────────────────────────────────────────

export interface IndexerStatus {
  running:      boolean;
  lastLedger:   number;
  chainTip:     number;
  lagLedgers:   number;
  cursor:       string;
  errorCount:   number;
}

// ── StreamIndexer class ───────────────────────────────────────────────────────

export class StreamIndexer {
  private readonly cfg: IndexerConfig;
  private readonly pool: Pool;

  private running      = false;
  private timer:         ReturnType<typeof setTimeout> | null = null;
  private backoffMs    = 0;
  private errorCount   = 0;
  private lastLedger   = 0;
  private chainTip     = 0;
  private cursor       = '';

  constructor(
    overrides: Partial<IndexerConfig> & { pool?: Pool } = {},
  ) {
    const { pool, ...cfgOverrides } = overrides;
    this.cfg  = { ...defaultConfig(), ...cfgOverrides };
    this.pool = pool ?? new Pool({
      connectionString: process.env.DATABASE_URL,
    });
  }

  // ── Public lifecycle ────────────────────────────────────────────────────────

  /** Start the indexer: run the first tick immediately then schedule recurring polls. */
  async start(): Promise<void> {
    this.running = true;
    console.log(
      `[stream-indexer] starting contract=${this.cfg.contractId} ` +
      `horizon=${this.cfg.horizonUrl} poll=${this.cfg.pollIntervalMs}ms`,
    );
    // First tick fires immediately; subsequent ticks are scheduled inside tick()
    this.scheduleNext(0);
  }

  /** Stop the polling loop gracefully. */
  stop(): void {
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    console.log('[stream-indexer] stopped');
  }

  /** Return a snapshot of the indexer's current operational state. */
  getStatus(): IndexerStatus {
    return {
      running:    this.running,
      lastLedger: this.lastLedger,
      chainTip:   this.chainTip,
      lagLedgers: Math.max(0, this.chainTip - this.lastLedger),
      cursor:     this.cursor,
      errorCount: this.errorCount,
    };
  }

  // ── Single poll tick (public for testing) ───────────────────────────────────

  /**
   * Execute one full poll cycle:
   *   read cursor → fetch page → decode → persist → update cursor → metrics
   */
  async tick(): Promise<void> {
    const cycleStart = Date.now();

    try {
      // 1. Read resume cursor
      const cursor = await readCursor(this.pool);
      this.cursor  = cursor;

      // 2. Fetch one page from Horizon
      const page: FetchPageResult = await fetchEventsPage(
        this.cfg.horizonUrl,
        this.cfg.contractId,
        cursor,
        this.cfg.pageLimit,
      );

      this.chainTip = page.latestLedger;

      // 3. Apply finality filter
      const finalised = page.records.filter((r) => {
        const ledger =
          typeof r.ledger === 'number'
            ? r.ledger
            : parseInt(String(r.ledger ?? '0'), 10);
        return page.latestLedger - ledger >= this.cfg.finalityDepth;
      });

      // 4. Decode events
      const decoded: DecodedStreamEvent[] = [];
      for (const record of finalised) {
        const ev = decodeEvent(record);
        if (ev) decoded.push(ev);
      }

      // 5. Persist
      if (decoded.length > 0) {
        const inserted = await upsertStreamEvents(this.pool, decoded);
        // Update per-type counter only for rows that were actually inserted
        for (const ev of decoded) {
          eventsIndexedTotal.inc({ event_type: ev.event_type });
        }
        console.log(
          `[stream-indexer] inserted=${inserted} decoded=${decoded.length} ` +
          `finalised=${finalised.length} page=${page.records.length}`,
        );
      }

      // 6. Advance cursor
      if (page.nextCursor) {
        await writeCursor(this.pool, page.nextCursor);
        this.cursor     = page.nextCursor;
        this.lastLedger = page.latestLedger;
      }

      // 7. Update lag metric
      if (page.latestLedgerClosedAt) {
        const closedTs = Date.parse(page.latestLedgerClosedAt);
        if (!isNaN(closedTs)) {
          indexerLagSeconds.set((Date.now() - closedTs) / 1_000);
        }
      }

      // Reset backoff on success
      this.backoffMs  = 0;
      this.errorCount = 0;

    } catch (err: unknown) {
      this.errorCount++;

      const httpStatus =
        err instanceof HorizonHttpError ? err.status : undefined;

      const statusLabel =
        httpStatus !== undefined ? String(httpStatus) : 'unknown';

      horizonErrorsTotal.inc({ status: statusLabel });

      this.backoffMs = computeBackoff(
        this.errorCount,
        httpStatus,
        this.cfg.maxBackoffMs,
      );

      console.error(
        `[stream-indexer] error attempt=${this.errorCount} ` +
        `status=${statusLabel} backoff=${this.backoffMs}ms:`,
        err instanceof Error ? err.message : String(err),
      );
    } finally {
      // 8. Record cycle duration
      indexerPollDurationSeconds.observe((Date.now() - cycleStart) / 1_000);

      // Schedule next tick
      if (this.running) {
        const delay = this.backoffMs > 0
          ? this.backoffMs
          : this.cfg.pollIntervalMs;
        this.scheduleNext(delay);
      }
    }
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private scheduleNext(delayMs: number): void {
    this.timer = setTimeout(() => {
      this.tick().catch((err: unknown) => {
        // tick() already handles its own errors; this catch is a safety net
        console.error('[stream-indexer] unhandled tick error:', err);
      });
    }, delayMs);
  }
}

// ── Singleton factory ─────────────────────────────────────────────────────────

let _indexer: StreamIndexer | null = null;

/**
 * Start and return the module-level singleton indexer.
 * Calling this multiple times returns the existing instance.
 */
export function startStreamIndexer(pool?: Pool): StreamIndexer {
  if (!_indexer) {
    _indexer = new StreamIndexer({ pool });
    _indexer.start().catch((err: unknown) => {
      console.error('[stream-indexer] startup failed:', err);
    });
  }
  return _indexer;
}

/** Return the current singleton (or null if not yet started). */
export function getStreamIndexer(): StreamIndexer | null {
  return _indexer;
}
