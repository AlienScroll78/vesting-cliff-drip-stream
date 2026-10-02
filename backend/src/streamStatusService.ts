/**
 * Issue #753 — Stream status state machine service
 *
 * Provides the application-layer state machine that wraps the database-level
 * transition enforcement.  All status updates MUST go through this module
 * so that:
 *   1. The transition is validated before the DB call.
 *   2. The transition is applied atomically in the same transaction as the
 *      triggering event insert (when applicable).
 *   3. The audit trail in stream_status_transitions is always complete.
 *
 * Valid transitions (mirrored from the DB trigger):
 *   active     → cancelled   (StreamCancelled event)
 *   active     → expired     (background job)
 *   pre_cliff  → active      (cliff reached)
 *   pre_cliff  → cancelled   (StreamCancelled event)
 *   pre_cliff  → expired     (background job)
 *   expired    → drained     (StreamDrained event)
 *
 * Invalid transitions (e.g. active → drained) throw a StatusTransitionError
 * which the caller can catch and map to the appropriate HTTP status.
 */

import { Pool, PoolClient } from "pg";

// ── Types ─────────────────────────────────────────────────────────────────────

export type StreamStatus =
  | "active"
  | "pre_cliff"
  | "expired"
  | "cancelled"
  | "drained";

export type TriggeringEvent =
  | "StreamCreated"
  | "TokensClaimed"
  | "StreamCancelled"
  | "StreamDrained"
  | "StreamClawedBack"
  | "background_expiry_job";

export interface StatusTransitionOptions {
  /** Database pool (or client for transactional usage). */
  db: Pool | PoolClient;
  /** Recipient address of the stream to update. */
  recipientAddress: string;
  /** Target status to transition to. */
  toStatus: StreamStatus;
  /** What triggered this transition (stored in the audit log). */
  triggeringEvent?: TriggeringEvent;
  /** Ledger sequence of the on-chain event (if applicable). */
  ledgerSequence?: number;
}

export interface StatusTransitionResult {
  recipientAddress: string;
  fromStatus: StreamStatus;
  toStatus: StreamStatus;
  statusUpdatedAt: Date;
}

// ── Errors ────────────────────────────────────────────────────────────────────

export class StatusTransitionError extends Error {
  constructor(
    public readonly from: StreamStatus,
    public readonly to: StreamStatus,
  ) {
    super(
      `Invalid stream status transition: ${from} → ${to}. ` +
        `Allowed: active→cancelled|expired, pre_cliff→active|cancelled|expired, expired→drained`,
    );
    this.name = "StatusTransitionError";
  }
}

export class StreamNotFoundError extends Error {
  constructor(public readonly recipientAddress: string) {
    super(`Stream not found for recipient: ${recipientAddress}`);
    this.name = "StreamNotFoundError";
  }
}

// ── Valid transition table ────────────────────────────────────────────────────

const VALID_TRANSITIONS: Record<StreamStatus, readonly StreamStatus[]> = {
  active:    ["cancelled", "expired"],
  pre_cliff: ["active", "cancelled", "expired"],
  expired:   ["drained"],
  cancelled: [], // terminal state
  drained:   [], // terminal state
};

/**
 * Check whether a status transition is valid.
 * Identity transitions (same → same) are always valid.
 */
export function isValidTransition(
  from: StreamStatus,
  to: StreamStatus,
): boolean {
  if (from === to) return true;
  return (VALID_TRANSITIONS[from] as StreamStatus[]).includes(to);
}

// ── Core transition function ──────────────────────────────────────────────────

/**
 * Transition a stream's status in the database.
 *
 * This function validates the transition at the application layer before
 * issuing the UPDATE, providing a cleaner error than a raw DB exception.
 * The database trigger provides a second layer of enforcement.
 *
 * For transactional usage (atomically with an event insert), pass a
 * PoolClient obtained from pool.connect() and manage the transaction
 * externally.
 */
export async function transitionStreamStatus(
  opts: StatusTransitionOptions,
): Promise<StatusTransitionResult> {
  const { db, recipientAddress, toStatus, triggeringEvent, ledgerSequence } =
    opts;

  // ── Fetch current status (lock the row for update in tx context) ──────────
  const currentRow = await db.query<{
    status: StreamStatus;
    status_updated_at: Date;
  }>(
    `SELECT status, status_updated_at
     FROM vesting_streams
     WHERE recipient_address = $1
     FOR UPDATE`,
    [recipientAddress],
  );

  if (currentRow.rowCount === 0) {
    throw new StreamNotFoundError(recipientAddress);
  }

  const fromStatus = currentRow.rows[0].status;

  // Identity transition — nothing to do.
  if (fromStatus === toStatus) {
    return {
      recipientAddress,
      fromStatus,
      toStatus,
      statusUpdatedAt: currentRow.rows[0].status_updated_at,
    };
  }

  // Application-level guard (DB trigger is the second guard).
  if (!isValidTransition(fromStatus, toStatus)) {
    throw new StatusTransitionError(fromStatus, toStatus);
  }

  // ── Apply the transition ──────────────────────────────────────────────────
  const updateRow = await db.query<{
    status: StreamStatus;
    status_updated_at: Date;
  }>(
    `UPDATE vesting_streams
     SET status = $1::stream_status_type
     WHERE recipient_address = $2
     RETURNING status, status_updated_at`,
    [toStatus, recipientAddress],
  );

  // ── Write explicit triggering-event metadata to the audit row ─────────────
  // The DB trigger inserts the base audit row (without triggering_event /
  // ledger_sequence). We update the most-recent transition row here so the
  // audit trail is complete.
  if (triggeringEvent || ledgerSequence !== undefined) {
    await db.query(
      `UPDATE stream_status_transitions
       SET triggering_event = COALESCE($1, triggering_event),
           ledger_sequence   = COALESCE($2, ledger_sequence)
       WHERE recipient_address = $3
         AND from_status = $4::stream_status_type
         AND to_status   = $5::stream_status_type
         AND id = (
           SELECT id FROM stream_status_transitions
           WHERE recipient_address = $3
             AND from_status = $4::stream_status_type
             AND to_status   = $5::stream_status_type
           ORDER BY created_at DESC
           LIMIT 1
         )`,
      [
        triggeringEvent ?? null,
        ledgerSequence ?? null,
        recipientAddress,
        fromStatus,
        toStatus,
      ],
    );
  }

  return {
    recipientAddress,
    fromStatus,
    toStatus,
    statusUpdatedAt: updateRow.rows[0].status_updated_at,
  };
}

// ── Bulk expiry transition ────────────────────────────────────────────────────

/**
 * Transition all streams whose end_ledger < currentLedger from
 * active/pre_cliff → expired in a single UPDATE statement.
 *
 * Used by the background expiry job.  Returns the number of rows updated.
 */
export async function expireStreams(
  db: Pool,
  currentLedger: number,
): Promise<number> {
  const result = await db.query(
    `UPDATE vesting_streams
     SET status = 'expired'::stream_status_type
     WHERE status IN ('active'::stream_status_type, 'pre_cliff'::stream_status_type)
       AND end_ledger < $1`,
    [currentLedger],
  );
  return result.rowCount ?? 0;
}

// ── Get current status ────────────────────────────────────────────────────────

export async function getStreamStatus(
  db: Pool,
  recipientAddress: string,
): Promise<{ status: StreamStatus; statusUpdatedAt: Date } | null> {
  const result = await db.query<{
    status: StreamStatus;
    status_updated_at: Date;
  }>(
    `SELECT status, status_updated_at
     FROM vesting_streams
     WHERE recipient_address = $1`,
    [recipientAddress],
  );

  if (result.rowCount === 0) return null;

  return {
    status: result.rows[0].status,
    statusUpdatedAt: result.rows[0].status_updated_at,
  };
}
