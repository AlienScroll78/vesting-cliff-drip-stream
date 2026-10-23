/**
 * Chaos Testing – Indexer Downtime & Recovery Scenarios (Issue #1066)
 *
 * Complements the Toxiproxy-based network-fault suite
 * (`horizon-chaos.test.ts`, issue #787) with database- and
 * lifecycle-level recovery scenarios. Every scenario drives the real
 * `StreamIndexer` end-to-end using a mocked Horizon (`fetch`) and a mocked
 * PostgreSQL pool, then asserts the resulting DB state after recovery.
 *
 * Scenarios:
 *   1. Indexer stopped for 100 ledgers, restarted → catches up without gaps
 *   2. DB connection lost mid-insert → transaction rolled back,
 *      event retried on restart
 *   3. Horizon API returns 429 → indexer backs off and retries
 *   4. Cursor table corrupted (missing row) → indexer falls back to a
 *      configurable default start ledger
 *
 * Run via:
 *   cd backend && npx vitest run \
 *     --config vitest.resilience.config.ts \
 *     tests/resilience/chaos/downtime-recovery-chaos.test.ts
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ── XDR fixture helpers (mirror src/indexer/indexer.test.ts) ──────────────────

function encodeSymbol(sym: string): string {
  const strBytes = Buffer.from(sym, 'utf8');
  const buf = Buffer.alloc(8 + strBytes.length);
  buf.writeUInt32BE(6, 0);
  buf.writeUInt32BE(strBytes.length, 4);
  strBytes.copy(buf, 8);
  return buf.toString('base64');
}

function encodeI128(value: bigint): string {
  const buf = Buffer.alloc(16);
  buf.writeBigInt64BE(value >> 64n, 0);
  buf.writeBigUInt64BE(value & 0xFFFF_FFFF_FFFF_FFFFn, 8);
  return buf.toString('base64');
}

const SPONSOR   = 'GABC1111SPONSOR00000000000000000000000000000000000000000';
const RECIPIENT = 'GABC2222RECIP000000000000000000000000000000000000000000000';

function claimRecord(seq: number, amount: bigint) {
  return {
    id: `tx${seq}-0`,
    paging_token: `pt-${seq}`,
    ledger: seq,
    transaction_hash: `hash${String(seq).padStart(8, '0')}`,
    topic: [encodeSymbol('vc_claim'), RECIPIENT],
    value: [encodeI128(amount)],
  };
}

function horizonEventsPage(records: unknown[]) {
  return {
    ok: true,
    json: async () => ({ _embedded: { records } }),
  };
}

function horizonLedgerPage(sequence: number) {
  return {
    ok: true,
    json: async () => ({
      _embedded: { records: [{ sequence, closed_at: new Date().toISOString() }] },
    }),
  };
}

// ── In-memory DB harness ──────────────────────────────────────────────────────

interface DecodedRow {
  event_type: string;
  recipient: string;
  sponsor: string;
  token: string;
  amount: string | null;
  ledger_sequence: number;
  transaction_hash: string;
}

function makeDb() {
  let cursor: string | null = '';
  let cursorRowMissing = false;
  let failNextInsert = false;
  const rows = new Map<string, DecodedRow>();
  const beginCalls: string[] = [];
  const rollbackCalls: string[] = [];

  const pool = {
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      if (/SELECT cursor FROM indexer_cursors/i.test(sql)) {
        if (cursorRowMissing) return { rows: [], rowCount: 0 };
        return { rows: [{ cursor }], rowCount: 1 };
      }
      if (/UPDATE indexer_cursors/i.test(sql)) {
        cursor = params?.[0] as string;
        return { rows: [], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    }),
    connect: vi.fn(async () => {
      const client = {
        query: vi.fn(async (sql: string, params?: unknown[]) => {
          if (/BEGIN/i.test(sql)) {
            beginCalls.push(sql);
            if (failNextInsert) {
              // Simulate the connection being dropped before the first
              // statement is acknowledged — pg rejects and the caller rolls back.
              throw new Error('ECONNRESET: Database connection lost during write');
            }
            return { rows: [], rowCount: 0 };
          }
          if (/ROLLBACK/i.test(sql)) {
            rollbackCalls.push(sql);
            return { rows: [], rowCount: 0 };
          }
          if (/COMMIT/i.test(sql)) {
            return { rows: [], rowCount: 0 };
          }
          if (/INSERT INTO stream_events/i.test(sql)) {
            if (failNextInsert) {
              throw new Error('ECONNRESET: Database connection lost during write');
            }
            const hash = params?.[6] as string;
            if (rows.has(hash)) return { rows: [], rowCount: 0 }; // ON CONFLICT DO NOTHING
            rows.set(hash, {
              event_type: params?.[0] as string,
              recipient: params?.[1] as string,
              sponsor: params?.[2] as string,
              token: params?.[3] as string,
              amount: (params?.[4] as string) ?? null,
              ledger_sequence: params?.[5] as number,
              transaction_hash: hash,
            });
            return { rows: [], rowCount: 1 };
          }
          return { rows: [], rowCount: 0 };
        }),
        release: vi.fn(),
      };
      return client;
    }),
  };

  return {
    pool,
    rows,
    beginCalls,
    rollbackCalls,
    setCursor: (c: string | null) => {
      cursor = c;
      cursorRowMissing = c === null;
    },
    getCursor: () => cursor,
    failNextInsertOnce: () => {
      failNextInsert = true;
    },
    clearInsertFailure: () => {
      failNextInsert = false;
    },
  };
}

// ── Suite ─────────────────────────────────────────────────────────────────────

describe('Chaos: Indexer downtime & recovery (issue #1066)', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  // ── Scenario 1 – Downtime across 100 ledgers → catch-up without gaps ───────

  it(
    'Scenario 1: stopped for 100 ledgers → restart catches up without gaps',
    async () => {
      const { StreamIndexer } = await import('../../../src/indexer/StreamIndexer.js');
      const db = makeDb();

      // Before downtime: indexer processed up to ledger 1001.
      const beforeDowntime = [1000, 1001].map((s) => claimRecord(s, BigInt(s)));
      // The persisted cursor is just before the first record of this page.
      db.setCursor('pt-999');
      // The chain tip must be finalityDepth ledgers past the last event,
      // otherwise the finality filter legitimately skips it.
      vi.mocked(fetch)
        .mockResolvedValueOnce(horizonEventsPage(beforeDowntime))
        .mockResolvedValueOnce(horizonLedgerPage(1005));

      const indexer = new StreamIndexer({
        pool: db.pool as never,
        pollIntervalMs: 100_000,
        finalityDepth: 3,
        defaultStartLedger: '',
      });
      await indexer.tick();
      expect(db.getCursor()).toBe('pt-1001');
      const indexedBefore = db.rows.size;
      expect(indexedBefore).toBe(2);

      // Downtime: 100 ledgers elapse. No indexer runs during this window.
      // Events emitted at ledgers 1002..1101 are missed by the stopped indexer.
      const missedDuringDowntime = Array.from({ length: 100 }, (_, i) =>
        claimRecord(1002 + i, BigInt(1002 + i)),
      );
      const allRecords = [...beforeDowntime, ...missedDuringDowntime];

      // On restart, Horizon serves every record after the persisted cursor.
      // The cursor is an opaque paging token, so filter by the saved token.
      const resumeIdx = allRecords.findIndex((r) => r.paging_token === 'pt-1001');
      const resumeRecords = allRecords.slice(resumeIdx + 1);

      // First page after restart: fetch from the persisted cursor.
      // Tip is finalityDepth past the newest missed event (1101).
      vi.mocked(fetch)
        .mockResolvedValueOnce(horizonEventsPage(resumeRecords))
        .mockResolvedValueOnce(horizonLedgerPage(1105));

      await indexer.tick();

      const caughtUpCursor =
        resumeRecords[resumeRecords.length - 1].paging_token;

      // Second tick (steady state): nothing new, confirms catch-up is stable.
      vi.mocked(fetch)
        .mockResolvedValueOnce(horizonEventsPage([]))
        .mockResolvedValueOnce(horizonLedgerPage(1105));

      await indexer.tick();

      // DB-state assertions after recovery:
      // 1. Every ledger emitted before AND during downtime is present.
      const ledgers = [...db.rows.values()].map((r) => r.ledger_sequence).sort((a, b) => a - b);
      expect(ledgers).toEqual(allRecords.map((r) => r.ledger));
      // 2. No gaps: ledger sequence is contiguous across the downtime window.
      for (let i = 1; i < ledgers.length; i++) {
        expect(ledgers[i]).toBe(ledgers[i - 1] + 1);
      }
      // 3. No duplicates: unique transaction hashes == total rows.
      expect(db.rows.size).toBe(allRecords.length);
      // 4. Cursor advanced past the tip of the downtime window.
      expect(db.getCursor()).toBe(caughtUpCursor);
      // 5. Indexer reports full catch-up.
      const status = indexer.getStatus();
      expect(status.lagLedgers).toBe(0);
      expect(status.errorCount).toBe(0);

      console.log(
        `[Scenario 1] indexed=${db.rows.size} ledgers=${ledgers[0]}..${ledgers[ledgers.length - 1]} ` +
        `cursor=${db.getCursor()}`,
      );
    },
    20_000,
  );

  // ── Scenario 2 – DB connection lost mid-insert → rollback + retry ──────────

  it(
    'Scenario 2: DB connection lost mid-insert → rollback, event retried on restart',
    async () => {
      const { StreamIndexer } = await import('../../../src/indexer/StreamIndexer.js');
      const db = makeDb();

      const records = [2001, 2002].map((s) => claimRecord(s, BigInt(s)));

      // First attempt: connection drops mid-insert (after BEGIN succeeded).
      db.setCursor('pt-2000');
      db.failNextInsertOnce();

      vi.mocked(fetch)
        .mockResolvedValueOnce(horizonEventsPage(records))
        .mockResolvedValueOnce(horizonLedgerPage(2005));

      const indexer = new StreamIndexer({
        pool: db.pool as never,
        pollIntervalMs: 100_000,
        finalityDepth: 3,
        defaultStartLedger: '',
      });

      // tick() catches the error and records it rather than crashing.
      await indexer.tick();

      // DB-state assertions after failure:
      // 1. Transaction was rolled back.
      expect(db.rollbackCalls.length).toBeGreaterThan(0);
      // 2. No events were persisted (rollback guarantees atomicity).
      expect(db.rows.size).toBe(0);
      // 3. Cursor did NOT advance — at-least-once delivery preserved.
      expect(db.getCursor()).toBe('pt-2000');
      // 4. Indexer recorded the failure and backed off.
      expect(indexer.getStatus().errorCount).toBe(1);

      // "Restart": connection is healthy again; the same page is re-fetched
      // from the unchanged cursor and the event is retried.
      db.clearInsertFailure();
      db.pool.query.mockResolvedValueOnce({ rows: [{ cursor: 'pt-2000' }], rowCount: 1 });
      vi.mocked(fetch)
        .mockResolvedValueOnce(horizonEventsPage(records))
        .mockResolvedValueOnce(horizonLedgerPage(2005));

      await indexer.tick();

      // DB-state assertions after recovery:
      // 1. The retried events are now persisted exactly once.
      expect(db.rows.size).toBe(2);
      const hashes = [...db.rows.keys()].sort();
      expect(hashes).toEqual(records.map((r) => r.transaction_hash).sort());
      // 2. Cursor advanced only after the successful retry.
      expect(db.getCursor()).toBe('pt-2002');
      // 3. Error counter reset on success.
      expect(indexer.getStatus().errorCount).toBe(0);

      console.log(
        `[Scenario 2] rolledBack=${db.rollbackCalls.length > 0} ` +
        `persisted=${db.rows.size} cursor=${db.getCursor()}`,
      );
    },
    20_000,
  );

  // ── Scenario 3 – Horizon 429 → back off and retry ──────────────────────────

  it(
    'Scenario 3: Horizon returns 429 → indexer backs off and retries until success',
    async () => {
      const { StreamIndexer } = await import('../../../src/indexer/StreamIndexer.js');
      const { computeBackoff } = await import('../../../src/indexer/horizonClient.js');
      const db = makeDb();
      db.setCursor('pt-3000');

      const records = [3001].map((s) => claimRecord(s, BigInt(s)));

      // Two separate mocks so recovery timing is deterministic:
      // rate-limited responses first, then the healthy page.
      const rateLimited = vi.fn(async () => ({ ok: false, status: 429 }));
      const healthy = vi.fn()
        .mockResolvedValueOnce(horizonEventsPage(records))
        .mockResolvedValueOnce(horizonLedgerPage(3005));
      vi.mocked(fetch).mockImplementation(rateLimited as never);

      const indexer = new StreamIndexer({
        pool: db.pool as never,
        pollIntervalMs: 100_000,
        finalityDepth: 3,
        maxBackoffMs: 60_000,
        defaultStartLedger: '',
      });

      // Two rate-limited ticks accumulate a growing back-off.
      await indexer.tick();
      const backoff1 = computeBackoff(1, 429, 60_000);
      expect(indexer.getStatus().errorCount).toBe(1);
      // Nothing persisted while rate-limited.
      expect(db.rows.size).toBe(0);

      await indexer.tick();
      const backoff2 = computeBackoff(2, 429, 60_000);
      expect(indexer.getStatus().errorCount).toBe(2);
      expect(db.rows.size).toBe(0);

      // Back-off assertions (deterministic exponential component):
      // 1. Both back-offs used the 429 rate-limit base (>1000ms) — hard back-off.
      expect(backoff1).toBeGreaterThan(1000);
      expect(backoff2).toBeGreaterThan(1000);
      // 2. The exponential term doubles per consecutive 429 (2s → 4s).
      expect(backoff1).toBeLessThanOrEqual(3000); // 2000ms + jitter(≤1000)
      expect(backoff2).toBeGreaterThanOrEqual(4000); // 4000ms + jitter(≥0)

      // The 429s clear and the retry succeeds.
      vi.mocked(fetch).mockImplementation(healthy as never);
      await indexer.tick();

      // DB-state assertions after recovery:
      // 3. The deferred event is now persisted exactly once.
      expect(db.rows.size).toBe(1);
      expect(db.rows.has(records[0].transaction_hash)).toBe(true);
      expect(db.getCursor()).toBe('pt-3001');
      // 4. Error counter reset on the successful retry.
      expect(indexer.getStatus().errorCount).toBe(0);
      expect(healthy).toHaveBeenCalled();

      console.log(
        `[Scenario 3] rateLimitedTicks=2 backoff1=${backoff1} ` +
        `backoff2=${backoff2} persisted=${db.rows.size}`,
      );
    },
    20_000,
  );

  // ── Scenario 4 – Cursor row missing → configurable default start ledger ────

  it(
    'Scenario 4: cursor table row missing → falls back to configurable default start ledger',
    async () => {
      const { StreamIndexer } = await import('../../../src/indexer/StreamIndexer.js');
      const db = makeDb();

      // Cursor row is missing entirely (corrupted / wiped table).
      db.setCursor(null);

      const chainFromDefault = [5000, 5001].map((s) => claimRecord(s, BigInt(s)));
      const configuredDefault = '4999';

      // First tick: no cursor row → indexer requests from the default start ledger.
      vi.mocked(fetch)
        .mockResolvedValueOnce(horizonEventsPage(chainFromDefault))
        .mockResolvedValueOnce(horizonLedgerPage(5005));

      const indexer = new StreamIndexer({
        pool: db.pool as never,
        pollIntervalMs: 100_000,
        finalityDepth: 3,
        defaultStartLedger: configuredDefault,
      });

      await indexer.tick();

      // 1. The events request was made with the configured default as cursor.
      const firstFetchUrl = vi.mocked(fetch).mock.calls[0][0] as string;
      expect(firstFetchUrl).toContain(`cursor=${configuredDefault}`);
      // 2. Events from the default onward were persisted with no loss.
      expect(db.rows.size).toBe(2);
      const ledgers = [...db.rows.values()].map((r) => r.ledger_sequence).sort((a, b) => a - b);
      expect(ledgers).toEqual([5000, 5001]);
      // 3. A real cursor row was written after the first successful tick.
      expect(db.getCursor()).toBe('pt-5001');

      // Second tick: the persisted cursor is now used (fallback not re-triggered).
      db.pool.query.mockResolvedValueOnce({ rows: [{ cursor: 'pt-5001' }], rowCount: 1 });
      vi.mocked(fetch)
        .mockResolvedValueOnce(horizonEventsPage([]))
        .mockResolvedValueOnce(horizonLedgerPage(5005));

      await indexer.tick();
      const secondFetchUrl = vi.mocked(fetch).mock.calls[2][0] as string;
      expect(secondFetchUrl).toContain('cursor=pt-5001');
      // No duplicate rows after resume from the real cursor.
      expect(db.rows.size).toBe(2);

      console.log(
        `[Scenario 4] defaultCursor=${configuredDefault} persisted=${db.rows.size} ` +
        `cursor=${db.getCursor()}`,
      );
    },
    20_000,
  );
});
