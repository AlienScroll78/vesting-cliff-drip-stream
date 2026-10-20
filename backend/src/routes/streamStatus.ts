/**
 * Issue #753 — GET /api/streams/:recipient/status
 *
 * Returns the current database-persisted stream status for a recipient.
 * The status reflects the state machine value, updated atomically on each
 * indexed contract event and by the background expiry job.
 *
 * Response 200:
 * {
 *   "recipient": "G...",
 *   "status": "active",
 *   "updated_at": "2026-01-15T10:30:00Z"
 * }
 *
 * Response 404:
 * { "error": "not_found" }
 *
 * Response 400:
 * { "error": "validation_failed", "fields": [...] }
 */

import { Router, type Request, type Response } from "express";
import { pool } from "../db.js";
import { validate } from "../middleware/validate.js";
import { RecipientParamsSchema } from "../validation.js";
import { getStreamStatus } from "../streamStatusService.js";

const router = Router();

/**
 * GET /api/streams/:recipient/status
 *
 * Returns the real-time (database) status for a stream recipient.
 * No auth required — status is public information.
 */
router.get(
  "/:recipient/status",
  validate({ params: RecipientParamsSchema }),
  async (req: Request, res: Response): Promise<void> => {
    const { recipient } = req.params;

    try {
      const result = await getStreamStatus(pool, recipient);

      if (!result) {
        res.status(404).json({ error: "not_found" });
        return;
      }

      res.json({
        recipient,
        status: result.status,
        updated_at: result.statusUpdatedAt.toISOString(),
      });
    } catch (err: any) {
      console.error("[stream-status] query error:", err?.message ?? err);
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

export { router as streamStatusRouter };
