/**
 * Admin — audit log service
 *
 * Provides a `writeAuditLog` function that inserts a single row into the
 * `audit_log` table.  Callers (admin route handlers) should call this in the
 * same try/finally block as the action itself so that failures are recorded
 * even when the primary action throws.
 *
 * The audit_log table is append-only at the database permission level; this
 * module never issues UPDATE or DELETE queries against it.
 *
 * Issue #755
 */

import { Pool, PoolClient } from "pg";

// ── DB pool (lazy singleton) ──────────────────────────────────────────────────

let _pool: Pool | null = null;

function getPool(): Pool {
  if (!_pool) {
    _pool = new Pool({ connectionString: process.env.DATABASE_URL });
  }
  return _pool;
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface AuditLogEntry {
  /** Stellar public key (G…) or 'system' for automated actions */
  actor_address: string;
  /** Machine-readable action identifier, e.g. 'set_min_deposit' */
  action: string;
  /** Input parameters (must not include secrets) */
  parameters?: Record<string, unknown> | null;
  /** 'success' or a human-readable error message */
  result: string;
  /** Client IP address (from X-Forwarded-For or socket) */
  ip_address?: string | null;
  /** Distributed trace / request correlation ID */
  correlation_id?: string | null;
}

export interface AuditLogRow extends AuditLogEntry {
  id: string;
  performed_at: string;
}

// ── Write helper ──────────────────────────────────────────────────────────────

/**
 * Insert one entry into the `audit_log` table.
 *
 * @param entry   - Audit log fields.
 * @param client  - Optional existing PoolClient to run the query inside an
 *                  existing transaction.  When omitted, a fresh connection is
 *                  acquired from the pool.
 * @returns The inserted row's `id` and `performed_at`.
 */
export async function writeAuditLog(
  entry: AuditLogEntry,
  client?: PoolClient
): Promise<{ id: string; performed_at: string }> {
  const db = client ?? getPool();

  const { rows } = await db.query<{ id: string; performed_at: string }>(
    `INSERT INTO audit_log
       (actor_address, action, parameters, result, ip_address, correlation_id)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id::text, performed_at`,
    [
      entry.actor_address,
      entry.action,
      entry.parameters !== undefined ? JSON.stringify(entry.parameters) : null,
      entry.result,
      entry.ip_address ?? null,
      entry.correlation_id ?? null,
    ]
  );

  return rows[0] as { id: string; performed_at: string };
}

/**
 * Extract the client IP from an Express request.
 *
 * Prefers X-Forwarded-For (set by the ingress load balancer) and falls back to
 * the direct socket address.  Returns null if neither is available.
 */
export function extractIp(headers: Record<string, string | string[] | undefined>, remoteAddress?: string): string | null {
  const xff = headers["x-forwarded-for"];
  if (xff) {
    const first = Array.isArray(xff) ? xff[0] : xff.split(",")[0];
    return first?.trim() ?? null;
  }
  return remoteAddress ?? null;
}
