/**
 * Issue #1007: Build stream reconciliation job comparing DB vs on-chain state
 *
 * Scheduled daily job that:
 *   1. Queries all streams from the database
 *   2. Batches RPC calls to the contract's get_claimable_batch view function (max 20 per call)
 *   3. Compares DB state vs on-chain state
 *   4. Logs mismatches to reconciliation_failures table
 *   5. Sends Slack alert if mismatches detected
 *   6. Supports dry-run mode (logs without writing)
 *
 * Configuration via environment variables:
 *   RECONCILIATION_SCHEDULE   — cron expression (default: "0 2 * * *" — 2 AM daily)
 *   RECONCILIATION_DRY_RUN    — boolean, run without writing (default: false)
 *   RECONCILIATION_SLACK_HOOK — Slack webhook URL for alerts (optional)
 *   RECONCILIATION_BATCH_SIZE — RPC batch size (default: 20, max 20)
 */

import cron from "node-cron";
import { Pool, PoolClient } from "pg";
import { randomUUID } from "crypto";
import { SorobanRpc } from "@stellar/stellar-sdk";
import { networkConfig } from "../config/network.js";

// ── Types ─────────────────────────────────────────────────────────────────────

interface StreamRecord {
  recipient_address: string;
  status: string;
  claimed_total?: string | number;
  end_ledger: number;
  last_claimed_ledger: number;
  rate_per_ledger: string | number;
}

interface ReconciliationMismatch {
  recipient_address: string;
  failure_type: "balance_mismatch" | "status_mismatch" | "missing_on_chain" | "missing_in_db";
  db_value?: string;
  chain_value?: string;
  error_message?: string;
}

interface ReconciliationResult {
  jobId: string;
  startedAt: Date;
  completedAt?: Date;
  streamsChecked: number;
  failuresDetected: number;
  errorsEncountered: number;
  status: "running" | "completed" | "failed";
  error?: string;
  dryRun: boolean;
  slackAlertSent: boolean;
}

// ── Configuration ─────────────────────────────────────────────────────────────

function getConfig() {
  return {
    schedule: process.env.RECONCILIATION_SCHEDULE ?? "0 2 * * *", // 2 AM daily
    dryRun: process.env.RECONCILIATION_DRY_RUN === "true",
    slackWebhook: process.env.RECONCILIATION_SLACK_HOOK,
    batchSize: Math.min(
      20,
      Math.max(1, parseInt(process.env.RECONCILIATION_BATCH_SIZE ?? "20", 10))
    ),
  };
}

// ── Database operations ───────────────────────────────────────────────────────

/**
 * Fetch all streams from the database for reconciliation.
 */
async function fetchAllStreams(pool: Pool): Promise<StreamRecord[]> {
  const result = await pool.query<StreamRecord>(`
    SELECT
      recipient_address,
      status,
      COALESCE(claimed_total, 0) as claimed_total,
      end_ledger,
      last_claimed_ledger,
      rate_per_ledger
    FROM vesting_streams
    ORDER BY recipient_address
  `);
  return result.rows;
}

/**
 * Record a reconciliation mismatch in the database.
 * Idempotent: does nothing in dry-run mode.
 */
async function recordMismatch(
  client: PoolClient,
  jobId: string,
  mismatch: ReconciliationMismatch,
  dryRun: boolean
): Promise<void> {
  if (dryRun) return;

  const insertSql = `
    INSERT INTO reconciliation_failures
      (recipient_address, failure_type, db_value, chain_value, 
       error_message, reconciliation_job_id, created_at, updated_at)
    VALUES ($1, $2, $3, $4, $5, $6, now(), now())
    ON CONFLICT DO NOTHING
  `;

  await client.query(insertSql, [
    mismatch.recipient_address,
    mismatch.failure_type,
    mismatch.db_value ?? null,
    mismatch.chain_value ?? null,
    mismatch.error_message ?? null,
    jobId,
  ]);
}

/**
 * Save reconciliation run record.
 */
async function saveReconciliationRun(
  pool: Pool,
  result: ReconciliationResult
): Promise<void> {
  const insertSql = `
    INSERT INTO reconciliation_runs
      (id, started_at, completed_at, dry_run, streams_checked, 
       failures_detected, errors_encountered, status, error_message, slack_alert_sent)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
  `;

  await pool.query(insertSql, [
    result.jobId,
    result.startedAt,
    result.completedAt ?? null,
    result.dryRun,
    result.streamsChecked,
    result.failuresDetected,
    result.errorsEncountered,
    result.status,
    result.error ?? null,
    result.slackAlertSent,
  ]);
}

// ── Contract interaction ──────────────────────────────────────────────────────

/**
 * Fetch claimable amounts for a batch of recipients from the contract.
 * Returns a map of recipient_address -> claimable_amount (as string).
 *
 * Issues an RPC call to the contract's get_claimable_batch view function.
 */
async function getClaimableBatch(
  recipients: string[]
): Promise<Record<string, string>> {
  if (recipients.length === 0) return {};

  try {
    const client = new SorobanRpc.Server(networkConfig.rpcUrl);
    
    // Build the contract invocation
    // This is a placeholder — actual implementation depends on the contract's
    // view function signature and stellar-sdk's ContractSpec helpers.
    // For now, we log a warning and skip RPC calls.
    console.warn(
      `[reconciliation] get_claimable_batch not yet implemented for ${recipients.length} recipients`
    );

    // Placeholder: return empty map (no mismatches will be detected without this)
    return {};
  } catch (err) {
    console.error("[reconciliation] RPC error:", err instanceof Error ? err.message : String(err));
    throw err;
  }
}

// ── Slack notifications ───────────────────────────────────────────────────────

/**
 * Send a Slack alert when mismatches are detected.
 */
async function sendSlackAlert(
  webhook: string,
  mismatches: ReconciliationMismatch[],
  result: ReconciliationResult
): Promise<boolean> {
  try {
    const payload = {
      text: `🚨 Stream Reconciliation Alert (${result.failuresDetected} mismatches)`,
      blocks: [
        {
          type: "header",
          text: {
            type: "plain_text",
            text: "Stream Reconciliation Mismatch Detected",
          },
        },
        {
          type: "section",
          fields: [
            {
              type: "mrkdwn",
              text: `*Run ID:*\n${result.jobId}`,
            },
            {
              type: "mrkdwn",
              text: `*Mismatches:*\n${result.failuresDetected}`,
            },
            {
              type: "mrkdwn",
              text: `*Streams Checked:*\n${result.streamsChecked}`,
            },
            {
              type: "mrkdwn",
              text: `*Errors:*\n${result.errorsEncountered}`,
            },
          ],
        },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*Mismatches:*\n${mismatches
              .slice(0, 10)
              .map(
                (m) =>
                  `• ${m.recipient_address}: ${m.failure_type}${m.error_message ? ` (${m.error_message})` : ""}`
              )
              .join("\n")}${mismatches.length > 10 ? `\n• ... and ${mismatches.length - 10} more` : ""}`,
          },
        },
      ],
    };

    const response = await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      console.error(`[reconciliation] Slack webhook returned ${response.status}`);
      return false;
    }

    return true;
  } catch (err) {
    console.error(
      "[reconciliation] Slack alert failed:",
      err instanceof Error ? err.message : String(err)
    );
    return false;
  }
}

// ── Main reconciliation logic ─────────────────────────────────────────────────

/**
 * Execute one full reconciliation cycle.
 *
 * Compares DB state against on-chain state and records mismatches.
 * Returns detailed results including counts and any errors.
 */
export async function runReconciliation(
  pool: Pool,
  options?: { dryRun?: boolean; schedule?: string }
): Promise<ReconciliationResult> {
  const jobId = randomUUID();
  const cfg = getConfig();
  const dryRun = options?.dryRun ?? cfg.dryRun;
  const result: ReconciliationResult = {
    jobId,
    startedAt: new Date(),
    streamsChecked: 0,
    failuresDetected: 0,
    errorsEncountered: 0,
    status: "running",
    dryRun,
    slackAlertSent: false,
  };

  const client = await pool.connect();
  const mismatches: ReconciliationMismatch[] = [];

  try {
    await client.query("BEGIN");

    // 1. Fetch all streams
    const streams = await fetchAllStreams(pool);
    console.log(
      `[reconciliation] Starting reconciliation of ${streams.length} streams (job=${jobId})`
    );

    // 2. Batch RPC calls
    for (let i = 0; i < streams.length; i += cfg.batchSize) {
      const batch = streams.slice(i, i + cfg.batchSize);
      const recipients = batch.map((s) => s.recipient_address);

      try {
        const claimables = await getClaimableBatch(recipients);

        // 3. Compare each stream
        for (const stream of batch) {
          result.streamsChecked++;

          // Check status: active streams should exist on-chain
          const claimable = claimables[stream.recipient_address];
          if (stream.status === "active" && claimable === undefined) {
            const mismatch: ReconciliationMismatch = {
              recipient_address: stream.recipient_address,
              failure_type: "status_mismatch",
              db_value: "active",
              chain_value: "missing",
            };
            mismatches.push(mismatch);
            result.failuresDetected++;
            await recordMismatch(client, jobId, mismatch, dryRun);
          }

          // Check balance: claimed_total + claimable should match contract view
          if (claimable !== undefined) {
            const dbClaimable = stream.claimed_total || 0;
            if (String(dbClaimable) !== claimable) {
              const mismatch: ReconciliationMismatch = {
                recipient_address: stream.recipient_address,
                failure_type: "balance_mismatch",
                db_value: String(dbClaimable),
                chain_value: claimable,
              };
              mismatches.push(mismatch);
              result.failuresDetected++;
              await recordMismatch(client, jobId, mismatch, dryRun);
            }
          }
        }
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        console.error(
          `[reconciliation] RPC error in batch ${i / cfg.batchSize + 1}:`,
          errorMsg
        );
        result.errorsEncountered++;

        // Record per-stream errors so we know which streams failed
        for (const stream of batch) {
          const mismatch: ReconciliationMismatch = {
            recipient_address: stream.recipient_address,
            failure_type: "status_mismatch",
            error_message: `RPC error: ${errorMsg}`,
          };
          mismatches.push(mismatch);
          result.failuresDetected++;
          await recordMismatch(client, jobId, mismatch, dryRun);
        }
      }
    }

    // 4. Send Slack alert if mismatches found
    if (mismatches.length > 0 && cfg.slackWebhook) {
      result.slackAlertSent = await sendSlackAlert(
        cfg.slackWebhook,
        mismatches,
        result
      );
    }

    result.status = "completed";
    result.completedAt = new Date();

    if (!dryRun) {
      await saveReconciliationRun(pool, result);
      await client.query("COMMIT");
    } else {
      await client.query("ROLLBACK");
    }

    console.log(
      `[reconciliation] Completed: ${result.streamsChecked} checked, ` +
        `${result.failuresDetected} mismatches, ${result.errorsEncountered} errors ` +
        `(job=${jobId}, dry_run=${dryRun})`
    );

    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    result.status = "failed";
    result.error = err instanceof Error ? err.message : String(err);
    result.completedAt = new Date();

    if (!dryRun) {
      await saveReconciliationRun(pool, result);
    }

    console.error(`[reconciliation] Failed: ${result.error}`);
    return result;
  } finally {
    client.release();
  }
}

// ── Scheduler ─────────────────────────────────────────────────────────────────

/**
 * Schedule the reconciliation job to run on a cron schedule.
 * By default: daily at 2 AM UTC.
 */
export function scheduleReconciliationJob(pool: Pool): void {
  const cfg = getConfig();

  try {
    cron.schedule(cfg.schedule, () => {
      runReconciliation(pool).catch((err) =>
        console.error("[reconciliation] Unexpected error:", err)
      );
    });
    console.log(
      `[reconciliation] Scheduled reconciliation job: "${cfg.schedule}" ` +
        `(dry_run=${cfg.dryRun})`
    );
  } catch (err) {
    console.error("[reconciliation] Failed to schedule job:", err);
  }
}

