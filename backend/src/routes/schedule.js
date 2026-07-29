"use strict";

/**
 * GET /schedule/:recipient
 *
 * Returns the vesting schedule for a recipient, including a
 * contract_version field fetched from on-chain (cached 5 min).
 *
 * View-function responses are cached per `recipient:ledger` with a TTL of
 * ~5 s (one ledger close) via the Redis cache module (Issue #29).
 *
 * Response 200:
 *   {
 *     "recipient": "G...", "token": "C...",
 *     "rate": "100", "cliff_ledger": 1000, "end_ledger": 2000,
 *     "claimable_amount": "500", "is_cliff_passed": true,
 *     "contract_version": "ledger-12345"
 *   }
 *
 * Response 404: { "error": "schedule not found" }
 */

const { StellarSdk, loadConfig } = require("../lib");
const { getContractVersion } = require("../contract-version");
const { viewKey, cacheGet, cacheSet } = require("../cache");

async function scheduleHandler(req, res) {
  // Extract recipient from URL: /schedule/:recipient
  const recipient = req.url?.split("/").pop();
  if (!recipient) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "recipient required" }));
    return;
  }

  let config;
  try {
    config = loadConfig();
    config.SOROBAN_RPC_URL = process.env.SOROBAN_RPC_URL;
    if (!config.SOROBAN_RPC_URL) throw new Error("Missing SOROBAN_RPC_URL");
  } catch (err) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: err.message }));
    return;
  }

  try {
    const server = new StellarSdk.SorobanRpc.Server(config.SOROBAN_RPC_URL);

    // Resolve current ledger first so we can use it as the cache key.
    const { sequence: currentLedger } = await server.getLatestLedger();
    const key = viewKey(recipient, currentLedger);

    // ── Cache hit ──────────────────────────────────────────────────────────
    const cached = await cacheGet(key);
    if (cached) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(cached);
      return;
    }

    // ── Cache miss — fetch from RPC ────────────────────────────────────────
    const contract = new StellarSdk.Contract(config.CONTRACT_ID);
    const dummyAccount = { accountId: () => recipient, sequenceNumber: () => "0", incrementSequenceNumber: () => {} };

    // Simulate get_schedule call
    const tx = new StellarSdk.TransactionBuilder(dummyAccount, {
      fee: StellarSdk.BASE_FEE,
      networkPassphrase: config.NETWORK_PASSPHRASE,
    })
      .addOperation(contract.call("get_schedule", StellarSdk.Address.fromString(recipient).toScVal()))
      .setTimeout(15)
      .build();

    const sim = await server.simulateTransaction(tx);
    const retval = sim.result?.retval;

    if (!retval || retval.switch().name === "scvVoid") {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "schedule not found" }));
      return;
    }

    const map = retval.value().value();
    const field = (name) => map.find((e) => e.key().value().toString() === name)?.val();

    // Simulate claimable_amount
    const claimTx = new StellarSdk.TransactionBuilder(dummyAccount, {
      fee: StellarSdk.BASE_FEE,
      networkPassphrase: config.NETWORK_PASSPHRASE,
    })
      .addOperation(contract.call("claimable_amount", StellarSdk.Address.fromString(recipient).toScVal()))
      .setTimeout(15)
      .build();

    const claimSim = await server.simulateTransaction(claimTx);
    const claimable = claimSim.result?.retval?.value()?.toString() ?? "0";

    const cliffLedger = Number(field("cliff_ledger")?.value() ?? 0);
    const contract_version = await getContractVersion(config);

    const payload = JSON.stringify({
      recipient,
      sponsor: field("sponsor")?.value()?.toString() ?? "",
      token: field("token")?.value()?.toString() ?? "",
      rate: field("rate_per_ledger")?.value()?.toString() ?? "0",
      cliff_ledger: cliffLedger,
      end_ledger: Number(field("end_ledger")?.value() ?? 0),
      claimable_amount: claimable,
      is_cliff_passed: currentLedger >= cliffLedger,
      contract_version,
    });

    // Store in cache; fire-and-forget (do not block the response).
    cacheSet(key, payload).catch(() => {});

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(payload);
  } catch (err) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: String(err.message ?? err) }));
  }
}

module.exports = { scheduleHandler };
