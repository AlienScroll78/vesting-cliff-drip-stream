"use strict";

/**
 * POST /admin/bulk-claim
 *
 * Triggers claim transactions on behalf of a list of recipients.
 * Requires admin auth scope (Authorization: Bearer <ADMIN_API_KEY>).
 *
 * Request body:
 *   { "recipients": ["G...", "G..."] }
 *
 * Response 200:
 *   {
 *     "results": [
 *       { "recipient": "G...", "success": true,  "amount_claimed": 500 },
 *       { "recipient": "G...", "success": false, "error": "CliffNotReached" }
 *     ]
 *   }
 */

const { StellarSdk, loadConfig } = require("../lib");
const { logger, redactAddress } = require("../logger");

function requireAdminAuth(req, res) {
  const { ADMIN_API_KEY } = loadConfig();
  const auth = req.headers["authorization"] ?? "";
  if (!auth.startsWith("Bearer ") || auth.slice(7) !== ADMIN_API_KEY) {
    logger.warn({ event: "admin_auth_failed", path: req.url }, "Unauthorized admin access attempt");
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Unauthorized" }));
    return false;
  }
  return true;
}

/**
 * Submit a claim_vested transaction for a single recipient.
 * Returns { success, amount_claimed?, error? }.
 */
async function claimForRecipient(recipient, config) {
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
        "claim_vested",
        StellarSdk.Address.fromString(recipient).toScVal(),
      ),
    )
    .setTimeout(30)
    .build();

  const prepared = await server.prepareTransaction(tx);
  prepared.sign(sponsorKeypair);
  const result = await server.sendTransaction(prepared);

  if (result.status === "ERROR") {
    return { success: false, error: result.errorResult ?? "submission_error" };
  }

  // Poll for confirmation
  let getResult = await server.getTransaction(result.hash);
  for (let i = 0; i < 10 && getResult.status === "NOT_FOUND"; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    getResult = await server.getTransaction(result.hash);
  }

  if (getResult.status === "SUCCESS") {
    const retVal = getResult.returnValue;
    const amount =
      retVal?.value !== undefined ? Number(retVal.value()) : null;
    return { success: true, amount_claimed: amount };
  }

  return { success: false, error: getResult.resultXdr ?? "unknown" };
}

/**
 * Handler for POST /admin/bulk-claim.
 * Express-compatible: handler(req, res).
 */
async function bulkClaimHandler(req, res) {
  if (!requireAdminAuth(req, res)) return;

  let body = "";
  await new Promise((resolve) => {
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", resolve);
  });

  let recipients;
  try {
    ({ recipients } = JSON.parse(body));
  } catch {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "invalid JSON" }));
    return;
  }

  if (!Array.isArray(recipients) || recipients.length === 0) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "recipients must be a non-empty array" }));
    return;
  }

  logger.info(
    { event: "bulk_claim_started", count: recipients.length },
    `Starting bulk claim for ${recipients.length} recipient(s)`,
  );

  const config = loadConfig();
  const results = [];

  // Process sequentially so failures don't block each other
  for (const recipient of recipients) {
    try {
      const outcome = await claimForRecipient(String(recipient), config);
      results.push({ recipient, ...outcome });

      if (outcome.success) {
        logger.info(
          {
            event: "claim_success",
            recipient: redactAddress(String(recipient)),
            amount_claimed: outcome.amount_claimed,
          },
          `Claim succeeded for ${redactAddress(String(recipient))}`,
        );
      } else {
        logger.warn(
          {
            event: "claim_failed",
            recipient: redactAddress(String(recipient)),
            error: outcome.error,
          },
          `Claim failed for ${redactAddress(String(recipient))}: ${outcome.error}`,
        );
      }
    } catch (err) {
      const errMsg = String(err.message ?? err);
      results.push({ recipient, success: false, error: errMsg });
      logger.error(
        {
          event: "claim_exception",
          recipient: redactAddress(String(recipient)),
          err,
        },
        `Exception during claim for ${redactAddress(String(recipient))}`,
      );
    }
  }

  const succeeded = results.filter((r) => r.success).length;
  logger.info(
    { event: "bulk_claim_completed", total: results.length, succeeded, failed: results.length - succeeded },
    `Bulk claim completed: ${succeeded}/${results.length} succeeded`,
  );

  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ results }));
}

module.exports = { bulkClaimHandler };
