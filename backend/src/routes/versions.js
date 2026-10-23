"use strict";

/**
 * GET /streams/:recipient/versions
 *
 * Returns the full mutation history (audit log) for a vesting schedule,
 * ordered from oldest to newest. Each entry represents one mutation event:
 * stream creation, modification, cancellation, clawback, or completion.
 *
 * Query parameters:
 *   page   (optional, default: 1)
 *   limit  (optional, default: 20, max: 50)
 *
 * Response 200:
 *   {
 *     "recipient": "G...",
 *     "versions": [
 *       {
 *         "version": 1,
 *         "mutation_type": "created",
 *         "changed_fields": { ... },
 *         "ledger_sequence": 1000000,
 *         "tx_hash": "abc123...",
 *         "timestamp": "2024-01-01T00:00:00.000Z"
 *       },
 *       ...
 *     ],
 *     "total": 3,
 *     "page": 1,
 *     "limit": 20
 *   }
 *
 * Response 404: { "error": "no version history found for recipient" }
 * Response 400: { "error": "..." }
 */

const { pool: sharedPool } = require("../db");

// ── DB pool accessor ──────────────────────────────────────────────────────────
// Re-uses the shared pool from db.js (same pattern as export.js and optOut.js).

function getPool() {
  return sharedPool;
}

// ── Stellar address validation ────────────────────────────────────────────────

const STELLAR_ADDRESS_RE = /^G[A-Z2-7]{55}$/;

function isValidStellarAddress(addr) {
  return STELLAR_ADDRESS_RE.test(addr);
}

// ── Handler ───────────────────────────────────────────────────────────────────

/**
 * @param {import("http").IncomingMessage | { url?: string, params?: Record<string, string> }} req
 * @param {{ writeHead: Function, end: Function, status?: Function, json?: Function }} res
 */
async function versionsHandler(req, res) {
  // ── Resolve recipient ─────────────────────────────────────────────────────
  // Support both Express (req.params.recipient) and plain HTTP (URL parsing).
  let recipient;

  if (req.params && req.params.recipient) {
    recipient = req.params.recipient;
  } else {
    // Extract from URL path: /streams/:recipient/versions
    const urlPath = req.url ?? "";
    const match = urlPath.match(/\/streams\/([^/]+)\/versions/);
    recipient = match ? match[1] : null;
  }

  if (!recipient) {
    if (res.status) {
      res.status(400).json({ error: "recipient is required" });
    } else {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "recipient is required" }));
    }
    return;
  }

  if (!isValidStellarAddress(recipient)) {
    if (res.status) {
      res.status(400).json({ error: "recipient must be a valid Stellar public key" });
    } else {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "recipient must be a valid Stellar public key" }));
    }
    return;
  }

  // ── Pagination params ─────────────────────────────────────────────────────
  const query = req.query ?? {};
  const page = Math.max(1, parseInt(String(query.page ?? "1"), 10) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(String(query.limit ?? "20"), 10) || 20));
  const offset = (page - 1) * limit;

  // ── DB query ──────────────────────────────────────────────────────────────
  try {
    const pool = getPool();

    const [countResult, rowsResult] = await Promise.all([
      pool.query(
        `SELECT COUNT(*) AS total FROM schedule_versions WHERE recipient = $1`,
        [recipient]
      ),
      pool.query(
        `SELECT
           version_number,
           mutation_type,
           changed_fields,
           ledger_sequence,
           tx_hash,
           created_at
         FROM schedule_versions
         WHERE recipient = $1
         ORDER BY version_number ASC
         LIMIT $2 OFFSET $3`,
        [recipient, limit, offset]
      ),
    ]);

    const total = parseInt(countResult.rows[0]?.total ?? "0", 10);

    if (total === 0 && page === 1) {
      // No history at all — return 404 rather than an empty list, since
      // an unknown recipient should be distinguishable from one with no mutations.
      const payload = JSON.stringify({ error: "no version history found for recipient" });
      if (res.status) {
        res.status(404).json({ error: "no version history found for recipient" });
      } else {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(payload);
      }
      return;
    }

    const versions = rowsResult.rows.map((r) => ({
      version: r.version_number,
      mutation_type: r.mutation_type,
      changed_fields: typeof r.changed_fields === "string"
        ? JSON.parse(r.changed_fields)
        : (r.changed_fields ?? {}),
      ledger_sequence: r.ledger_sequence,
      tx_hash: r.tx_hash ?? null,
      timestamp: new Date(r.created_at).toISOString(),
    }));

    const response = {
      recipient,
      versions,
      total,
      page,
      limit,
    };

    const payload = JSON.stringify(response);
    if (res.status) {
      res.status(200).json(response);
    } else {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(payload);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[versions] query error:", message);
    if (res.status) {
      res.status(500).json({ error: "Internal server error" });
    } else {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Internal server error" }));
    }
  }
}

module.exports = { versionsHandler };
