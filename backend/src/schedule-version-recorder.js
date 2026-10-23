"use strict";

/**
 * schedule-version-recorder.js
 *
 * Writes immutable audit entries to the `schedule_versions` table whenever
 * a vesting schedule is mutated (created, modified, cancelled, clawback,
 * completed).
 *
 * This module is called by the event indexer / horizon worker when it
 * processes on-chain events from the VestingDrips contract.
 *
 * Usage:
 *
 *   const { recordVersion } = require("./schedule-version-recorder");
 *
 *   await recordVersion(pool, {
 *     recipient: "GRECIPIENT...",
 *     mutationType: "created",
 *     changedFields: { rate_per_ledger: "10", cliff_ledger: 1100, ... },
 *     ledgerSequence: 1000000,
 *     txHash: "abc123...",
 *   });
 */

/**
 * @typedef {"created"|"modified"|"cancelled"|"clawback"|"completed"} MutationType
 */

/**
 * Record a version entry for a schedule mutation.
 *
 * @param {import("pg").Pool} pool - PostgreSQL connection pool
 * @param {object} opts
 * @param {string}      opts.recipient       - Stellar G... address
 * @param {MutationType} opts.mutationType   - Kind of mutation
 * @param {object}      opts.changedFields   - Fields changed by this mutation
 * @param {number}      opts.ledgerSequence  - On-chain ledger of the event
 * @param {string|null} [opts.txHash]        - Transaction hash (optional)
 * @returns {Promise<void>}
 */
async function recordVersion(pool, { recipient, mutationType, changedFields, ledgerSequence, txHash = null }) {
  // Determine the next version number for this recipient atomically.
  // We use a CTE so that the SELECT + INSERT happens in a single round-trip
  // and is safe under concurrent writes (unique index on recipient + version_number).
  const sql = `
    WITH next_version AS (
      SELECT COALESCE(MAX(version_number), 0) + 1 AS v
      FROM schedule_versions
      WHERE recipient = $1
    )
    INSERT INTO schedule_versions
      (recipient, version_number, mutation_type, changed_fields, ledger_sequence, tx_hash)
    SELECT $1, next_version.v, $2, $3, $4, $5
    FROM next_version
    ON CONFLICT (recipient, version_number) DO NOTHING
  `;

  await pool.query(sql, [
    recipient,
    mutationType,
    JSON.stringify(changedFields),
    ledgerSequence,
    txHash,
  ]);
}

/**
 * Build a changedFields object for a stream creation event.
 *
 * @param {object} schedule - Fields from the vc_create contract event
 * @returns {object}
 */
function buildCreatedFields(schedule) {
  return {
    sponsor: schedule.sponsor ?? null,
    token: schedule.token ?? null,
    rate_per_ledger: String(schedule.rate ?? schedule.rate_per_ledger ?? "0"),
    start_ledger: schedule.start_ledger ?? null,
    cliff_ledger: schedule.cliff_ledger ?? null,
    end_ledger: schedule.end_ledger ?? null,
    total_deposit: schedule.total_deposit
      ? String(schedule.total_deposit)
      : null,
  };
}

/**
 * Build a changedFields object for a stream cancellation event.
 *
 * @param {object} event - Fields from the vc_cancel contract event
 * @returns {object}
 */
function buildCancelledFields(event) {
  return {
    refunded_amount: String(event.refunded_amount ?? event.amount ?? "0"),
    cliff_passed: event.cliff_passed ?? null,
  };
}

/**
 * Build a changedFields object for a clawback event.
 *
 * @param {object} event - Fields from the vc_clawback contract event
 * @returns {object}
 */
function buildClawbackFields(event) {
  return {
    sponsor: event.sponsor ?? null,
    amount: String(event.amount ?? "0"),
    reason: event.reason ?? null,
  };
}

/**
 * Build a changedFields object for a stream completion (vc_done) event.
 *
 * @param {object} event
 * @returns {object}
 */
function buildCompletedFields(event) {
  return {
    token: event.token ?? null,
    total_claimed: String(event.total_claimed ?? "0"),
  };
}

module.exports = {
  recordVersion,
  buildCreatedFields,
  buildCancelledFields,
  buildClawbackFields,
  buildCompletedFields,
};
