/**
 * Admin — GET /admin/audit-log
 *
 * Returns a paginated, filterable list of audit log entries.
 *
 * Query params (all optional):
 *   actor_address — exact match on actor_address
 *   action        — exact match on action
 *   limit         — max rows to return, default 50, max 200
 *   offset        — pagination offset, default 0
 *   from          — ISO-8601 lower bound on performed_at (inclusive)
 *   to            — ISO-8601 upper bound on performed_at (inclusive)
 *
 * Response 200:
 *   {
 *     "total": 42,
 *     "limit": 50,
 *     "offset": 0,
 *     "items": [
 *       {
 *         "id": "1",
 *         "actor_address": "GABC…",
 *         "action": "set_min_deposit",
 *         "parameters": { "min_deposit": 500 },
 *         "result": "success",
 *         "ip_address": "203.0.113.1",
 *         "correlation_id": "550e8400-e29b-41d4-a716-446655440000",
 *         "performed_at": "2026-10-02T09:00:00.000Z"
 *       }
 *     ]
 *   }
 *
 * Issue #755
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

// ── Validation helpers ────────────────────────────────────────────────────────

const STELLAR_ADDRESS_RE = /^G[A-Z2-7]{55}$/;
const ACTION_RE = /^[a-z_]{1,64}$/;

function isValidIso(value: string): boolean {
  return !isNaN(Date.parse(value));
}

// ── Handler ───────────────────────────────────────────────────────────────────

async function auditLogHandler(req: Request, res: Response): Promise<void> {
  const rawActor = String(req.query.actor_address ?? "").trim();
  const rawAction = String(req.query.action ?? "").trim();
  const rawFrom = String(req.query.from ?? "").trim();
  const rawTo = String(req.query.to ?? "").trim();
  const limit = Math.min(200, Math.max(1, parseInt(String(req.query.limit ?? "50"), 10)));
  const offset = Math.max(0, parseInt(String(req.query.offset ?? "0"), 10));

  // Input validation
  if (rawActor && !STELLAR_ADDRESS_RE.test(rawActor)) {
    res.status(400).json({
      error: "actor_address must be a valid Stellar public key (G…, 56 chars)",
    });
    return;
  }
  if (rawAction && !ACTION_RE.test(rawAction)) {
    res.status(400).json({
      error: "action must contain only lowercase letters and underscores (max 64 chars)",
    });
    return;
  }
  if (rawFrom && !isValidIso(rawFrom)) {
    res.status(400).json({ error: "from must be a valid ISO-8601 date string" });
    return;
  }
  if (rawTo && !isValidIso(rawTo)) {
    res.status(400).json({ error: "to must be a valid ISO-8601 date string" });
    return;
  }

  try {
    const pool = getPool();

    const conditions: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    if (rawActor) {
      conditions.push(`actor_address = $${idx++}`);
      values.push(rawActor);
    }
    if (rawAction) {
      conditions.push(`action = $${idx++}`);
      values.push(rawAction);
    }
    if (rawFrom) {
      conditions.push(`performed_at >= $${idx++}`);
      values.push(new Date(rawFrom).toISOString());
    }
    if (rawTo) {
      conditions.push(`performed_at <= $${idx++}`);
      values.push(new Date(rawTo).toISOString());
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const countSql = `SELECT COUNT(*) AS total FROM audit_log ${where}`;
    const rowsSql = `
      SELECT
        id::text,
        actor_address,
        action,
        parameters,
        result,
        host(ip_address) AS ip_address,
        correlation_id::text,
        performed_at
      FROM audit_log
      ${where}
      ORDER BY performed_at DESC, id DESC
      LIMIT $${idx++} OFFSET $${idx++}
    `;

    const paginatedValues = [...values, limit, offset];

    const [countResult, rowsResult] = await Promise.all([
      pool.query(countSql, values),
      pool.query(rowsSql, paginatedValues),
    ]);

    const total = parseInt(countResult.rows[0]?.total ?? "0", 10);

    const items = rowsResult.rows.map((r) => ({
      id: r.id as string,
      actor_address: r.actor_address as string,
      action: r.action as string,
      parameters: (r.parameters as Record<string, unknown> | null) ?? null,
      result: r.result as string,
      ip_address: (r.ip_address as string | null) ?? null,
      correlation_id: (r.correlation_id as string | null) ?? null,
      performed_at: (r.performed_at as Date).toISOString(),
    }));

    res.status(200).json({ total, limit, offset, items });
  } catch (err: unknown) {
    console.error(
      "[admin:audit-log] query error:",
      (err as Error)?.message ?? err
    );
    res.status(500).json({ error: "Internal server error" });
  }
}

// ── Router ────────────────────────────────────────────────────────────────────

export const auditRouter = Router();

// GET /admin/audit-log
auditRouter.get("/", auditLogHandler);

// Export for testing
export { auditLogHandler };
