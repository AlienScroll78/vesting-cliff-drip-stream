/**
 * Admin — GET /admin/streams
 *
 * Lists all vesting streams stored in the database.  Supports optional
 * query-string filters so operators can narrow results without additional
 * tooling.
 *
 * Query params (all optional):
 *   status    — active | pre_cliff | expired | cancelled
 *   sponsor   — Stellar G… address (exact match)
 *   recipient — Stellar G… address (exact match)
 *   limit     — max rows to return, default 50, max 200
 *   offset    — pagination offset, default 0
 *
 * Response 200:
 *   {
 *     "total": 3,
 *     "limit": 50,
 *     "offset": 0,
 *     "items": [ { ...stream fields... } ]
 *   }
 */

import { Router, type Request, type Response } from "express";
import { Pool } from "pg";

// ── DB pool (lazy singleton) ──────────────────────────────────────────────────

let _pool: Pool | null = null;

function getPool(): Pool {
  if (!_pool) {
    _pool = new Pool({ connectionString: process.env.DATABASE_URL });
  }
  return _pool;
}

// ── Allowed filter values ─────────────────────────────────────────────────────

const VALID_STATUSES = new Set(["active", "pre_cliff", "expired", "cancelled"]);
const STELLAR_ADDRESS_RE = /^G[A-Z2-7]{55}$/;

// ── Handler ───────────────────────────────────────────────────────────────────

async function streamsHandler(req: Request, res: Response): Promise<void> {
  const rawStatus = String(req.query.status ?? "").trim();
  const rawSponsor = String(req.query.sponsor ?? "").trim();
  const rawRecipient = String(req.query.recipient ?? "").trim();
  const limit = Math.min(200, Math.max(1, parseInt(String(req.query.limit ?? "50"), 10)));
  const offset = Math.max(0, parseInt(String(req.query.offset ?? "0"), 10));

  // Validate optional filters
  if (rawStatus && !VALID_STATUSES.has(rawStatus)) {
    res.status(400).json({
      error: `Invalid status. Allowed: ${[...VALID_STATUSES].join(", ")}`,
    });
    return;
  }
  if (rawSponsor && !STELLAR_ADDRESS_RE.test(rawSponsor)) {
    res.status(400).json({ error: "sponsor must be a valid Stellar public key" });
    return;
  }
  if (rawRecipient && !STELLAR_ADDRESS_RE.test(rawRecipient)) {
    res.status(400).json({ error: "recipient must be a valid Stellar public key" });
    return;
  }

  try {
    const pool = getPool();

    const conditions: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    if (rawStatus) {
      conditions.push(`status = $${idx++}`);
      values.push(rawStatus);
    }
    if (rawSponsor) {
      conditions.push(`sponsor_address = $${idx++}`);
      values.push(rawSponsor);
    }
    if (rawRecipient) {
      conditions.push(`recipient_address = $${idx++}`);
      values.push(rawRecipient);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const countSql = `SELECT COUNT(*) AS total FROM vesting_streams ${where}`;
    const rowsSql = `
      SELECT
        id,
        sponsor_address    AS sponsor,
        recipient_address  AS recipient,
        token_address      AS token,
        rate_per_ledger,
        start_ledger,
        cliff_ledger,
        end_ledger,
        status,
        cancelled_at,
        created_at
      FROM vesting_streams
      ${where}
      ORDER BY created_at DESC
      LIMIT $${idx++} OFFSET $${idx++}
    `;

    const paginatedValues = [...values, limit, offset];

    const [countResult, rowsResult] = await Promise.all([
      pool.query(countSql, values),
      pool.query(rowsSql, paginatedValues),
    ]);

    const total = parseInt(countResult.rows[0]?.total ?? "0", 10);
    const items = rowsResult.rows.map((r) => ({
      id: r.id,
      sponsor: r.sponsor,
      recipient: r.recipient,
      token: r.token ?? null,
      rate_per_ledger: String(r.rate_per_ledger),
      start_ledger: r.start_ledger,
      cliff_ledger: r.cliff_ledger,
      end_ledger: r.end_ledger,
      status: r.status,
      cancelled_at: r.cancelled_at ? new Date(r.cancelled_at).toISOString() : null,
      created_at: new Date(r.created_at).toISOString(),
    }));

    res.status(200).json({ total, limit, offset, items });
  } catch (err: unknown) {
    console.error("[admin:streams] query error:", (err as Error)?.message ?? err);
    res.status(500).json({ error: "Internal server error" });
  }
}

// ── Router ────────────────────────────────────────────────────────────────────

export const streamsRouter = Router();
streamsRouter.get("/", streamsHandler);

// Export handler for testing
export { streamsHandler };
