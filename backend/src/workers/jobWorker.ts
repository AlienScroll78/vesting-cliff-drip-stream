/**
 * backend/src/workers/jobWorker.ts  (#568)
 *
 * Async job-queue worker.
 *
 * Dequeues job ids from the Redis list `job_queue` via BRPOP, loads the full
 * job record, dispatches to the appropriate handler, and persists the outcome.
 *
 * Environment variables:
 *   ENABLE_JOB_WORKER   Set to "true" to start the worker (default: false)
 *   JOB_WORKER_TIMEOUT  BRPOP block timeout in seconds (default: 5)
 */

import {
  type Job,
  type JobType,
  getJob,
  updateJobStatus,
} from "../jobs/jobQueue.js";
import { createRedisClient } from "../redisClient.js";

// ── Constants ─────────────────────────────────────────────────────────────────

const QUEUE_KEY = "job_queue";
const BRPOP_TIMEOUT_SECONDS = parseInt(
  process.env.JOB_WORKER_TIMEOUT ?? "5",
  10
);

// ── Handler stubs ─────────────────────────────────────────────────────────────

async function handleBackfillLedgerRange(payload: unknown): Promise<unknown> {
  console.log("[job-worker] backfill_ledger_range payload:", payload);
  // Stub: real implementation would call the indexer's backfill logic.
  return { message: "backfill_ledger_range stub complete", payload };
}

async function handleBulkWebhookRetry(payload: unknown): Promise<unknown> {
  console.log("[job-worker] bulk_webhook_retry payload:", payload);
  // Stub: real implementation would re-enqueue failed webhook deliveries.
  return { message: "bulk_webhook_retry stub complete", payload };
}

async function handleExportStreamReport(payload: unknown): Promise<unknown> {
  console.log("[job-worker] export_stream_report payload:", payload);
  // Stub: real implementation would query DB and write a CSV to S3/local fs.
  return { message: "export_stream_report stub complete", payload };
}

async function handleDbVacuum(payload: unknown): Promise<unknown> {
  console.log("[job-worker] db_vacuum payload:", payload);
  // Stub: real implementation would run VACUUM ANALYZE on the relevant tables.
  return { message: "db_vacuum stub complete", payload };
}

// ── Dispatcher ────────────────────────────────────────────────────────────────

/**
 * Dispatch a job to its handler.  Returns the handler's result.
 * Throws on unrecognised job types (should not happen in practice because
 * job creation validates the type).
 */
export async function processJob(job: Job): Promise<unknown> {
  const { type, payload } = job;

  switch (type as JobType) {
    case "backfill_ledger_range":
      return handleBackfillLedgerRange(payload);

    case "bulk_webhook_retry":
      return handleBulkWebhookRetry(payload);

    case "export_stream_report":
      return handleExportStreamReport(payload);

    case "db_vacuum":
      return handleDbVacuum(payload);

    default: {
      // Exhaustiveness guard — type should never reach here.
      const _exhaustive: never = type;
      throw new Error(`[job-worker] unknown job type: ${_exhaustive}`);
    }
  }
}

// ── Worker loop ───────────────────────────────────────────────────────────────

let running = false;

/**
 * Start the job worker loop.
 *
 * Blocks on BRPOP with a configurable timeout so the loop wakes up
 * periodically even when the queue is empty (needed to honour `stopJobWorker`).
 */
export async function startJobWorker(): Promise<void> {
  if (running) {
    console.warn("[job-worker] already running, ignoring duplicate start");
    return;
  }

  running = true;
  console.log("[job-worker] started, listening on queue:", QUEUE_KEY);

  while (running) {
    let id: string | null = null;

    try {
      const redis = await createRedisClient();

      // BRPOP returns [listKey, value] or null on timeout.
      const result = await redis.brPop(QUEUE_KEY, BRPOP_TIMEOUT_SECONDS);
      if (!result) {
        // Timeout — loop and check `running` again.
        continue;
      }

      id = result.element;
      const job = await getJob(id);

      if (!job) {
        console.warn(`[job-worker] job ${id} not found in store, skipping`);
        continue;
      }

      console.log(`[job-worker] processing job id=${id} type=${job.type}`);
      await updateJobStatus(id, "running");

      try {
        const result = await processJob(job);
        await updateJobStatus(id, "completed", result);
        console.log(`[job-worker] job ${id} completed`);
      } catch (handlerErr: unknown) {
        const message =
          handlerErr instanceof Error
            ? handlerErr.message
            : String(handlerErr);
        console.error(`[job-worker] job ${id} failed:`, message);
        await updateJobStatus(id, "failed", undefined, message);
      }
    } catch (outerErr: unknown) {
      const message =
        outerErr instanceof Error ? outerErr.message : String(outerErr);
      console.error("[job-worker] outer loop error:", message);

      // If we dequeued an id but couldn't update its status, leave it for the
      // operator to inspect rather than silently losing it.
      if (id) {
        try {
          await updateJobStatus(id, "failed", undefined, message);
        } catch {
          // Best-effort — can't do much here.
        }
      }

      // Brief pause to avoid tight-loop on persistent Redis errors.
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
  }

  console.log("[job-worker] stopped");
}

/**
 * Signal the worker loop to exit after the current BRPOP timeout elapses.
 */
export function stopJobWorker(): void {
  running = false;
}

/**
 * Exposed for testing — returns whether the worker loop is currently active.
 */
export function isJobWorkerRunning(): boolean {
  return running;
}
