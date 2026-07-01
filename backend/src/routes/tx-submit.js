"use strict";

/**
 * POST /tx/submit
 *
 * Builds and submits a Soroban contract transaction for one of:
 *   - claim_vested
 *   - create_vesting_stream
 *   - cancel_stream
 *
 * Request body:
 *   { "operation": "<name>", "params": { ...operationParams, fee_bump?: boolean } }
 *
 * Response 200:
 *   { "hash": "abc123...", "status": "SUCCESS" | "PENDING" }
 *
 * Response 4xx/5xx:
 *   { "error": "..." }
 */

const { StellarSdk, loadConfig } = require("../lib");
const { cacheInvalidate } = require("../cache");

const INVALIDATING_OPS = new Set(["claim_vested", "cancel_stream"]);

const ALLOWED_OPS = ["claim_vested", "create_vesting_stream", "cancel_stream"];

/** Convert operation params to Soroban ScVal argument arrays. */
function buildArgs(operation, params) {
  const addr = (v) => StellarSdk.Address.fromString(v).toScVal();
  const i128 = (v) => StellarSdk.nativeToScVal(BigInt(v), { type: "i128" });
  const u32  = (v) => StellarSdk.nativeToScVal(Number(v), { type: "u32" });

  switch (operation) {
    case "claim_vested":
      return [addr(params.recipient)];
    case "create_vesting_stream":
      return [
        addr(params.sponsor),
        addr(params.recipient),
        addr(params.token),
        i128(params.rate),
        u32(params.cliff_duration),
        u32(params.total_duration),
      ];
    case "cancel_stream":
      return [addr(params.sponsor), addr(params.recipient)];
  }
}

/**
 * Build, sign, and submit an inner transaction.
 * Returns the sendTransaction result.
 */
async function buildAndSubmit(server, contract, operation, params, config) {
  // SECURITY: SIGNING_SECRET_KEY must never be logged or included in responses.
  const keypair = StellarSdk.Keypair.fromSecret(process.env.SIGNING_SECRET_KEY);
  const account = await server.getAccount(keypair.publicKey());

  const innerTx = new StellarSdk.TransactionBuilder(account, {
    fee: StellarSdk.BASE_FEE,
    networkPassphrase: config.NETWORK_PASSPHRASE,
  })
    .addOperation(contract.call(operation, ...buildArgs(operation, params)))
    .setTimeout(30)
    .build();

  const prepared = await server.prepareTransaction(innerTx);

  let txToSign = prepared;
  if (params.fee_bump === true) {
    txToSign = StellarSdk.TransactionBuilder.buildFeeBumpTransaction(
      keypair,
      String(10 * StellarSdk.BASE_FEE),
      prepared,
      config.NETWORK_PASSPHRASE,
    );
  }

  txToSign.sign(keypair);
  return server.sendTransaction(txToSign);
}

async function txSubmitHandler(req, res) {
  // Parse body
  let body = "";
  await new Promise((resolve) => {
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", resolve);
  });

  let operation, params;
  try {
    ({ operation, params } = JSON.parse(body));
  } catch {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "invalid JSON" }));
    return;
  }

  // Validate inputs
  if (!ALLOWED_OPS.includes(operation)) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: `operation must be one of: ${ALLOWED_OPS.join(", ")}` }));
    return;
  }
  if (!params || typeof params !== "object" || Array.isArray(params)) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "params must be an object" }));
    return;
  }

  // SIGNING_SECRET_KEY is required for this endpoint
  if (!process.env.SIGNING_SECRET_KEY) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "SIGNING_SECRET_KEY not configured" }));
    return;
  }

  let config;
  try {
    config = loadConfig();
    // Also require SOROBAN_RPC_URL here
    if (!process.env.SOROBAN_RPC_URL) throw new Error("Missing required environment variables: SOROBAN_RPC_URL");
    config.SOROBAN_RPC_URL = process.env.SOROBAN_RPC_URL;
  } catch (err) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: err.message }));
    return;
  }

  try {
    const server = new StellarSdk.SorobanRpc.Server(config.SOROBAN_RPC_URL);
    const contract = new StellarSdk.Contract(config.CONTRACT_ID);

    let result = await buildAndSubmit(server, contract, operation, params, config);

    // Retry once on tx_too_late by re-fetching account sequence
    if (result.status === "ERROR" && JSON.stringify(result.errorResult ?? "").includes("tx_too_late")) {
      result = await buildAndSubmit(server, contract, operation, params, config);
    }

    if (result.status === "ERROR") {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: result.errorResult ?? "submission_error" }));
      return;
    }

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ hash: result.hash, status: result.status === "SUCCESS" ? "SUCCESS" : "PENDING" }));

    // Invalidate cached view responses for the affected recipient.
    if (INVALIDATING_OPS.has(operation) && params.recipient) {
      cacheInvalidate(params.recipient).catch(() => {});
    }
  } catch (err) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: String(err.message ?? err) }));
  }
}

module.exports = { txSubmitHandler };
