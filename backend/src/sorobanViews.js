"use strict";

/**
 * sorobanViews.js — cached wrappers for read-only Soroban view functions.
 *
 * Each wrapper:
 *   1. Checks the Redis cache.
 *   2. On miss, calls the actual Soroban RPC.
 *   3. Stores the result with the configured TTL.
 *   4. Proceeds without cache if Redis is unavailable.
 *
 * Cache is invalidated by calling invalidateRecipient() after any state-
 * changing operation (claim_vested, cancel_stream).
 */

const cache = require("./cache");
const { loadConfig, StellarSdk } = require("./lib");

/**
 * Build a minimal Soroban simulation transaction and return the decoded
 * return value.  Throws on RPC error.
 *
 * @param {string} rpcUrl
 * @param {string} networkPassphrase
 * @param {string} contractId
 * @param {string} method        - contract function name
 * @param {any[]}  args          - ScVal arguments
 */
async function simulateContractCall(rpcUrl, networkPassphrase, contractId, method, args) {
  const sdk = StellarSdk;
  const server = new sdk.SorobanRpc.Server(rpcUrl);

  // We need a source account for building the tx; use a zero-keypair for
  // simulations (no signature required for sim-only calls).
  const sourceKeypair = sdk.Keypair.random();
  const sourceAccount = new sdk.Account(sourceKeypair.publicKey(), "0");

  const contract = new sdk.Contract(contractId);
  const tx = new sdk.TransactionBuilder(sourceAccount, {
    fee: sdk.BASE_FEE,
    networkPassphrase,
  })
    .addOperation(contract.call(method, ...args))
    .setTimeout(10)
    .build();

  const simResult = await server.simulateTransaction(tx);
  if (sdk.SorobanRpc.Api.isSimulationError(simResult)) {
    throw new Error(`Simulation error for ${method}: ${simResult.error}`);
  }

  return simResult.result?.retval;
}

/**
 * GET claimable_amount(recipient) — cached 3 s TTL.
 * @returns {Promise<bigint>}
 */
async function claimableAmount(recipient) {
  const { SOROBAN_RPC_URL, NETWORK_PASSPHRASE, CONTRACT_ID } = loadConfig(true);

  const cached = await cache.get(CONTRACT_ID, "claimable_amount", recipient);
  if (cached !== null) return BigInt(cached);

  const sdk = StellarSdk;
  const retval = await simulateContractCall(
    SOROBAN_RPC_URL,
    NETWORK_PASSPHRASE,
    CONTRACT_ID,
    "claimable_amount",
    [sdk.Address.fromString(recipient).toScVal()],
  );

  const amount = retval ? BigInt(retval.value()) : 0n;
  await cache.set(CONTRACT_ID, "claimable_amount", recipient, amount.toString());
  return amount;
}

/**
 * GET get_schedule(recipient) — cached 30 s TTL.
 * @returns {Promise<object|null>}
 */
async function getSchedule(recipient) {
  const { SOROBAN_RPC_URL, NETWORK_PASSPHRASE, CONTRACT_ID } = loadConfig(true);

  const cached = await cache.get(CONTRACT_ID, "get_schedule", recipient);
  if (cached !== null) return cached;

  const sdk = StellarSdk;
  const retval = await simulateContractCall(
    SOROBAN_RPC_URL,
    NETWORK_PASSPHRASE,
    CONTRACT_ID,
    "get_schedule",
    [sdk.Address.fromString(recipient).toScVal()],
  );

  // retval is an Option<VestingSchedule> — null if not present
  const schedule = retval ? sdk.scValToNative(retval) : null;
  await cache.set(CONTRACT_ID, "get_schedule", recipient, schedule);
  return schedule;
}

/**
 * GET is_cliff_passed(recipient) — cached 60 s TTL.
 * @returns {Promise<boolean>}
 */
async function isCliffPassed(recipient) {
  const { SOROBAN_RPC_URL, NETWORK_PASSPHRASE, CONTRACT_ID } = loadConfig(true);

  const cached = await cache.get(CONTRACT_ID, "is_cliff_passed", recipient);
  if (cached !== null) return Boolean(cached);

  const sdk = StellarSdk;
  const retval = await simulateContractCall(
    SOROBAN_RPC_URL,
    NETWORK_PASSPHRASE,
    CONTRACT_ID,
    "is_cliff_passed",
    [sdk.Address.fromString(recipient).toScVal()],
  );

  const result = retval ? Boolean(retval.value()) : false;
  await cache.set(CONTRACT_ID, "is_cliff_passed", recipient, result);
  return result;
}

/**
 * Invalidate all cached view results for a recipient.
 * Call after claim_vested or cancel_stream.
 */
async function invalidateRecipient(recipient) {
  const config = loadConfig();
  await cache.invalidate(config.CONTRACT_ID, recipient);
}

module.exports = { claimableAmount, getSchedule, isCliffPassed, invalidateRecipient };
