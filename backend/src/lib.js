/**
 * Shared helpers for backend routes.
 *
 * loadConfig() reads required environment variables and throws a clear
 * error on startup if any are missing (resolves issue #49 validation).
 */

const REQUIRED_VARS = ["HORIZON_URL", "NETWORK_PASSPHRASE", "CONTRACT_ID"];
const ADMIN_REQUIRED = ["ADMIN_API_KEY", "SPONSOR_SECRET_KEY", "SOROBAN_RPC_URL"];

export function loadConfig(requireAdmin = false) {
  const vars = requireAdmin ? [...REQUIRED_VARS, ...ADMIN_REQUIRED] : REQUIRED_VARS;
  const missing = vars.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(", ")}. ` +
        "See docs/config.md for details.",
    );
  }
  return Object.fromEntries(vars.map((k) => [k, process.env[k]]));
}

// Lazy-load @stellar/stellar-sdk so the module can be imported in tests
// without the full Stellar SDK installed (tests mock it).
let _sdk = null;

function getSdk() {
  if (!_sdk) {
    // createRequire allows CJS-style require inside an ESM module
    import("module").then(({ createRequire }) => {
      const require = createRequire(import.meta.url);
      try {
        _sdk = require("@stellar/stellar-sdk");
      } catch {
        _sdk = null;
      }
    }).catch(() => {});
  }
  return _sdk;
}

export const StellarSdk = new Proxy(
  {},
  {
    get(_target, prop) {
      const sdk = getSdk();
      return sdk ? sdk[prop] : undefined;
    },
  },
);
