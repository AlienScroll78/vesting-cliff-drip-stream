"use strict";

/**
 * Startup environment validation — issue #49.
 *
 * Call validateEnv() once during process startup.  It logs every missing
 * required variable and exits with code 1 so the container/process does
 * not start in a silently broken state.
 */

const REQUIRED = [
  "HORIZON_URL",
  "NETWORK_PASSPHRASE",
  "CONTRACT_ID",
];

function validateEnv() {
  const missing = REQUIRED.filter((k) => !process.env[k]);
  if (missing.length === 0) return;

  console.error(
    `Error: Missing required environment variables: ${missing.join(", ")}.\n` +
      "See docs/config.md for details.",
  );
  process.exit(1);
}

module.exports = { validateEnv };
