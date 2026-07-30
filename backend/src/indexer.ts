/**
 * Issue #27 — Event indexer for StreamCreated / StreamCancelled.
 *
 * Polls Horizon for contract events, decodes them, and upserts into
 * PostgreSQL.  Handles:
 *   - Gaps in polling (cursor-based resumption)
 *   - Duplicate protection (upsert by event_id)
 *   - Reorg safety via 3-ledger finality depth
 */

import { Pool } from "pg";
import { networkConfig } from "../config/network.js";

const FINALITY_DEPTH = 3;
const POLL_INTERVAL_MS = parseInt(process.env.INDEXER_POLL_MS ?? "6000", 10);
const PAGE_LIMIT = 200;

// ── DB schema bootstrap ───────────────────────────────────────────────────────

const CREATE_TABLES_SQL = `
CREATE TABLE IF NOT EXISTS indexed_events (
  event_id      TEXT PRIMARY KEY,
  event_type    TEXT NOT NULL,
  ledger        INT  NOT NULL,
  sponsor       TEXT,
  recipient     TEXT NOT NULL,
  token         TEXT,
  rate          BIGINT,
  cliff_ledger  INT,
  end_ledger    INT,
  refund_amount BIGINT,
  raw_value     JSONB,
  indexed_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_events_recipient ON indexed_events (recipient);
CREATE INDEX IF NOT EXISTS idx_events_sponsor   ON indexed_events (sponsor);
CREATE INDEX IF NOT EXISTS idx_events_ledger    ON indexed_events (ledger);

CREATE TABLE IF NOT EXISTS indexer_cursor (
  id     INT PRIMARY KEY DEFAULT 1,
  cursor TEXT NOT NULL DEFAULT ''
);
INSERT INTO indexer_cursor (id, cursor) VALUES (1, '') ON CONFLICT DO NOTHING;
`;

// ── Indexer ───────────────────────────────────────────────────────────────────

export class EventIndexer {
  private pool: Pool;
  private horizonUrl: string;
  private contractId: string;
  private running = false;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(pool?: Pool) {
    this.horizonUrl = process.env.HORIZON_URL ?? "https://horizon-testnet.stellar.org";
    this.contractId = networkConfig.contractId;
    this.pool = pool ?? new Pool({ connectionString: process.env.DATABASE_URL });
  }

  async init(): Promise<void> {
    await this.pool.query(CREATE_TABLES_SQL);
  }

  async start(): Promise<void> {
    await this.init();
    this.running = true;
    this.scheduleNext();
    console.log("[indexer] started");
  }

  stop(): void {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    console.log("[indexer] stopped");
  }

  private scheduleNext(): void {
    this.timer = setTimeout(() => this.tick(), POLL_INTERVAL_MS);
  }

  async tick(): Promise<void> {
    try {
      const cursor = await this.getCursor();
      const { events, lastCursor, latestLedger } = await this.fetchEvents(cursor);

      if (events.length > 0) {
        // Only index events that are at least FINALITY_DEPTH behind the chain tip.
        const finalised = events.filter(
          (e: any) => latestLedger - (e.ledger ?? 0) >= FINALITY_DEPTH
        );
        if (finalised.length > 0) {
          await this.upsertEvents(finalised);
          console.log(`[indexer] upserted ${finalised.length} events`);
        }
      }

      if (lastCursor) await this.saveCursor(lastCursor);
    } catch (err) {
      console.error("[indexer] tick error:", err);
    } finally {
      if (this.running) this.scheduleNext();
    }
  }

  private async fetchEvents(cursor: string): Promise<{
    events: any[];
    lastCursor: string | null;
    latestLedger: number;
  }> {
    const url = new URL(`${this.horizonUrl}/contracts/${this.contractId}/events`);
    url.searchParams.set("limit", String(PAGE_LIMIT));
    url.searchParams.set("order", "asc");
    if (cursor) url.searchParams.set("cursor", cursor);

    const [eventsResp, ledgerResp] = await Promise.all([
      fetch(url.toString()),
      fetch(`${this.horizonUrl}/ledgers?order=desc&limit=1`),
    ]);

    if (!eventsResp.ok) throw new Error(`Horizon responded ${eventsResp.status}`);

    const data: any = await eventsResp.json();
    const ledgerData: any = ledgerResp.ok ? await ledgerResp.json() : {};
    const latestLedger: number =
      ledgerData?._embedded?.records?.[0]?.sequence ?? 0;

    const records: any[] = data._embedded?.records ?? [];
    const lastCursor =
      records.length > 0
        ? (records[records.length - 1].paging_token as string)
        : null;

    return { events: records, lastCursor, latestLedger };
  }

  private async upsertEvents(events: any[]): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      for (const e of events) {
        const topics: string[] = e.topic ?? [];
        const eventType = decodeTopicString(topics[0]) ?? "unknown";
        const parsed = parseEventValue(eventType, topics, e.value);

        await client.query(
          `INSERT INTO indexed_events
             (event_id, event_type, ledger, sponsor, recipient, token,
              rate, cliff_ledger, end_ledger, refund_amount, raw_value)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
           ON CONFLICT (event_id) DO NOTHING`,
          [
            e.id,
            eventType,
            e.ledger ?? 0,
            parsed.sponsor ?? null,
            parsed.recipient ?? "",
            parsed.token ?? null,
            parsed.rate ?? null,
            parsed.cliff_ledger ?? null,
            parsed.end_ledger ?? null,
            parsed.refund_amount ?? null,
            JSON.stringify(e),
          ]
        );
      }

      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  private async getCursor(): Promise<string> {
    const result = await this.pool.query(
      "SELECT cursor FROM indexer_cursor WHERE id = 1"
    );
    return result.rows[0]?.cursor ?? "";
  }

  private async saveCursor(cursor: string): Promise<void> {
    await this.pool.query(
      "UPDATE indexer_cursor SET cursor = $1 WHERE id = 1",
      [cursor]
    );
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function decodeTopicString(topicXdr: string | undefined): string | null {
  if (!topicXdr) return null;
  // Topics are hex-encoded ScVal symbol strings; attempt a simple decode.
  try {
    const buf = Buffer.from(topicXdr, "base64");
    // ScVal symbol: type byte 0x0e + length + bytes
    const text = buf.toString("utf8").replace(/[^\x20-\x7e]/g, "");
    return text.trim() || null;
  } catch {
    return topicXdr;
  }
}

function parseEventValue(
  eventType: string,
  topics: string[],
  value: any
): Record<string, any> {
  // Best-effort decode; raw_value stored for full fidelity.
  if (eventType.includes("stream_created")) {
    return {
      sponsor: topics[1] ?? null,
      recipient: topics[2] ?? "",
      token: value?.fields?.[0] ?? null,
      rate: value?.fields?.[1] ?? null,
      cliff_ledger: value?.fields?.[3] ?? null,
      end_ledger: value?.fields?.[4] ?? null,
    };
  }
  if (eventType.includes("stream_cancelled")) {
    return {
      recipient: topics[1] ?? "",
      refund_amount: value?.fields?.[0] ?? null,
    };
  }
  return { recipient: topics[1] ?? "" };
}

// ── Singleton startup helper ──────────────────────────────────────────────────

let _indexer: EventIndexer | null = null;

export function startIndexer(): EventIndexer {
  if (!_indexer) {
    _indexer = new EventIndexer();
    _indexer.start().catch((err) => {
      console.error("[indexer] startup failed:", err);
    });
  }
  return _indexer;
}
