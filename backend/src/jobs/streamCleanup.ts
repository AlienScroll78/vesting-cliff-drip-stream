/**
 * Issue 2: Stream cleanup cron job
 * Nightly job that archives completed/cancelled stream records older than 1 year
 * from the hot table to a cold-storage archive table, then deletes from hot.
 * Runs at 02:00 UTC daily. Can also be triggered manually via the admin API.
 */

import cron from "node-cron";

// ---------------------------------------------------------------------------
// DB abstraction — replace with your actual DB client (pg, Prisma, etc.)
// ---------------------------------------------------------------------------

interface StreamRecord {
  id: string;
  status: "completed" | "cancelled";
  updatedAt: Date;
}

/** Stub: fetch stale completed/cancelled streams from the hot table. */
async function fetchStaleStreams(olderThanMs: number): Promise<StreamRecord[]> {
  void olderThanMs;
  // SELECT * FROM streams WHERE status IN ('completed','cancelled')
  //   AND updated_at < NOW() - INTERVAL '1 year'
  return [];
}

/** Stub: insert rows into cold-storage table. */
async function archiveStreams(rows: StreamRecord[]): Promise<void> {
  void rows;
  // INSERT INTO streams_archive SELECT * FROM streams WHERE id = ANY($1)
}

/** Stub: delete rows from hot table by ID. */
async function deleteStreams(ids: string[]): Promise<void> {
  void ids;
  // DELETE FROM streams WHERE id = ANY($1)
}

// ---------------------------------------------------------------------------
// Core cleanup logic (exported so admin API can trigger it manually)
// ---------------------------------------------------------------------------

const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;

export interface CleanupResult {
  rowsArchived: number;
  durationMs: number;
}

export async function runStreamCleanup(): Promise<CleanupResult> {
  const start = Date.now();
  console.log("[cleanup] Starting stream archival job");

  const stale = await fetchStaleStreams(ONE_YEAR_MS);

  if (stale.length === 0) {
    const durationMs = Date.now() - start;
    console.log(`[cleanup] No stale streams found (${durationMs}ms)`);
    return { rowsArchived: 0, durationMs };
  }

  // Transactional: archive then delete.
  // In production wrap in a DB transaction so a partial failure leaves both
  // tables consistent.
  await archiveStreams(stale);
  await deleteStreams(stale.map((s) => s.id));

  const durationMs = Date.now() - start;
  console.log(
    `[cleanup] Archived ${stale.length} streams in ${durationMs}ms`
  );

  return { rowsArchived: stale.length, durationMs };
}

// ---------------------------------------------------------------------------
// Scheduler
// ---------------------------------------------------------------------------

export function scheduleCleanupJob(): void {
  // Runs at 02:00 UTC every day
  cron.schedule("0 2 * * *", () => {
    runStreamCleanup().catch((err) =>
      console.error("[cleanup] Job failed:", err)
    );
  });
  console.log("[cleanup] Cron job scheduled (daily 02:00 UTC)");
}
