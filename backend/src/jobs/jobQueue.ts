/**
 * backend/src/jobs/jobQueue.ts  (#568)
 *
 * Redis-based async job queue.
 *
 * Enqueuing stores a job record in a Redis hash (`job:{id}`) and pushes the
 * job id onto the `job_queue` list.  Workers use BRPOP to dequeue ids and then
 * load the full record from the hash before processing.
 *
 * Job TTL: 7 days (604 800 seconds).
 */

import { createRedisClient } from "../redisClient.js";

// ── Types ─────────────────────────────────────────────────────────────────────

export type JobType =
  | "backfill_ledger_range"
  | "bulk_webhook_retry"
  | "export_stream_report"
  | "db_vacuum";

export const JOB_TYPES: ReadonlySet<JobType> = new Set<JobType>([
  "backfill_ledger_range",
  "bulk_webhook_retry",
  "export_stream_report",
  "db_vacuum",
]);

export type JobStatus = "pending" | "running" | "completed" | "failed";

export interface Job {
  id: string;
  type: JobType;
  payload: unknown;
  status: JobStatus;
  createdAt: string;
  updatedAt: string;
  result?: unknown;
  error?: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const QUEUE_KEY = "job_queue";
const JOB_TTL_SECONDS = 604_800; // 7 days

function jobKey(id: string): string {
  return `job:${id}`;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Enqueue a new job.
 *
 * Stores the job record in `job:{id}` (Redis hash) and pushes the id onto
 * the `job_queue` list.  Returns the generated job id.
 */
export async function enqueueJob(
  type: JobType,
  payload: unknown
): Promise<string> {
  const redis = await createRedisClient();

  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  const job: Job = {
    id,
    type,
    payload,
    status: "pending",
    createdAt: now,
    updatedAt: now,
  };

  const serialised = JSON.stringify(job);

  // Store the full record and push the id in a pipelined call.
  await redis.set(jobKey(id), serialised, { EX: JOB_TTL_SECONDS });
  await redis.lPush(QUEUE_KEY, id);

  console.log(`[job-queue] enqueued job id=${id} type=${type}`);
  return id;
}

/**
 * Retrieve a job by id.  Returns `null` when no record exists.
 */
export async function getJob(id: string): Promise<Job | null> {
  const redis = await createRedisClient();
  const raw = await redis.get(jobKey(id));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Job;
  } catch {
    return null;
  }
}

/**
 * Update the mutable fields of a stored job.
 *
 * Only `status`, `result`, and `error` may be changed.
 * The `updatedAt` timestamp is always refreshed.
 */
export async function updateJobStatus(
  id: string,
  status: JobStatus,
  result?: unknown,
  error?: string
): Promise<void> {
  const redis = await createRedisClient();
  const existing = await getJob(id);
  if (!existing) {
    console.warn(`[job-queue] updateJobStatus: job ${id} not found`);
    return;
  }

  const updated: Job = {
    ...existing,
    status,
    updatedAt: new Date().toISOString(),
    ...(result !== undefined ? { result } : {}),
    ...(error !== undefined ? { error } : {}),
  };

  await redis.set(jobKey(id), JSON.stringify(updated), {
    EX: JOB_TTL_SECONDS,
  });
}

/**
 * Validate that a string value is a recognised JobType.
 */
export function isValidJobType(value: unknown): value is JobType {
  return typeof value === "string" && JOB_TYPES.has(value as JobType);
}
