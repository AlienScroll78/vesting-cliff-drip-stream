/**
 * Audit logging middleware — closes #742
 *
 * Records every admin action with:
 *   - timestamp (ISO 8601)
 *   - action name
 *   - JWT subject (wallet address of the actor)
 *   - request parameters
 *   - request ID (if set by requestId middleware)
 *
 * Output: structured JSON to stdout so it can be captured by any log aggregator
 * (CloudWatch, Datadog, etc.).  If a PostgreSQL pool is available the entry is
 * also written to the `admin_audit_log` table.
 */

"use strict";

import { pool } from "../db.js";

export interface AuditEntry {
  action: string;
  subject: string;          // Stellar address from JWT sub
  params?: Record<string, unknown>;
  request_id?: string;
}

/**
 * Write a structured audit log entry.
 *
 * This function never throws — audit failures are logged to stderr but do NOT
 * block the request.
 */
export async function auditLog(entry: AuditEntry): Promise<void> {
  const record = {
    timestamp: new Date().toISOString(),
    ...entry,
  };

  // Always emit to stdout (log aggregator picks this up)
  console.log("[AUDIT]", JSON.stringify(record));

  // Persist to DB if available (best-effort — non-blocking)
  try {
    await pool.query(
      `INSERT INTO admin_audit_log (timestamp, action, subject, params, request_id)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT DO NOTHING`,
      [
        record.timestamp,
        record.action,
        record.subject,
        JSON.stringify(record.params ?? {}),
        record.request_id ?? null,
      ]
    );
  } catch {
    // DB write failure is non-fatal — the stdout log still exists
    console.error("[AUDIT] DB write failed for action:", entry.action);
  }
}
