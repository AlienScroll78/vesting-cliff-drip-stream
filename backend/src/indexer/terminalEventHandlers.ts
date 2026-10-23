/**
 * backend/src/indexer/terminalEventHandlers.ts  (#997)
 *
 * Handlers for terminal stream events: StreamCancelled and StreamClawedBack.
 *
 * Both events update the stream status to a terminal state and record the
 * final split of funds.  The handlers enforce status transitions: only
 * 'active' or 'pre_cliff' streams can be cancelled or clawed back.
 *
 * Each handler is designed to be called from within the upsertStreamEvents
 * transaction, ensuring atomicity with the event insert.  The handlers are
 * idempotent: if the event was already processed (duplicate tx_hash), the
 * ON CONFLICT DO NOTHING on stream_events prevents re-insertion, so the
 * handler is never called a second time for the same event.
 *
 * For out-of-order event arrival (e.g. a StreamCancelled arriving before
 * the StreamCreated), the handler logs a warning and skips the status
 * transition, but the event itself is still persisted in stream_events.
 * When the StreamCreated event is eventually processed, the stream row is
 * created with 'active' status.  A subsequent reconciliation pass (or
 * manual backfill) can then apply the missed terminal transition.
 */

import type { PoolClient } from "pg";
import type { DecodedStreamEvent } from "./types.js";
import {
  transitionStreamStatus,
  StatusTransitionError,
  StreamNotFoundError,
} from "../streamStatusService.js";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface TerminalEventResult {
  recipient: string;
  event_type: "StreamCancelled" | "StreamClawedBack";
  status_changed: boolean;
  from_status: string | null;
  to_status: string | null;
}

// ── StreamCancelled handler ────────────────────────────────────────────────────

/**
 * Process a StreamCancelled event:
 *   - Record sponsor_refund, recipient_payout, cancelled_at_ledger, tx_hash
 *   - Set stream status = 'cancelled'
 *
 * Status transition: only 'active' or 'pre_cliff' streams can be cancelled.
 * If the stream is already in a terminal state (cancelled/drained/clawedback),
 * the event is logged but no transition is attempted (idempotency).
 *
 * @param client  A connected PoolClient (must be inside a transaction).
 * @param ev      The decoded StreamCancelled event.
 * @returns       Result describing what happened.
 */
export async function handleStreamCancelled(
  client: PoolClient,
  ev: DecodedStreamEvent,
): Promise<TerminalEventResult> {
  const result: TerminalEventResult = {
    recipient: ev.recipient,
    event_type: "StreamCancelled",
    status_changed: false,
    from_status: null,
    to_status: null,
  };

  try {
    // Attempt the status transition (validates that stream exists and
    // is in a valid state for cancellation).
    const transition = await transitionStreamStatus({
      db: client,
      recipientAddress: ev.recipient,
      toStatus: "cancelled",
      triggeringEvent: "StreamCancelled",
      ledgerSequence: ev.ledger_sequence,
    });

    result.status_changed = transition.fromStatus !== transition.toStatus;
    result.from_status = transition.fromStatus;
    result.to_status = transition.toStatus;

    // Record the cancellation details on the vesting_streams row.
    // The amount field for StreamCancelled is the refunded_amount.
    const sponsorRefund = ev.amount ?? "0";

    await client.query(
      `UPDATE vesting_streams
       SET cancelled_at        = now(),
           cancelled_at_ledger = $2,
           refunded_amount     = $3,
           cancellation_tx_hash = $4
       WHERE recipient_address = $1`,
      [
        ev.recipient,
        ev.ledger_sequence,
        sponsorRefund,
        ev.transaction_hash,
      ],
    );

    // Also record the recipient payout if the sponsor address is known.
    // For post-cliff cancellations, the recipient received accrued tokens
    // via a separate transfer. The refunded_amount is the sponsor's portion.
    // We store it for audit purposes.
    if (ev.sponsor) {
      await client.query(
        `UPDATE vesting_streams
         SET cancellation_recipient_payout = COALESCE(
           (SELECT COALESCE(SUM(amount::numeric), 0)
            FROM stream_events
            WHERE recipient = $1
              AND event_type = 'TokensClaimed'),
           0
         )
         WHERE recipient_address = $1`,
        [ev.recipient],
      );
    }
  } catch (err) {
    if (err instanceof StreamNotFoundError) {
      // Stream not yet indexed (out-of-order event). The event is still
      // persisted in stream_events; a reconciliation pass can apply the
      // terminal transition later.
      console.warn(
        `[terminal-events] StreamCancelled for unknown recipient ${ev.recipient} — ` +
        `event persisted, transition deferred (out-of-order arrival)`,
      );
    } else if (err instanceof StatusTransitionError) {
      // Stream is already in a terminal state — idempotent skip.
      console.info(
        `[terminal-events] StreamCancelled for ${ev.recipient} skipped — ` +
        `stream already in terminal state: ${err.from} → ${err.to}`,
      );
    } else {
      throw err;
    }
  }

  return result;
}

// ── StreamClawedBack handler ──────────────────────────────────────────────────

/**
 * Process a StreamClawedBack event:
 *   - Record sponsor, amount, reason, clawed_at_ledger, tx_hash
 *   - Set stream status = 'clawedback'
 *
 * Status transition: only 'active' or 'pre_cliff' streams can be clawed back.
 * If the stream is already in a terminal state, the event is logged but no
 * transition is attempted (idempotency).
 *
 * @param client  A connected PoolClient (must be inside a transaction).
 * @param ev      The decoded StreamClawedBack event.
 * @returns       Result describing what happened.
 */
export async function handleStreamClawedBack(
  client: PoolClient,
  ev: DecodedStreamEvent,
): Promise<TerminalEventResult> {
  const result: TerminalEventResult = {
    recipient: ev.recipient,
    event_type: "StreamClawedBack",
    status_changed: false,
    from_status: null,
    to_status: null,
  };

  try {
    // Attempt the status transition
    const transition = await transitionStreamStatus({
      db: client,
      recipientAddress: ev.recipient,
      toStatus: "clawedback",
      triggeringEvent: "StreamClawedBack",
      ledgerSequence: ev.ledger_sequence,
    });

    result.status_changed = transition.fromStatus !== transition.toStatus;
    result.from_status = transition.fromStatus;
    result.to_status = transition.toStatus;

    // Record the clawback details on the vesting_streams row.
    // The decoded event contains: sponsor, token, amount, and reason.
    // Note: reason is not currently in the DecodedStreamEvent type;
    // it is part of the event data but not decoded as a separate field.
    // The amount field holds the total clawed-back amount.
    const clawbackAmount = ev.amount ?? "0";
    const sponsor = ev.sponsor || "";

    await client.query(
      `UPDATE vesting_streams
       SET clawed_at_ledger = $2,
           clawback_sponsor  = $3,
           clawback_amount   = $4,
           clawback_tx_hash  = $5
       WHERE recipient_address = $1`,
      [
        ev.recipient,
        ev.ledger_sequence,
        sponsor,
        clawbackAmount,
        ev.transaction_hash,
      ],
    );
  } catch (err) {
    if (err instanceof StreamNotFoundError) {
      console.warn(
        `[terminal-events] StreamClawedBack for unknown recipient ${ev.recipient} — ` +
        `event persisted, transition deferred (out-of-order arrival)`,
      );
    } else if (err instanceof StatusTransitionError) {
      console.info(
        `[terminal-events] StreamClawedBack for ${ev.recipient} skipped — ` +
        `stream already in terminal state: ${err.from} → ${err.to}`,
      );
    } else {
      throw err;
    }
  }

  return result;
}

// ── Dispatch function ─────────────────────────────────────────────────────────

/**
 * Dispatch a terminal event to the appropriate handler.
 *
 * Returns null for non-terminal event types.
 *
 * @param client  A connected PoolClient (must be inside a transaction).
 * @param ev      The decoded event.
 * @returns       The handler result, or null if not a terminal event.
 */
export async function handleTerminalEvent(
  client: PoolClient,
  ev: DecodedStreamEvent,
): Promise<TerminalEventResult | null> {
  switch (ev.event_type) {
    case "StreamCancelled":
      return handleStreamCancelled(client, ev);
    case "StreamClawedBack":
      return handleStreamClawedBack(client, ev);
    default:
      return null;
  }
}
