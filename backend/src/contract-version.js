import { StellarSdk } from "./lib.js";

const CACHE_TTL_MS = 5 * 60 * 1000;

let _cache = null; // { value, expiresAt }

/**
 * Returns a version string for the deployed contract.
 *
 * NOTE: The Soroban RPC does not expose a generic `get_version` view for
 * arbitrary contracts, so we use the latest ledger sequence as a stable
 * proxy (format: 'ledger-{sequence}'). This value updates on every ledger
 * close, giving a coarse indicator of RPC connectivity and deployment era.
 * Replace this implementation when the contract exposes a dedicated
 * version view function.
 *
 * Result is cached for 5 minutes to avoid hammering the RPC endpoint.
 *
 * @param {import('./config').Config} config - must include SOROBAN_RPC_URL
 * @returns {Promise<string>}
 */
export async function getContractVersion(config) {
  const now = Date.now();
  if (_cache && now < _cache.expiresAt) return _cache.value;

  const server = new StellarSdk.SorobanRpc.Server(config.sorobanRpcUrl ?? config.SOROBAN_RPC_URL);
  const { sequence } = await server.getLatestLedger();
  const value = `ledger-${sequence}`;
  _cache = { value, expiresAt: now + CACHE_TTL_MS };
  return value;
}

/**
 * Fetches the current contract version and compares it to the value
 * configured in `config.expectedContractVersion`.
 *
 * Behaviour:
 *  - If `expectedContractVersion` is empty or not set the check is skipped
 *    and the function returns the fetched version string.
 *  - If the versions match the function returns the version string.
 *  - If there is a mismatch:
 *    - When `allowVersionMismatch` is true, a warning is logged and the
 *      fetched version is still returned.
 *    - When `allowVersionMismatch` is false (default) an error is logged
 *      and an Error is thrown so the caller (startup) can exit.
 *
 * @param {import('./config').Config} config
 * @param {{ warn(obj: object, msg: string): void; error(obj: object, msg: string): void }} logger
 * @returns {Promise<string>} the fetched version string
 */
export async function checkContractVersion(config, logger) {
  const expected = config.expectedContractVersion ?? config.EXPECTED_CONTRACT_VERSION ?? "";

  // Skip the check when no expected version is configured.
  if (!expected) {
    return getContractVersion(config);
  }

  const actual = await getContractVersion(config);

  if (actual === expected) {
    return actual;
  }

  const allowMismatch =
    config.allowVersionMismatch ?? config.ALLOW_VERSION_MISMATCH ?? false;

  const msg = `Contract version mismatch: expected "${expected}", got "${actual}"`;

  if (allowMismatch) {
    logger.warn(
      { event: "contract_version_mismatch", expected, actual },
      msg,
    );
    return actual;
  }

  logger.error(
    { event: "contract_version_mismatch", expected, actual },
    msg,
  );
  throw new Error(msg);
}

/**
 * Reset the internal cache. Exposed for tests only.
 * @internal
 */
export function _resetCache() {
  _cache = null;
}
