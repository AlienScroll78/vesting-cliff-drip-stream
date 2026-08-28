/**
 * backend/src/routes/jobs.ts  (#568)
 *
 * REST endpoints for async job queue management.
 *
 * POST /jobs          — enqueue a new job
 * GET  /jobs/:id      — retrieve job status
 *
 * No authentication is required for now (as specified in the issue).
 */

import { Router, Request, Response } from "express";
import {
  enqueueJob,
  getJob,
  isValidJobType,
} from "../jobs/jobQueue.js";

const router = Router();

// ── POST /jobs ─────────────────────────────────────────────────────────────────

/**
 * Enqueue a new job.
 *
 * Request body:
 *   { "type": "<job_type>", "payload": <any> }
 *
 * Response (201):
 *   { "jobId": "<uuid>" }
 *
 * Errors:
 *   400  — missing or invalid `type`
 *   500  — Redis unavailable
 */
router.post("/jobs", async (req: Request, res: Response): Promise<void> => {
  const { type, payload } = req.body as { type?: unknown; payload?: unknown };

  if (!type) {
    res.status(400).json({ error: "Missing required field: type" });
    return;
  }

  if (!isValidJobType(type)) {
    res.status(400).json({
      error: `Invalid job type: "${type}". Must be one of: backfill_ledger_range, bulk_webhook_retry, export_stream_report, db_vacuum`,
    });
    return;
  }

  try {
    const jobId = await enqueueJob(type, payload ?? null);
    res.status(201).json({ jobId });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[jobs-route] enqueue failed:", message);
    res.status(500).json({ error: "Failed to enqueue job" });
  }
});

// ── GET /jobs/:id ─────────────────────────────────────────────────────────────

/**
 * Retrieve the current state of a job.
 *
 * Response (200):
 *   Full Job object
 *
 * Errors:
 *   404  — no job with the given id
 *   500  — Redis unavailable
 */
router.get("/jobs/:id", async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;

  try {
    const job = await getJob(id);
    if (!job) {
      res.status(404).json({ error: `Job not found: ${id}` });
      return;
    }
    res.json(job);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[jobs-route] getJob failed:", message);
    res.status(500).json({ error: "Failed to retrieve job" });
  }
});

export { router as jobsRouter };
