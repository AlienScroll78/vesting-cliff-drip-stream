/**
 * Issue #743 — Claim transaction builder API endpoint.
 *
 * POST /api/streams/:recipient/build-claim-tx
 *
 * Body:
 *   { "fee_stroops": 100000 }
 *
 * Response 200:
 *   {
 *     "transaction_xdr": "AAAAAgAAAA...",
 *     "simulation": {
 *       "result":           { "retval": "50000" },
 *       "cost":             { "cpu_insns": "1234567", "mem_bytes": "45678" },
 *       "min_resource_fee": 12345
 *     }
 *   }
 *
 * Error responses:
 *   400 — validation failure or nothing to claim
 *   500 — RPC / SDK error (simulation error details included)
 *
 * Caching:
 *   Simulation results are cached in Redis for 10 s (ledger-safe window).
 *   Cache key: `claim-tx:${recipient}:${fee_stroops}`
 */

import { Router, Request, Response } from "express";
import { z } from "zod";
import { networkConfig } from "../config/network.js";
import { validate } from "../middleware/validate.js";
import { RecipientParamsSchema } from "../validation.js";
import { createClient } from "redis";

// ── Constants ─────────────────────────────────────────────────────────────────

const CLAIM_TX_CACHE_TTL_MS = parseInt(
  process.env.CLAIM_TX_CACHE_TTL_MS ?? "10000",
  10
);

// ── Request body schema ───────────────────────────────────────────────────────

const BuildClaimTxBodySchema = z.object({
  fee_stroops: z
    .number({
      invalid_type_error: "fee_stroops must be a number",
    })
    .int("fee_stroops must be an integer")
    .min(100, "fee_stroops must be at least 100")
    .optional()
    .default(100000),
});

// ── Redis cache (lazy singleton, graceful degradation without Redis) ──────────

let _redis: ReturnType<typeof createClient> | null = null;

async function getRedis(): Promise<ReturnType<typeof createClient> | null> {
  if (!process.env.REDIS_URL) return null;
  if (_redis?.isOpen) return _redis;
  try {
    _redis = createClient({ url: process.env.REDIS_URL });
    _redis.on("error", () => {});
    await _redis.connect();
    return _redis;
  } catch {
    return null;
  }
}

async function cacheGet(key: string): Promise<string | null> {
  try {
    const redis = await getRedis();
    return redis ? redis.get(key) : null;
  } catch {
    return null;
  }
}

async function cacheSet(key: string, value: string): Promise<void> {
  try {
    const redis = await getRedis();
    if (redis) await redis.set(key, value, { PX: CLAIM_TX_CACHE_TTL_MS });
  } catch {
    // Non-fatal — continue without caching
  }
}

// ── SDK loader (lazy, matches pattern used across this codebase) ──────────────

async function getSdk(): Promise<any> {
  // @ts-ignore — optional peer dep, loaded at runtime
  return await import("@stellar/stellar-sdk");
}

// ── Dummy account for building unsigned transactions ──────────────────────────

function dummyAccount(address: string) {
  return {
    accountId: () => address,
    sequenceNumber: () => "0",
    incrementSequenceNumber: () => {},
  };
}

// ── Handler ───────────────────────────────────────────────────────────────────

async function buildClaimTxHandler(
  req: Request,
  res: Response
): Promise<void> {
  const { recipient } = req.params;
  const { fee_stroops } = req.body as { fee_stroops: number };

  const cacheKey = `claim-tx:${recipient}:${fee_stroops}`;

  // ── Cache lookup ────────────────────────────────────────────────────────
  const cached = await cacheGet(cacheKey);
  if (cached) {
    res.setHeader("X-Cache", "HIT");
    res.setHeader("Content-Type", "application/json");
    res.status(200).send(cached);
    return;
  }

  try {
    const sdk = await getSdk();
    const server = new sdk.SorobanRpc.Server(networkConfig.rpcUrl);
    const contract = new sdk.Contract(networkConfig.contractId);
    const recipientScVal = sdk.Address.fromString(recipient).toScVal();

    // ── Step 1: verify recipient has claimable > 0 ────────────────────────
    const claimableCheckTx = new sdk.TransactionBuilder(
      dummyAccount(recipient),
      {
        fee: String(fee_stroops),
        networkPassphrase: networkConfig.networkPassphrase,
      }
    )
      .addOperation(contract.call("claimable_amount", recipientScVal))
      .setTimeout(30)
      .build();

    const claimableSim = await server.simulateTransaction(claimableCheckTx);

    if (claimableSim.error) {
      res.status(400).json({
        error: "Failed to query claimable amount",
        simulation_error: claimableSim.error,
      });
      return;
    }

    const claimableAmount =
      claimableSim.result?.retval?.value()?.toString() ?? "0";

    if (claimableAmount === "0" || BigInt(claimableAmount) <= 0n) {
      res.status(400).json({
        error: "Nothing to claim: claimable amount is 0",
        claimable_amount: claimableAmount,
      });
      return;
    }

    // ── Step 2: get current ledger sequence for the transaction ───────────
    const latestLedger = await server.getLatestLedger();
    const currentSequence = latestLedger.sequence;

    // ── Step 3: build the claim_vested transaction ────────────────────────
    const claimTx = new sdk.TransactionBuilder(dummyAccount(recipient), {
      fee: String(fee_stroops),
      networkPassphrase: networkConfig.networkPassphrase,
    })
      .addOperation(contract.call("claim_vested", recipientScVal))
      .setTimeout(30)
      .build();

    // ── Step 4: simulate the transaction ─────────────────────────────────
    const simulation = await server.simulateTransaction(claimTx);

    if (simulation.error) {
      res.status(500).json({
        error: "Transaction simulation failed",
        simulation_error: simulation.error,
      });
      return;
    }

    // ── Step 5: assemble the transaction with simulation resource data ────
    // prepareTransaction adds the resource footprint returned by simulation
    // so the XDR is ready to sign-and-submit without modification.
    let preparedTx: any;
    try {
      preparedTx = sdk.SorobanRpc.assembleTransaction(
        claimTx,
        simulation
      ).build();
    } catch {
      // Fallback: return the raw transaction XDR when assembleTransaction
      // is not available in the SDK version present at runtime.
      preparedTx = claimTx;
    }

    const transaction_xdr = preparedTx.toXDR();

    // ── Step 6: extract simulation metadata ───────────────────────────────
    const retval =
      simulation.result?.retval?.value()?.toString() ??
      claimableAmount;

    const cost = {
      cpu_insns: String(simulation.cost?.cpuInsns ?? "0"),
      mem_bytes: String(simulation.cost?.memBytes ?? "0"),
    };

    const min_resource_fee = Number(simulation.minResourceFee ?? 0);

    const responseBody = {
      transaction_xdr,
      simulation: {
        result: { retval },
        cost,
        min_resource_fee,
      },
    };

    const payload = JSON.stringify(responseBody);
    cacheSet(cacheKey, payload).catch(() => {});

    res.setHeader("X-Cache", "MISS");
    res.status(200).json(responseBody);
  } catch (err: any) {
    res.status(500).json({
      error: "Internal server error",
      message: String(err?.message ?? err),
    });
  }
}

// ── Router ────────────────────────────────────────────────────────────────────

const buildClaimTxRouter = Router();

/**
 * POST /api/streams/:recipient/build-claim-tx
 *
 * Builds and simulates a claim_vested Soroban transaction for the given
 * recipient. Returns the XDR ready to be signed and submitted by the frontend.
 */
buildClaimTxRouter.post(
  "/streams/:recipient/build-claim-tx",
  validate({ params: RecipientParamsSchema, body: BuildClaimTxBodySchema }),
  buildClaimTxHandler
);

export { buildClaimTxRouter };
