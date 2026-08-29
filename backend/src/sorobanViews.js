/**
 * sorobanViews.js — cached wrappers for read-only Soroban view functions.
 *
 * Each wrapper:
 *   1. Builds a cache key via viewKey(recipient, fnName).
 *   2. Checks the cache — returns the parsed hit immediately.
 *   3. On miss, calls the actual Soroban RPC via simulateContractCall.
 *   4. Stores the result with a function-specific TTL.
 *   5. Proceeds transparently if the cache layer is unavailable.
 *
 * TTL policy (per spec):
 *   get_schedule      :  60 000 ms  — invalidated on any stream event
 *   claimable_amount  :   5 000 ms  — frequently changing
 *   is_cliff_passed   : cliff-aware — once true, cache for 24 h;
 *                        before cliff, TTL = ms until cliff ledger
 *                        (capped at 60 000 ms)
 *   get_min_deposit   : 300 000 ms  — changes only on admin action
 *
 * Cache invalidation:
 *   Call invalidateRecipient(recipient) after any state-changing event:
 *   stream_created, tokens_claimed, stream_cancelled,
 *   stream_clawed_back, stream_drained.
 *   The indexer calls this via the publishEvent hook.
 */

import * as StellarSdkModule from "@stellar/stellar-sdk";
import { viewKey, cacheGet, cacheSet, cacheInvalidate } from "./cache.js";

// ── Stellar SDK ───────────────────────────────────────────────────────────────
// Supports both ESM default export and named exports for test mocking.
const sdk = StellarSdkModule.default ?? StellarSdkModule;

// ── Configuration ─────────────────────────────────────────────────────────────

const REQUIRED_VARS = [
  "HORIZON_URL",
  "NETWORK_PASSPHRASE",
  "CONTRACT_ID",
  "ADMIN_API_KEY",
  "SPONSOR_SECRET_KEY",
  "SOROBAN_RPC_URL",
];

function loadViewConfig() {
  const missing = REQUIRED_VARS.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    throw new Error(
      `[sorobanViews] Missing required env vars: ${missing.join(", ")}`,
    );
  }
  return {
    SOROBAN_RPC_URL:    process.env.SOROBAN_RPC_URL,
    NETWORK_PASSPHRASE: process.env.NETWORK_PASSPHRASE,
    CONTRACT_ID:        process.env.CONTRACT_ID,
  };
}

// ── Logger ────────────────────────────────────────────────────────────────────
// Use structured console output so log lines are machine-parseable without
// requiring pino to be installed in this module's scope.

const LOG_LEVEL = process.env.LOG_LEVEL ?? "info";
const _levels = { debug: 0, info: 1, warn: 2, error: 3 };
const _minLevel = _levels[LOG_LEVEL] ?? 1;

function structuredLog(level, obj, msg) {
  if ((_levels[level] ?? 0) < _minLevel) return;
  const entry = typeof obj === "string"
    ? { message: obj }
    : { ...obj, message: msg ?? obj.message ?? "" };
  process.stdout.write(
    JSON.stringify({
      level,
      timestamp: new Date().toISOString(),
      service: "vesting-backend",
      ...entry,
    }) + "\n",
  );
}

const logger = {
  debug: (obj, msg) => structuredLog("debug", obj, msg),
  info:  (obj, msg) => structuredLog("info",  obj, msg),
  warn:  (obj, msg) => structuredLog("warn",  obj, msg),
  error: (obj, msg) => structuredLog("error", obj, msg),
};

// ── TTL constants ─────────────────────────────────────────────────────────────

const TTL_GET_SCHEDULE_MS     =  60_000;   // 60 s
const TTL_CLAIMABLE_AMOUNT_MS =   5_000;   //  5 s
const TTL_IS_CLIFF_PASSED_MS  =  60_000;   // cap for pre-cliff window
const TTL_GET_MIN_DEPOSIT_MS  = 300_000;   // 5 min
const TTL_CLIFF_PASSED_MS     = 86_400_000; // 24 h — immutable once true

// ── Soroban RPC helper ────────────────────────────────────────────────────────

/**
 * @param {string} rpcUrl
 * @param {string} networkPassphrase
 * @param {string} contractId
 * @param {string} method
 * @param {any[]}  args
 */
async function simulateContractCall(rpcUrl, networkPassphrase, contractId, method, args) {
  const server = new sdk.SorobanRpc.Server(rpcUrl);

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

// ── View wrappers ─────────────────────────────────────────────────────────────

/**
 * GET get_schedule(recipient) — cached 60 s.
 * @param {string} recipient
 * @returns {Promise<object|null>}
 */
export async function getSchedule(recipient) {
  const { SOROBAN_RPC_URL, NETWORK_PASSPHRASE, CONTRACT_ID } = loadViewConfig();
  const key = viewKey(recipient, "get_schedule");

  const cached = await cacheGet(key);
  if (cached !== null) {
    logger.debug({ fn: "get_schedule", recipient, cacheHit: true }, "[sorobanViews] cache hit");
    return JSON.parse(cached);
  }

  logger.debug({ fn: "get_schedule", recipient, cacheHit: false }, "[sorobanViews] cache miss");

  const retval = await simulateContractCall(
    SOROBAN_RPC_URL,
    NETWORK_PASSPHRASE,
    CONTRACT_ID,
    "get_schedule",
    [sdk.Address.fromString(recipient).toScVal()],
  );

  const schedule = retval ? sdk.scValToNative(retval) : null;
  await cacheSet(key, JSON.stringify(schedule), TTL_GET_SCHEDULE_MS);
  return schedule;
}

/**
 * GET claimable_amount(recipient) — cached 5 s.
 * @param {string} recipient
 * @returns {Promise<bigint>}
 */
export async function claimableAmount(recipient) {
  const { SOROBAN_RPC_URL, NETWORK_PASSPHRASE, CONTRACT_ID } = loadViewConfig();
  const key = viewKey(recipient, "claimable_amount");

  const cached = await cacheGet(key);
  if (cached !== null) {
    logger.debug({ fn: "claimable_amount", recipient, cacheHit: true }, "[sorobanViews] cache hit");
    return BigInt(cached);
  }

  logger.debug({ fn: "claimable_amount", recipient, cacheHit: false }, "[sorobanViews] cache miss");

  const retval = await simulateContractCall(
    SOROBAN_RPC_URL,
    NETWORK_PASSPHRASE,
    CONTRACT_ID,
    "claimable_amount",
    [sdk.Address.fromString(recipient).toScVal()],
  );

  const amount = retval ? BigInt(retval.value()) : 0n;
  await cacheSet(key, amount.toString(), TTL_CLAIMABLE_AMOUNT_MS);
  return amount;
}

/**
 * GET is_cliff_passed(recipient) — cliff-aware TTL.
 *
 * Once true the result is cached for 24 h (immutable).  Before the cliff,
 * TTL = estimated ms until cliff (ledgersRemaining × 5 000 ms), capped at
 * 60 000 ms.
 *
 * @param {string} recipient
 * @param {number} [currentLedger]  optional hint for TTL computation
 * @returns {Promise<boolean>}
 */
export async function isCliffPassed(recipient, currentLedger) {
  const { SOROBAN_RPC_URL, NETWORK_PASSPHRASE, CONTRACT_ID } = loadViewConfig();
  const key = viewKey(recipient, "is_cliff_passed");

  const cached = await cacheGet(key);
  if (cached !== null) {
    logger.debug({ fn: "is_cliff_passed", recipient, cacheHit: true }, "[sorobanViews] cache hit");
    return cached === "true";
  }

  logger.debug({ fn: "is_cliff_passed", recipient, cacheHit: false }, "[sorobanViews] cache miss");

  const retval = await simulateContractCall(
    SOROBAN_RPC_URL,
    NETWORK_PASSPHRASE,
    CONTRACT_ID,
    "is_cliff_passed",
    [sdk.Address.fromString(recipient).toScVal()],
  );

  const result = retval ? Boolean(retval.value()) : false;

  let ttlMs;
  if (result) {
    ttlMs = TTL_CLIFF_PASSED_MS;
  } else {
    ttlMs = TTL_IS_CLIFF_PASSED_MS;
    try {
      const schedule = await getSchedule(recipient);
      if (schedule && typeof schedule.cliff_ledger === "number" && currentLedger !== undefined) {
        const remaining = schedule.cliff_ledger - currentLedger;
        ttlMs = remaining > 0
          ? Math.min(remaining * 5_000, TTL_IS_CLIFF_PASSED_MS)
          : 1_000;
      }
    } catch {
      // Fall back to cap.
    }
  }

  await cacheSet(key, String(result), ttlMs);
  return result;
}

/**
 * GET get_min_deposit() — cached 300 s.
 * Not recipient-scoped; uses a fixed "__global__" key.
 * @returns {Promise<bigint>}
 */
export async function getMinDeposit() {
  const { SOROBAN_RPC_URL, NETWORK_PASSPHRASE, CONTRACT_ID } = loadViewConfig();
  const key = viewKey("__global__", "get_min_deposit");

  const cached = await cacheGet(key);
  if (cached !== null) {
    logger.debug({ fn: "get_min_deposit", cacheHit: true }, "[sorobanViews] cache hit");
    return BigInt(cached);
  }

  logger.debug({ fn: "get_min_deposit", cacheHit: false }, "[sorobanViews] cache miss");

  const retval = await simulateContractCall(
    SOROBAN_RPC_URL,
    NETWORK_PASSPHRASE,
    CONTRACT_ID,
    "get_min_deposit",
    [],
  );

  const minDeposit = retval ? BigInt(retval.value()) : 100n;
  await cacheSet(key, minDeposit.toString(), TTL_GET_MIN_DEPOSIT_MS);
  return minDeposit;
}

// ── Invalidation ──────────────────────────────────────────────────────────────

/**
 * Invalidate all cached view results for a recipient.
 *
 * Called by the indexer after stream_created, tokens_claimed,
 * stream_cancelled, stream_clawed_back, stream_drained events.
 *
 * @param {string} recipient
 */
export async function invalidateRecipient(recipient) {
  logger.info({ recipient }, "[sorobanViews] invalidating cache for recipient");
  await cacheInvalidate(recipient);
}

/**
 * Invalidate the global get_min_deposit cache entry.
 * Called after the set_min_deposit admin action.
 */
export async function invalidateMinDeposit() {
  logger.info("[sorobanViews] invalidating get_min_deposit cache");
  await cacheInvalidate("__global__");
}
