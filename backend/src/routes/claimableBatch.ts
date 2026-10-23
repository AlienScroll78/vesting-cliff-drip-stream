/**
 * Issue #1062 — GET /api/claimable-batch
 *
 * Batch counterpart of the single-recipient claimable lookup. Mirrors the
 * on-chain `get_claimable_batch(recipients)` view (issue #728): the contract
 * returns one `(recipient, amount)` pair per requested recipient, preserving
 * the input order, with `0` for recipients that have no stream, have not
 * reached their cliff, or whose stream is paused.
 *
 * The response shape is covered by snapshot tests so that an accidental
 * breaking change to the schema is caught in CI.
 */

import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { networkConfig } from "../config/network.js";
import { validate } from "../middleware/validate.js";
import { StellarAddressSchema } from "../validation.js";

/** Mirrors the contract's `MAX_BATCH_SIZE` (src/contract.rs). */
export const MAX_CLAIMABLE_BATCH_SIZE = 20;

/** Query schema: up to 20 comma-separated Stellar addresses. */
export const ClaimableBatchQuerySchema = z.object({
  recipients: z
    .string({ required_error: "recipients query parameter is required" })
    .min(1, "recipients must not be empty")
    .transform((raw) =>
      raw
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean),
    )
    .pipe(
      z
        .array(StellarAddressSchema)
        .min(1, "at least one recipient is required")
        .max(
          MAX_CLAIMABLE_BATCH_SIZE,
          `at most ${MAX_CLAIMABLE_BATCH_SIZE} recipients are allowed per request`,
        ),
    ),
});

/**
 * Simulates a read-only contract call and returns the decoded retval.
 *
 * The SDK is imported lazily so the backend can run without the optional
 * `@stellar/stellar-sdk` peer dependency installed.
 */
async function simulateViewCall(
  sdk: any,
  contractId: string,
  method: string,
  ...args: any[]
): Promise<unknown> {
  const server = new sdk.SorobanRpc.Server(networkConfig.rpcUrl);
  const contract = new sdk.Contract(contractId);
  const account = {
    accountId: () => "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
    sequenceNumber: () => "0",
    incrementSequenceNumber: () => {},
  };
  const transaction = new sdk.TransactionBuilder(account, {
    fee: sdk.BASE_FEE,
    networkPassphrase: networkConfig.networkPassphrase,
  })
    .addOperation(contract.call(method, ...args))
    .setTimeout(15)
    .build();

  const simulation = await server.simulateTransaction(transaction);
  const retval = simulation.result?.retval;
  if (!retval) throw new Error("Soroban RPC returned no result");
  return sdk.scValToNative(retval);
}

export async function claimableBatchHandler(
  req: Request,
  res: Response,
): Promise<void> {
  const recipients = (req.query as unknown as { recipients: string[] }).recipients;
  try {
    // @ts-ignore — optional peer dependency
    const sdk = await import("@stellar/stellar-sdk");
    const contractId =
      process.env[`${networkConfig.network.toUpperCase()}_CONTRACT_ID`] ??
      process.env.CONTRACT_ID ??
      networkConfig.contractId;
    if (!contractId) throw new Error("Contract ID is not configured");

    const native = await simulateViewCall(
      sdk,
      contractId,
      "get_claimable_batch",
      sdk.nativeToScVal(recipients, {
        type: "vec",
        typeArgs: { type: "address" },
      }),
    );

    const entries = (native ?? []) as Array<[string, bigint | string | number]>;
    res.status(200).json({
      results: entries.map(([recipient, amount]) => ({
        recipient: String(recipient),
        claimable_amount: BigInt(amount as bigint).toString(),
      })),
    });
  } catch (error) {
    console.error("[claimable-batch] contract call failed", error);
    res.status(503).json({ error: "claimable batch temporarily unavailable" });
  }
}

export const claimableBatchRouter = Router();
claimableBatchRouter.get(
  "/claimable-batch",
  validate({ query: ClaimableBatchQuerySchema }),
  claimableBatchHandler,
);
