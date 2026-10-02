#!/usr/bin/env node
/**
 * gen_keypairs.js – generate N Stellar keypairs for load testing
 *
 * Usage:
 *   node scripts/gen_keypairs.js 100 > tests/load/keypairs.json
 *
 * Then fund each one via friendbot:
 *   node scripts/fund_keypairs.js tests/load/keypairs.json
 */

const { Keypair } = require("@stellar/stellar-sdk");

const count = parseInt(process.argv[2] || "100", 10);
const pairs = Array.from({ length: count }, () => {
  const kp = Keypair.random();
  return { public: kp.publicKey(), secret: kp.secret() };
});
process.stdout.write(JSON.stringify(pairs, null, 2) + "\n");
