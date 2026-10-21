import { Router, type Request, type Response } from "express";
import { createClient } from "redis";
import { pool } from "../db.js";
import { networkConfig } from "../config/network.js";
import { validate } from "../middleware/validate.js";
import { RecipientParamsSchema } from "../validation.js";

const CLAIMABLE_TTL_SECONDS = 30;
const router = Router();
let redis: ReturnType<typeof createClient> | null = null;

function jsonInteger(value: unknown): number | string {
  const text = String(value ?? "0");
  const number = Number(text);
  return Number.isSafeInteger(number) ? number : text;
}

async function getRedis(): Promise<ReturnType<typeof createClient> | null> {
  if (!process.env.REDIS_URL) return null;
  if (redis?.isOpen) return redis;
  try {
    redis = createClient({ url: process.env.REDIS_URL });
    redis.on("error", () => {});
    await redis.connect();
    return redis;
  } catch {
    redis = null;
    return null;
  }
}

async function getCachedClaimable(recipient: string): Promise<string | null> {
  try {
    const client = await getRedis();
    const cached = client ? await client.get(`stream:claimable:${recipient}`) : null;
    console.info(`[streams] claimable cache ${cached === null ? "miss" : "hit"}`);
    return cached;
  } catch {
    console.info("[streams] claimable cache miss");
    return null;
  }
}

async function cacheClaimable(recipient: string, amount: string): Promise<void> {
  try {
    const client = await getRedis();
    if (client) {
      await client.set(`stream:claimable:${recipient}`, amount, {
        EX: CLAIMABLE_TTL_SECONDS,
      });
    }
  } catch {
    return;
  }
}

async function getClaimableAmount(recipient: string): Promise<string> {
  const cached = await getCachedClaimable(recipient);
  if (cached !== null) return cached;

  const sdk = await import("@stellar/stellar-sdk");
  const network = networkConfig.network.toUpperCase();
  const rpcUrl = process.env[`${network}_RPC_URL`] ?? networkConfig.rpcUrl;
  const contractId =
    process.env[`${network}_CONTRACT_ID`] ??
    process.env.CONTRACT_ID ??
    networkConfig.contractId;
  if (!contractId) throw new Error("Contract ID is not configured");

  const server = new sdk.SorobanRpc.Server(rpcUrl);
  const contract = new sdk.Contract(contractId);
  const account = {
    accountId: () => recipient,
    sequenceNumber: () => "0",
    incrementSequenceNumber: () => {},
  };
  const transaction = new sdk.TransactionBuilder(account, {
    fee: sdk.BASE_FEE,
    networkPassphrase: networkConfig.networkPassphrase,
  })
    .addOperation(
      contract.call(
        "claimable_amount",
        sdk.Address.fromString(recipient).toScVal(),
      ),
    )
    .setTimeout(15)
    .build();
  const simulation = await server.simulateTransaction(transaction);
  const retval = simulation.result?.retval;
  if (!retval) throw new Error("Soroban RPC returned no claimable amount");

  const amount = retval.value().toString();
  await cacheClaimable(recipient, amount);
  return amount;
}

async function streamDetailsHandler(req: Request, res: Response): Promise<void> {
  const { recipient } = req.params;
  try {
    const result = await pool.query(
      `SELECT
         vs.recipient_address AS recipient,
         vs.sponsor_address AS sponsor,
         vs.token_address AS token,
         vs.rate_per_ledger::text AS rate,
         vs.cliff_ledger,
         vs.end_ledger,
         COALESCE(
           stream_totals.total_deposited,
           (vs.end_ledger - vs.start_ledger) * vs.rate_per_ledger
         )::text AS total_deposited,
         COALESCE(stream_totals.total_claimed, 0)::text AS total_claimed,
         vs.status,
         vs.created_at,
         vs.cancelled_at,
         vs.cancelled_at_ledger,
         vs.refunded_amount::text AS sponsor_refund,
         vs.cancellation_tx_hash,
         vs.cancellation_recipient_payout::text AS recipient_payout,
         vs.clawed_at_ledger,
         vs.clawback_sponsor,
         vs.clawback_amount::text AS clawback_amount,
         vs.clawback_reason,
         vs.clawback_tx_hash
       FROM vesting_streams vs
       LEFT JOIN LATERAL (
         SELECT
           SUM(se.amount) FILTER (WHERE se.event_type = 'vc_create') AS total_deposited,
           SUM(se.amount) FILTER (WHERE se.event_type = 'vc_claim') AS total_claimed
         FROM stream_events se
         WHERE se.recipient = vs.recipient_address
       ) stream_totals ON true
       WHERE vs.recipient_address = $1`,
      [recipient],
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: "stream not found" });
      return;
    }

    const row = result.rows[0];

    // Build the terminal event details object based on the current status
    let terminal_event: Record<string, unknown> | null = null;
    if (row.status === "cancelled") {
      terminal_event = {
        type: "StreamCancelled",
        cancelled_at_ledger: row.cancelled_at_ledger,
        sponsor_refund: jsonInteger(row.sponsor_refund ?? "0"),
        recipient_payout: jsonInteger(row.recipient_payout ?? "0"),
        tx_hash: row.cancellation_tx_hash,
        cancelled_at: row.cancelled_at,
      };
    } else if (row.status === "clawedback") {
      terminal_event = {
        type: "StreamClawedBack",
        clawed_at_ledger: row.clawed_at_ledger,
        sponsor: row.clawback_sponsor,
        amount: jsonInteger(row.clawback_amount ?? "0"),
        reason: row.clawback_reason,
        tx_hash: row.clawback_tx_hash,
      };
    } else if (row.status === "drained") {
      // StreamDrained is also a terminal event; details can be fetched
      // from stream_events if needed.
      terminal_event = {
        type: "StreamDrained",
      };
    }

    // For terminal streams, skip the RPC claimable_amount call
    // (no claimable tokens remain in a terminal state).
    let claimableNow: string;
    const isTerminal = ["cancelled", "drained", "clawedback"].includes(row.status);
    if (isTerminal) {
      claimableNow = "0";
    } else {
      try {
        claimableNow = await getClaimableAmount(recipient);
      } catch (error) {
        console.error("[streams] Soroban claimable_amount failed", error);
        res.status(503).json({ error: "claimable amount temporarily unavailable" });
        return;
      }
    }

    res.status(200).json({
      recipient: row.recipient,
      sponsor: row.sponsor,
      token: row.token,
      rate: jsonInteger(row.rate),
      cliff_ledger: row.cliff_ledger,
      end_ledger: row.end_ledger,
      total_deposited: jsonInteger(row.total_deposited),
      total_claimed: jsonInteger(row.total_claimed),
      status: row.status,
      created_at: row.created_at,
      claimable_now: jsonInteger(claimableNow),
      terminal_event: terminal_event,
    });
  } catch (error) {
    console.error("[streams] database query failed", error);
    res.status(500).json({ error: "Internal server error" });
  }
}

router.get("/:recipient", validate({ params: RecipientParamsSchema }), streamDetailsHandler);

export { router as streamDetailsRouter, streamDetailsHandler };
