/**
 * Startup environment validation — issue #49.
 * Contract version check — issue #567.
 *
 * Call validateEnv() once during process startup.  It logs every missing
 * required variable and exits with code 1 so the container/process does
 * not start in a silently broken state.
 *
 * checkContractVersion is also invoked here (after env validation) so the
 * process exits cleanly when the deployed contract version does not match
 * the expected version configured via EXPECTED_CONTRACT_VERSION, unless
 * ALLOW_VERSION_MISMATCH=true is set.
 */

import { logger } from "./logger.js";
import { checkContractVersion } from "./contract-version.js";

const REQUIRED = [
  "HORIZON_URL",
  "NETWORK_PASSPHRASE",
  "CONTRACT_ID",
];

export function validateEnv() {
  const missing = REQUIRED.filter((k) => !process.env[k]);
  if (missing.length === 0) return;

  logger.error(
    { event: "startup_validation_failed", missing },
    `Missing required environment variables: ${missing.join(", ")}. See docs/config.md for details.`,
  );
  process.exit(1);
}

/**
 * Run all startup checks in sequence.
 *
 * @param {import('./config').Config} config   - parsed application config
 * @param {{ setContractVersion(v: string): void }} [healthModule] - optional
 *   reference to the health route module so the contract_version field in
 *   /health and /ready is kept up to date.
 */
export async function runStartupChecks(config, healthModule) {
  validateEnv();

  // Only run the version check when a Soroban RPC URL is configured so the
  // process does not fail in environments where RPC is not needed.
  const rpcUrl = config.sorobanRpcUrl ?? config.SOROBAN_RPC_URL ?? process.env.SOROBAN_RPC_URL;
  if (!rpcUrl) return;

  try {
    const version = await checkContractVersion(config, logger);
    if (healthModule && typeof healthModule.setContractVersion === "function") {
      healthModule.setContractVersion(version);
    }
  } catch (err) {
    logger.error({ event: "contract_version_mismatch" }, err.message);
    process.exit(1);
  }
}
