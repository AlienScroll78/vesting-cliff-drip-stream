"use strict";

const { StellarSdk } = require("./lib");

const CACHE_TTL_MS = 5 * 60 * 1000;

let _cache = null; // { value, expiresAt }

/**
 * Returns a version string for the deployed contract, using the latest
 * ledger sequence as a proxy (format: 'ledger-{sequence}').
 * Result is cached for 5 minutes.
 *
 * @param {object} config - must include SOROBAN_RPC_URL
 * @returns {Promise<string>}
 */
async function getContractVersion(config) {
  const now = Date.now();
  if (_cache && now < _cache.expiresAt) return _cache.value;

  const server = new StellarSdk.SorobanRpc.Server(config.SOROBAN_RPC_URL);
  const { sequence } = await server.getLatestLedger();
  const value = `ledger-${sequence}`;
  _cache = { value, expiresAt: now + CACHE_TTL_MS };
  return value;
}

module.exports = { getContractVersion };
