/**
 * backend/src/routes/streamBalance.ts  (#996)
 *
 * GET /api/streams/:recipient/balance
 *
 * Returns the remaining balance for a stream from the database
 * (stream_balances table), avoiding a round-trip to the Soroban RPC node.
 *
 * Response 200:
 * {
 *   "stream_id": "G...",
 *   "total_deposit": "5000",
 *   "claimed_total": "750",
 *   "remaining": "4250"
 * }
 *
 * Response 404:
 * { "error": "stream balance not found" }
 *
 * Response 400:
 * { "error": "validation_failed", "fields": [...] }
 */

import { Router, type Request, type Response } from "express";
import { pool } from "../db.js";
import { validate } from "../middleware/validate.js";
import { RecipientParamsSchema } from "../validation.js";
import { getStreamBalance } from "../indexer/balanceTracker.js";

const router = Router();

/**
 * GET /api/streams/:recipient/balance
 *
 * Returns the remaining stream balance from the database.
 */
router.get(
  "/:recipient/balance",
  validate({ params: RecipientParamsSchema }),
  async (req: Request, res: Response): Promise<void> => {
    const { recipient } = req.params;

    try {
      const balance = await getStreamBalance(pool, recipient);

      if (!balance) {
        res.status(404).json({ error: "stream balance not found" });
        return;
      }

      res.json({
        stream_id: balance.stream_id,
        total_deposit: balance.total_deposit,
        claimed_total: balance.claimed_total,
        remaining: balance.remaining,
      });
    } catch (err: any) {
      console.error("[stream-balance] query error:", err?.message ?? err);
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

export { router as streamBalanceRouter };
