/**
 * scripts/backfill_stream_events.1014.test.ts
 *
 * Issue #1014 — event replay / decoder-fix backfill procedure.
 *
 * Covers the acceptance criteria that were missing from the original script:
 *   - `npm run backfill -- --start-ledger N --end-ledger M` CLI surface
 *   - `--event-type` filtering
 *   - existing events are UPDATED (not duplicated, not ignored) via upsert
 *   - `--dry-run` previews changes without writing
 *   - post-backfill reconciliation runs automatically
 *   - Horizon retention-window detection
 *
 * fetch() and the pg pool are mocked, so no database or Horizon is needed.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  parseArgs,
  resolveOptions,
  parseEventTypes,
  upsertEvents,
  reconcile,
  runReconciliationJob,
  run,
  type CliOptions,
} from "./backfill_stream_events.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function encodeSymbol(value: string): string {
  const tag = Buffer.from([0x00, 0x00, 0x00, 0x06]);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(value.length, 0);
  return Buffer.concat([tag, len, Buffer.from(value, "utf8")]).toString("base64");
}

function makeRecord(eventType: string, ledger: number, txHash: string): any {
  return {
    id: `${txHash}-0`,
    paging_token: `${ledger}-0`,
    transaction_hash: txHash,
    ledger,
    topic: [encodeSymbol(eventType), "GABC"],
    value: {},
  };
}

/** Minimal fake pg pool that records every query it is handed. */
function makeFakePool(opts: {
  upsertWasInserted?: boolean[];
  queryRows?: Record<string, any[]>;
} = {}) {
  const queries: { text: string; values?: unknown[] }[] = [];
  const releases: number[] = [];

  const rowsFor = (text: string) => {
    if (/COUNT\(\*\)::int AS cnt\s+FROM stream_events_dlq/is.test(text)) {
      return opts.queryRows?.dlq ?? [{ cnt: 0 }];
    }
    if (/GROUP BY event_type/is.test(text)) {
      return opts.queryRows?.counts ?? [{ event_type: "vc_claim", cnt: 3, min_ledger: 100 }];
    }
    if (/DISTINCT ledger_sequence/is.test(text)) {
      return opts.queryRows?.ledgers ?? [{ ledger: 100 }, { ledger: 101 }, { ledger: 102 }];
    }
    return [];
  };

  let upsertIndex = 0;
  const client = {
    query: vi.fn(async (text: string, values?: unknown[]) => {
      queries.push({ text, values });
      if (/RETURNING \(xmax = 0\)/i.test(text)) {
        const wasInserted = opts.upsertWasInserted?.[upsertIndex++] ?? true;
        return { rowCount: 1, rows: [{ was_inserted: wasInserted }] };
      }
      if (/^\s*(BEGIN|COMMIT|ROLLBACK)/i.test(text)) return { rowCount: null, rows: [] };
      return { rowCount: 1, rows: rowsFor(text) };
    }),
    release: vi.fn(() => releases.push(1)),
  };

  const pool = {
    connect: vi.fn(async () => client),
    query: vi.fn(async (text: string, values?: unknown[]) => {
      queries.push({ text, values });
      return { rowCount: 1, rows: rowsFor(text) };
    }),
    end: vi.fn(async () => {}),
  };

  return { pool: pool as any, queries, releases };
}

// ── CLI surface ───────────────────────────────────────────────────────────────

describe("#1014 — CLI arguments", () => {
  it("accepts --start-ledger / --end-ledger (the documented npm run backfill form)", () => {
    const opts = parseArgs(["--start-ledger", "5000000", "--end-ledger", "5100000"]);
    expect(opts.fromLedger).toBe(5000000);
    expect(opts.toLedger).toBe(5100000);
    expect(opts.dryRun).toBe(false);
  });

  it("still accepts the legacy --from-ledger / --to-ledger aliases", () => {
    const opts = parseArgs(["--from-ledger", "100", "--to-ledger", "200"]);
    expect(opts.fromLedger).toBe(100);
    expect(opts.toLedger).toBe(200);
  });

  it("parses --dry-run and --no-reconcile", () => {
    const opts = parseArgs([
      "--start-ledger", "1", "--end-ledger", "2", "--dry-run", "--no-reconcile",
    ]);
    expect(opts.dryRun).toBe(true);
    expect(opts.reconcile).toBe(false);
  });

  it("defaults reconciliation to on", () => {
    expect(parseArgs(["--start-ledger", "1", "--end-ledger", "2"]).reconcile).toBe(true);
  });

  it("rejects a non-positive ledger", () => {
    const exit = vi.spyOn(process, "exit").mockImplementation((() => {}) as never);
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    parseArgs(["--start-ledger", "0", "--end-ledger", "10"]);
    expect(exit).toHaveBeenCalledWith(1);
    exit.mockRestore();
    err.mockRestore();
  });

  it("lets env vars supply the range when flags are absent", () => {
    const opts = resolveOptions([], {
      BACKFILL_FROM_LEDGER: "42",
      BACKFILL_TO_LEDGER: "99",
      BACKFILL_DRY_RUN: "1",
    } as NodeJS.ProcessEnv);
    expect(opts.fromLedger).toBe(42);
    expect(opts.toLedger).toBe(99);
    expect(opts.dryRun).toBe(true);
  });

  it("gives CLI flags priority over env vars", () => {
    const opts = resolveOptions(["--start-ledger", "7", "--end-ledger", "8"], {
      BACKFILL_FROM_LEDGER: "1000",
      BACKFILL_TO_LEDGER: "2000",
    } as NodeJS.ProcessEnv);
    expect(opts.fromLedger).toBe(7);
    expect(opts.toLedger).toBe(8);
  });

  it("honours BACKFILL_SKIP_RECONCILE=1", () => {
    const opts = resolveOptions(["--start-ledger", "1", "--end-ledger", "2"], {
      BACKFILL_SKIP_RECONCILE: "1",
    } as NodeJS.ProcessEnv);
    expect(opts.reconcile).toBe(false);
  });
});

// ── --event-type ──────────────────────────────────────────────────────────────

describe("#1014 — --event-type filtering", () => {
  it("parses a single event type", () => {
    expect([...parseEventTypes(["vc_claim"])]).toEqual(["vc_claim"]);
  });

  it("parses comma-separated and repeated values", () => {
    expect(new Set(parseEventTypes(["vc_claim,vc_create", "vc_drain"]))).toEqual(
      new Set(["vc_claim", "vc_create", "vc_drain"])
    );
  });

  it("accepts the flag multiple times via parseArgs", () => {
    const opts = parseArgs([
      "--start-ledger", "1", "--end-ledger", "2",
      "--event-type", "vc_claim", "--event-type", "vc_cancel",
    ]);
    expect(opts.eventTypes).toEqual(new Set(["vc_claim", "vc_cancel"]));
  });

  it("rejects an unknown event type", () => {
    const exit = vi.spyOn(process, "exit").mockImplementation((() => {}) as never);
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    parseEventTypes(["bogus"]);
    expect(exit).toHaveBeenCalledWith(1);
    expect(err).toHaveBeenCalledWith(expect.stringContaining("--event-type must be one of"));
    exit.mockRestore();
    err.mockRestore();
  });

  it("defaults to every event type when the flag is omitted", () => {
    expect(parseArgs(["--start-ledger", "1", "--end-ledger", "2"]).eventTypes.size).toBe(0);
  });

  it("reads BACKFILL_EVENT_TYPES from the environment", () => {
    const opts = resolveOptions(["--start-ledger", "1", "--end-ledger", "2"], {
      BACKFILL_EVENT_TYPES: "vc_done,vc_claim",
    } as NodeJS.ProcessEnv);
    expect(opts.eventTypes).toEqual(new Set(["vc_done", "vc_claim"]));
  });
});

// ── Upsert (update, not duplicate) ─────────────────────────────────────────────

describe("#1014 — upsert updates existing rows instead of duplicating them", () => {
  const event = {
    event_type: "vc_claim" as const,
    recipient: "GABC",
    sponsor: null,
    token: null,
    amount: 500n,
    ledger_sequence: 12345,
    tx_hash: "deadbeef",
  };

  it("uses ON CONFLICT (tx_hash) DO UPDATE with the fresh decoded values", async () => {
    const { pool, queries } = makeFakePool();
    await upsertEvents([event], pool);

    const sql = queries.map((q) => q.text).join("\n");
    expect(sql).toContain("ON CONFLICT (tx_hash) DO UPDATE");
    expect(sql).toContain("event_type      = EXCLUDED.event_type");
    expect(sql).toContain("amount          = EXCLUDED.amount");
    // Must NOT silently ignore conflicts — that is the decoder-fix bug.
    expect(sql).not.toContain("DO NOTHING");
  });

  it("reports inserts and updates separately", async () => {
    const { pool } = makeFakePool({ upsertWasInserted: [false, true] });
    const result = await upsertEvents(
      [event, { ...event, tx_hash: "cafebabe", event_type: "vc_create" }],
      pool
    );
    expect(result).toEqual({ inserted: 1, updated: 1 });
  });

  it("counts a replayed row as an update, which is what repairs stale decodes", async () => {
    const { pool } = makeFakePool({ upsertWasInserted: [false] });
    const result = await upsertEvents([event], pool);
    expect(result.updated).toBe(1);
    expect(result.inserted).toBe(0);
  });

  it("returns zero counts for an empty batch without touching the pool", async () => {
    const { pool } = makeFakePool();
    expect(await upsertEvents([], pool)).toEqual({ inserted: 0, updated: 0 });
    expect(pool.connect).not.toHaveBeenCalled();
  });

  it("skips rows without a tx_hash rather than crashing the batch", async () => {
    const { pool, queries } = makeFakePool({ upsertWasInserted: [true] });
    const result = await upsertEvents([event, { ...event, tx_hash: "" }], pool);
    expect(queries.filter((q) => /INSERT INTO stream_events/i.test(q.text))).toHaveLength(1);
    expect(result.inserted).toBe(1);
  });

  it("wraps the batch in a transaction", async () => {
    const { pool, queries } = makeFakePool();
    await upsertEvents([event], pool);
    const sql = queries.map((q) => q.text.trim());
    expect(sql[0]).toMatch(/^BEGIN/i);
    expect(sql[sql.length - 1]).toMatch(/^COMMIT/i);
  });
});

// ── Reconciliation ────────────────────────────────────────────────────────────

describe("#1014 — post-backfill reconciliation", () => {
  it("counts rows, breaks them down by type, and reports OK", async () => {
    const { pool } = makeFakePool({
      queryRows: {
        counts: [{ event_type: "vc_claim", cnt: 3, min_ledger: 100 }],
        ledgers: [{ ledger: 100 }, { ledger: 101 }, { ledger: 102 }],
        dlq: [{ cnt: 0 }],
      },
    });
    const report = await reconcile(100, 102, pool);

    expect(report.dbRowCount).toBe(3);
    expect(report.eventTypeCounts).toEqual({ vc_claim: 3 });
    expect(report.gaps).toEqual([]);
    expect(report.dlqOpen).toBe(0);
    expect(report.ok).toBe(true);
  });

  it("detects ledger gaps inside the backfilled range", async () => {
    const { pool } = makeFakePool({
      queryRows: {
        counts: [{ event_type: "vc_claim", cnt: 2, min_ledger: 100 }],
        ledgers: [{ ledger: 100 }, { ledger: 102 }], // 101 missing
        dlq: [{ cnt: 0 }],
      },
    });
    const report = await reconcile(100, 102, pool);
    expect(report.gaps).toContain(101);
    expect(report.ok).toBe(true); // gaps alone don't fail the run
  });

  it("flags a run as needing attention when the DLQ has fresh entries", async () => {
    const { pool } = makeFakePool({
      queryRows: {
        counts: [{ event_type: "vc_claim", cnt: 1, min_ledger: 100 }],
        ledgers: [{ ledger: 100 }],
        dlq: [{ cnt: 4 }],
      },
    });
    const report = await reconcile(100, 100, pool);
    expect(report.dlqOpen).toBe(4);
    expect(report.ok).toBe(false);
  });

  it("flags a run as needing attention when nothing was written", async () => {
    const { pool } = makeFakePool({ queryRows: { counts: [], dlq: [{ cnt: 0 }] } });
    const report = await reconcile(100, 200, pool);
    expect(report.dbRowCount).toBe(0);
    expect(report.ok).toBe(false);
  });

  it("prints the reconciliation summary", async () => {
    const lines: string[] = [];
    await runReconciliationJob(
      {
        ledgerRange: { from: 100, to: 102 },
        dbRowCount: 3,
        eventTypeCounts: { vc_claim: 3 },
        dlqOpen: 0,
        gaps: [],
        ok: true,
      },
      (l) => lines.push(l),
      (l) => lines.push(`WARN ${l}`)
    );
    const output = lines.join("\n");
    expect(output).toContain("Reconciliation");
    expect(output).toContain("rows in range: 3");
    expect(output).toContain("vc_claim");
    expect(output).toContain("status       : OK");
  });
});

// ── End-to-end run ────────────────────────────────────────────────────────────

describe("#1014 — run() end to end", () => {
  const baseOptions: CliOptions = {
    fromLedger: 100,
    toLedger: 102,
    eventTypes: new Set(),
    dryRun: true,
    reconcile: false,
    help: false,
  };

  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          _embedded: {
            records: [
              makeRecord("vc_create", 100, "aaa"),
              makeRecord("vc_claim", 101, "bbb"),
              makeRecord("unknown_thing", 102, "ccc"),
            ],
          },
        }),
      })
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("dry-run previews decoded events and performs no writes", async () => {
    const { pool, queries } = makeFakePool();
    const logs: string[] = [];

    const summary = await run(baseOptions, {
      horizonUrl: "https://horizon",
      contractId: "CTEST",
      pool,
      log: (l) => logs.push(l),
      warn: (l) => logs.push(`WARN ${l}`),
    });

    expect(summary.fetched).toBe(3);
    expect(summary.skipped).toBe(1); // the unknown event type
    expect(summary.inserted).toBe(0);
    expect(summary.updated).toBe(0);

    // Critically: no INSERT/UPDATE queries at all during a dry run.
    const wrote = queries.filter((q) => /INSERT INTO stream_events\b/i.test(q.text));
    expect(wrote).toHaveLength(0);
    expect(logs.join("\n")).toContain("[dry-run]");
  });

  it("applies the --event-type filter during the run", async () => {
    const { pool } = makeFakePool();
    const summary = await run(
      { ...baseOptions, eventTypes: new Set(["vc_claim"]) },
      { horizonUrl: "https://horizon", contractId: "CTEST", pool, log: () => {} }
    );
    expect(summary.skipped).toBe(2); // vc_create + unknown
  });

  it("writes through the upsert when not in dry-run mode", async () => {
    const { pool, queries } = makeFakePool({ upsertWasInserted: [true, true] });
    const summary = await run(
      { ...baseOptions, dryRun: false, reconcile: false },
      {
        horizonUrl: "https://horizon",
        contractId: "CTEST",
        databaseUrl: "postgres://fake",
        pool,
        log: () => {},
      }
    );

    expect(summary.inserted).toBe(2);
    expect(queries.some((q) => /ON CONFLICT \(tx_hash\) DO UPDATE/i.test(q.text))).toBe(true);
  });

  it("runs reconciliation automatically after a real backfill", async () => {
    const { pool, queries } = makeFakePool({ upsertWasInserted: [true, true] });
    const logs: string[] = [];

    await run(
      { ...baseOptions, dryRun: false, reconcile: true },
      {
        horizonUrl: "https://horizon",
        contractId: "CTEST",
        databaseUrl: "postgres://fake",
        pool,
        log: (l) => logs.push(l),
      }
    );

    expect(logs.join("\n")).toContain("Reconciliation");
    expect(queries.some((q) => /GROUP BY event_type/i.test(q.text))).toBe(true);
  });

  it("skips reconciliation when --no-reconcile is passed", async () => {
    const { pool, queries } = makeFakePool({ upsertWasInserted: [true] });
    const logs: string[] = [];

    await run(
      { ...baseOptions, dryRun: false, reconcile: false },
      {
        horizonUrl: "https://horizon",
        contractId: "CTEST",
        databaseUrl: "postgres://fake",
        pool,
        log: (l) => logs.push(l),
      }
    );

    expect(logs.join("\n")).not.toContain("Reconciliation");
    expect(queries.some((q) => /GROUP BY event_type/i.test(q.text))).toBe(false);
  });

  it("flags a truncated run when Horizon no longer holds the start of the range", async () => {
    const { pool } = makeFakePool();
    const warnings: string[] = [];

    const summary = await run(
      { ...baseOptions, fromLedger: 1, toLedger: 102 },
      {
        horizonUrl: "https://horizon",
        contractId: "CTEST",
        pool,
        log: () => {},
        warn: (l) => warnings.push(l),
      }
    );

    expect(summary.truncated).toBe(true);
    expect(warnings.join("\n")).toContain("retention");
  });

  it("reports the resume cursor so an interrupted run can continue", async () => {
    // A full page with more to come, then a short second page.
    let call = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async () => {
        call++;
        const records =
          call === 1
            ? Array.from({ length: 200 }, (_, i) => makeRecord("vc_claim", 101, `t${i}`))
            : [makeRecord("vc_claim", 102, "last")];
        return { ok: true, json: async () => ({ _embedded: { records } }) };
      })
    );

    const { pool } = makeFakePool();
    const summary = await run(
      { ...baseOptions, fromLedger: 100, toLedger: 102 },
      {
        horizonUrl: "https://horizon",
        contractId: "CTEST",
        pool,
        pageLimit: 200,
        log: () => {},
      }
    );

    expect(summary.pages).toBe(2);
    expect(summary.fetched).toBe(201);
  });
});
