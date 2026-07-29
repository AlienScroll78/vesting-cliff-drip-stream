#!/usr/bin/env node
/**
 * fund_keypairs.js – fund a list of keypairs via Stellar friendbot
 *
 * Usage:
 *   node scripts/fund_keypairs.js tests/load/keypairs.json
 *
 * Rate-limited to 5 req/s to avoid friendbot throttling.
 */

const fs = require("fs");
const https = require("https");

const FRIENDBOT = "https://friendbot.stellar.org";
const RATE_MS = 200; // 5 req/s

async function fund(address) {
  return new Promise((resolve, reject) => {
    https.get(`${FRIENDBOT}?addr=${address}`, (res) => {
      let body = "";
      res.on("data", (d) => (body += d));
      res.on("end", () => {
        const ok = res.statusCode === 200;
        process.stderr.write(`${ok ? "✓" : "✗"} ${address.slice(0, 10)}…\n`);
        resolve(ok);
      });
    }).on("error", reject);
  });
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const file = process.argv[2];
  if (!file) { console.error("Usage: node fund_keypairs.js <keypairs.json>"); process.exit(1); }
  const pairs = JSON.parse(fs.readFileSync(file, "utf8"));
  let ok = 0;
  for (const { public: addr } of pairs) {
    const success = await fund(addr);
    if (success) ok++;
    await sleep(RATE_MS);
  }
  console.log(`Funded ${ok}/${pairs.length} accounts.`);
}

main().catch(console.error);
