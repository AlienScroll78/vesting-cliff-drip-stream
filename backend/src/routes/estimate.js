"use strict";

/**
 * POST /estimate
 *
 * Returns a deposit and fee estimate for the given stream parameters
 * without submitting any transaction.
 *
 * Request body:
 *   { "rate": 10, "cliff_duration": 17280, "total_duration": 172800 }
 *
 * Response 200:
 *   {
 *     "total_deposit":       1728000,
 *     "estimated_fee_xlm":  "0.00100",
 *     "ledger_budget":       172800,
 *     "disclaimer":          "Fee is an estimate based on the current Horizon base fee and may differ at submission time."
 *   }
 */

const { loadConfig } = require("../lib");

const STROOPS_PER_XLM = 10_000_000n;
const DISCLAIMER =
  "Fee is an estimate based on the current Horizon base fee and may differ at submission time.";

/** Fetch the p90 base fee from Horizon fee_stats (in stroops). */
async function fetchBaseFeeStroops(horizonUrl) {
  const res = await fetch(`${horizonUrl}/fee_stats`);
  if (!res.ok) throw new Error(`Horizon fee_stats returned ${res.status}`);
  const json = await res.json();
  const stroops =
    json.fee_charged?.p90 ?? json.last_ledger_base_fee ?? "100";
  return BigInt(Math.round(Number(stroops)));
}

/**
 * Handler for POST /estimate.
 * Express-compatible: handler(req, res).
 */
async function estimateHandler(req, res) {
  let body = "";
  await new Promise((resolve) => {
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", resolve);
  });

  let rate, cliff_duration, total_duration;
  try {
    ({ rate, cliff_duration, total_duration } = JSON.parse(body));
  } catch {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "invalid JSON" }));
    return;
  }

  // Validate — mirrors contract rules
  if (!Number.isInteger(rate) || rate <= 0) {
    res.writeHead(422, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "rate must be a positive integer" }));
    return;
  }
  if (!Number.isInteger(total_duration) || !Number.isInteger(cliff_duration) ||
      total_duration <= cliff_duration) {
    res.writeHead(422, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "total_duration must be greater than cliff_duration" }));
    return;
  }

  const { HORIZON_URL } = loadConfig();

  let baseFeeStroops;
  try {
    baseFeeStroops = await fetchBaseFeeStroops(HORIZON_URL);
  } catch {
    baseFeeStroops = 100n; // Stellar minimum base fee
  }

  const totalDeposit = BigInt(rate) * BigInt(total_duration);
  const feeXlm = (Number(baseFeeStroops) / Number(STROOPS_PER_XLM)).toFixed(5);

  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(
    JSON.stringify({
      total_deposit: Number(totalDeposit),
      estimated_fee_xlm: feeXlm,
      ledger_budget: total_duration,
      disclaimer: DISCLAIMER,
    }),
  );
}

module.exports = { estimateHandler };
