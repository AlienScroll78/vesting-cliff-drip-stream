/**
 * Admin contract-management routes — closes #742
 *
 * POST /api/admin/set_min_deposit  — update the contract's minimum deposit
 * POST /api/admin/pause_stream     — pause a specific vesting stream
 *
 * Both routes require a valid RS256 JWT with role='admin'.
 * All actions are audit-logged with the JWT subject (wallet address).
 *
 * Acceptance criteria:
 *  [x] Unauthenticated → 401
 *  [x] Valid admin JWT → 200
 *  [x] Non-admin JWT  → 403
 *  [x] Token expiry handled → 401
 *  [x] Audit log entry for every admin action
 */

"use strict";

import { Router, Request, Response } from "express";
import { authMiddleware, requireRole } from "./authV2.js";
import { auditLog } from "../middleware/audit.js";
import { StellarSdk, loadConfig } from "../lib.js";

const router = Router();

// ---------------------------------------------------------------------------
// POST /api/admin/set_min_deposit
// ---------------------------------------------------------------------------

/**
 * Update the minimum deposit threshold on the vesting contract.
 *
 * Body: { min_deposit: string }   (i128 as decimal string)
 */
router.post(
  "/set_min_deposit",
  authMiddleware,
  requireRole("admin"),
  async (req: Request & { user?: { address: string; role: string } }, res: Response) => {
    const adminAddress = req.user!.address;
    const { min_deposit } = req.body ?? {};

    if (min_deposit === undefined || min_deposit === null) {
      res.status(400).json({ error: "min_deposit is required" });
      return;
    }

    const minDepositStr = String(min_deposit).trim();
    if (!/^\d+$/.test(minDepositStr)) {
      res.status(400).json({ error: "min_deposit must be a non-negative integer string" });
      return;
    }

    // Audit log before executing
    await auditLog({
      action: "set_min_deposit",
      subject: adminAddress,
      params: { min_deposit: minDepositStr },
    });

    try {
      const config = loadConfig();
      const server = new StellarSdk.SorobanRpc.Server(config.SOROBAN_RPC_URL);
      const sponsorKeypair = StellarSdk.Keypair.fromSecret(config.SPONSOR_SECRET_KEY);
      const account = await server.getAccount(sponsorKeypair.publicKey());

      const contract = new StellarSdk.Contract(config.CONTRACT_ID);
      const tx = new StellarSdk.TransactionBuilder(account, {
        fee: StellarSdk.BASE_FEE,
        networkPassphrase: config.NETWORK_PASSPHRASE,
      })
        .addOperation(
          contract.call(
            "set_min_deposit",
            StellarSdk.xdr.ScVal.scvI128(
              new StellarSdk.xdr.Int128Parts({
                hi: StellarSdk.xdr.Int64.fromString("0"),
                lo: StellarSdk.xdr.Uint64.fromString(minDepositStr),
              })
            )
          )
        )
        .setTimeout(30)
        .build();

      const prepared = await server.prepareTransaction(tx);
      prepared.sign(sponsorKeypair);
      const result = await server.sendTransaction(prepared);

      if (result.status === "ERROR") {
        res.status(502).json({ error: "contract call failed", detail: result.errorResult });
        return;
      }

      res.status(200).json({
        ok: true,
        min_deposit: minDepositStr,
        tx_hash: result.hash,
      });
    } catch (err: unknown) {
      console.error("[admin] set_min_deposit error:", err);
      res.status(500).json({ error: "internal server error" });
    }
  }
);

// ---------------------------------------------------------------------------
// POST /api/admin/pause_stream
// ---------------------------------------------------------------------------

/**
 * Pause a vesting stream for a given recipient.
 *
 * Body: { recipient: "G..." }
 */
router.post(
  "/pause_stream",
  authMiddleware,
  requireRole("admin"),
  async (req: Request & { user?: { address: string; role: string } }, res: Response) => {
    const adminAddress = req.user!.address;
    const { recipient } = req.body ?? {};

    if (!recipient) {
      res.status(400).json({ error: "recipient is required" });
      return;
    }

    if (!/^G[A-Z2-7]{55}$/.test(String(recipient))) {
      res.status(400).json({ error: "recipient must be a valid Stellar public key" });
      return;
    }

    // Audit log before executing
    await auditLog({
      action: "pause_stream",
      subject: adminAddress,
      params: { recipient },
    });

    try {
      const config = loadConfig();
      const server = new StellarSdk.SorobanRpc.Server(config.SOROBAN_RPC_URL);
      const sponsorKeypair = StellarSdk.Keypair.fromSecret(config.SPONSOR_SECRET_KEY);
      const account = await server.getAccount(sponsorKeypair.publicKey());

      const contract = new StellarSdk.Contract(config.CONTRACT_ID);
      const tx = new StellarSdk.TransactionBuilder(account, {
        fee: StellarSdk.BASE_FEE,
        networkPassphrase: config.NETWORK_PASSPHRASE,
      })
        .addOperation(
          contract.call(
            "pause_stream",
            StellarSdk.Address.fromString(String(recipient)).toScVal()
          )
        )
        .setTimeout(30)
        .build();

      const prepared = await server.prepareTransaction(tx);
      prepared.sign(sponsorKeypair);
      const result = await server.sendTransaction(prepared);

      if (result.status === "ERROR") {
        res.status(502).json({ error: "contract call failed", detail: result.errorResult });
        return;
      }

      res.status(200).json({
        ok: true,
        recipient,
        tx_hash: result.hash,
      });
    } catch (err: unknown) {
      console.error("[admin] pause_stream error:", err);
      res.status(500).json({ error: "internal server error" });
    }
  }
);

export { router as adminContractRouter };
