/**
 * create_streams_bundle_src.js
 *
 * Source for the esbuild bundle. Provides the real XDR construction +
 * submission logic that replaces the stub in create_streams.js.
 *
 * Build:  npm run bundle
 * Run:    npm run run:testnet
 *
 * Each VU needs its own funded Stellar keypair to avoid sequence-number
 * conflicts. Generate 100 keypairs and fund them via friendbot before running:
 *
 *   node scripts/gen_keypairs.js 100 > keypairs.json
 *   # fund each via: curl "https://friendbot.stellar.org?addr=<GADDR>"
 *
 * Pass secrets as a comma-separated env var:
 *   export SPONSOR_SECRETS=$(jq -r '[.[].secret] | join(",")' keypairs.json)
 */

import {
  Keypair,
  TransactionBuilder,
  Networks,
  Operation,
  Contract,
  Address,
  xdr,
  nativeToScVal,
  rpc as StellarRpc,
} from "@stellar/stellar-sdk";

// k6 imports (excluded from the bundle via esbuild --external flags)
import http from "k6/http";
import { check, sleep } from "k6";
import { Counter, Rate, Trend } from "k6/metrics";

const txSubmitted = new Counter("tx_submitted");
const txSuccess = new Rate("tx_success_rate");
const txFailed = new Counter("tx_failed");
const rpcLatency = new Trend("rpc_latency_ms", true);
const simulateLatency = new Trend("simulate_latency_ms", true);

export const options = {
  scenarios: {
    concurrent_streams: {
      executor: "shared-iterations",
      vus: 100,
      iterations: 100,
      maxDuration: "5m",
    },
  },
  thresholds: {
    tx_success_rate: ["rate>=0.95"],
    rpc_latency_ms: ["p(95)<10000"],
    http_req_failed: ["rate<0.05"],
  },
};

const RPC_URL = __ENV.RPC_URL || "https://soroban-testnet.stellar.org";
const CONTRACT_ID = __ENV.VESTING_CONTRACT;
const TOKEN = __ENV.TOKEN;
const NETWORK_PASSPHRASE = __ENV.NETWORK_PASSPHRASE || Networks.TESTNET;
const secrets = __ENV.SPONSOR_SECRETS.split(",");

const JSON_RPC_HEADERS = { "Content-Type": "application/json" };

function rpcPost(method, params) {
  const start = Date.now();
  const res = http.post(
    RPC_URL,
    JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    { headers: JSON_RPC_HEADERS }
  );
  rpcLatency.add(Date.now() - start);
  return JSON.parse(res.body);
}

export default function () {
  const sponsorKeypair = Keypair.fromSecret(secrets[(__VU - 1) % secrets.length]);
  const sponsorAddress = sponsorKeypair.publicKey();

  // Unique recipient per invocation (no pre-funding needed — stream creation
  // does not require the recipient to exist on-chain at creation time).
  const recipientKeypair = Keypair.random();
  const recipientAddress = recipientKeypair.publicKey();

  // 1. Fetch current account sequence
  const accountRes = rpcPost("getAccount", { address: sponsorAddress });
  if (accountRes.error) {
    console.error(`getAccount failed: ${JSON.stringify(accountRes.error)}`);
    txFailed.add(1);
    txSuccess.add(false);
    return;
  }
  const sequence = BigInt(accountRes.result.sequence);

  // 2. Build transaction
  const contract = new Contract(CONTRACT_ID);
  const invokeOp = contract.call(
    "create_vesting_stream",
    Address.fromString(sponsorAddress).toScVal(),
    Address.fromString(recipientAddress).toScVal(),
    Address.fromString(TOKEN).toScVal(),
    nativeToScVal(10, { type: "i128" }),           // rate: 10 tokens/ledger
    nativeToScVal(17280, { type: "u32" }),          // cliff_duration: ~1 day
    nativeToScVal(172800, { type: "u32" })          // total_duration: ~10 days
  );

  // Use a throwaway account object to satisfy TransactionBuilder
  const account = { accountId: () => sponsorAddress, sequence, incrementSequenceNumber() { this.sequence++; } };

  const tx = new TransactionBuilder(account, {
    fee: "1000000", // 0.1 XLM max fee — generous for testnet
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(invokeOp)
    .setTimeout(30)
    .build();

  // 3. Simulate to get footprint + fee
  const simStart = Date.now();
  const simRes = rpcPost("simulateTransaction", { transaction: tx.toXDR() });
  simulateLatency.add(Date.now() - simStart);

  if (simRes.error || simRes.result?.error) {
    console.error(`simulate failed: ${JSON.stringify(simRes.error || simRes.result.error)}`);
    txFailed.add(1);
    txSuccess.add(false);
    return;
  }

  // 4. Assemble (apply footprint + auth) and sign
  const assembledXdr = simRes.result.transaction;
  const assembledTx = TransactionBuilder.fromXDR(assembledXdr, NETWORK_PASSPHRASE);
  assembledTx.sign(sponsorKeypair);

  // 5. Submit
  const submitRes = rpcPost("sendTransaction", { transaction: assembledTx.toXDR() });
  txSubmitted.add(1);

  if (submitRes.error || !submitRes.result?.hash) {
    console.error(`sendTransaction failed: ${JSON.stringify(submitRes.error)}`);
    txFailed.add(1);
    txSuccess.add(false);
    return;
  }

  const hash = submitRes.result.hash;

  // 6. Poll for confirmation
  for (let i = 0; i < 15; i++) {
    sleep(2);
    const pollRes = rpcPost("getTransaction", { hash });
    const status = pollRes.result?.status;
    if (status === "SUCCESS") { txSuccess.add(true); return; }
    if (status === "FAILED" || status === "NOT_FOUND") {
      console.error(`tx ${hash} ended with status: ${status}`);
      txFailed.add(1); txSuccess.add(false); return;
    }
  }
  console.error(`tx ${hash} timed out after 30s`);
  txFailed.add(1);
  txSuccess.add(false);
}

export function handleSummary(data) {
  return {
    "results/baseline_run.json": JSON.stringify(data, null, 2),
  };
}
