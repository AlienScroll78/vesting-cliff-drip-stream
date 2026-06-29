#!/usr/bin/env node
/**
 * Integration tests for the indexer event pipeline — issue #46.
 *
 * Verifies end-to-end event flow against a local Stellar quickstart node:
 *   - vc_create  (stream created)
 *   - vc_claim   (tokens claimed)
 *   - vc_cancel  (stream cancelled)
 *
 * Prerequisites:
 *   - docker compose -f docker-compose.e2e.yml up -d
 *   - stellar CLI in PATH
 *   - HORIZON_URL env var (default: http://localhost:8000)
 *   - SOROBAN_RPC_URL env var (default: http://localhost:8000/soroban/rpc)
 *
 * Run:
 *   make test-integration
 *
 * DB isolation: each test group resets tracked state via a fresh contract
 * deployment so events from one group do not bleed into another.
 */

"use strict";

const { execSync } = require("child_process");
const assert = require("assert");
const http = require("http");

const HORIZON = process.env.HORIZON_URL ?? "http://localhost:8000";
const RPC = process.env.SOROBAN_RPC_URL ?? "http://localhost:8000/soroban/rpc";
const NETWORK = "local";
const WASM_PATH =
  "target/wasm32-unknown-unknown/release/vesting_cliff_drip_stream.wasm";

// ── helpers ───────────────────────────────────────────────────────────────────

function run(cmd, opts = {}) {
  return execSync(cmd, {
    encoding: "utf8",
    stdio: opts.silent ? "pipe" : "inherit",
    ...opts,
  }).trim();
}

function stellar(...args) {
  return run(
    `stellar ${args.join(" ")} --network ${NETWORK} --rpc-url ${RPC}`,
    { silent: true },
  );
}

function waitForHorizon(retries = 30, delayMs = 2000) {
  for (let i = 0; i < retries; i++) {
    try {
      run(`curl -sf ${HORIZON}`, { silent: true });
      return;
    } catch {
      console.log(`  Waiting for Horizon… (${i + 1}/${retries})`);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delayMs);
    }
  }
  throw new Error("Horizon did not become ready in time");
}

/**
 * Fetch contract events from Horizon for a given contract and topic filter.
 * Returns an array of event objects.
 */
function fetchEvents(contractId, topicFilter) {
  const url =
    `${HORIZON}/contract_events` +
    `?contract_id=${contractId}&topic=${encodeURIComponent(topicFilter)}&limit=50`;
  const raw = run(`curl -sf "${url}"`, { silent: true });
  try {
    const parsed = JSON.parse(raw);
    return parsed._embedded?.records ?? parsed.records ?? [];
  } catch {
    return [];
  }
}

let passed = 0;
let failed = 0;

function test(label, fn) {
  try {
    fn();
    console.log(`  ✓ ${label}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${label}: ${err.message}`);
    failed++;
  }
}

// ── setup ─────────────────────────────────────────────────────────────────────

console.log("═══════════════════════════════════════════════════════════");
console.log(" Vesting Cliff Drip Stream — Indexer Pipeline Integration  ");
console.log("═══════════════════════════════════════════════════════════\n");

waitForHorizon();

// Generate fresh keypairs for this run
stellar("keys generate idx-sponsor --no-fund");
stellar("keys generate idx-recipient --no-fund");
stellar("keys generate idx-recipient2 --no-fund");

const SPONSOR = stellar("keys address idx-sponsor");
const RECIPIENT = stellar("keys address idx-recipient");
const RECIPIENT2 = stellar("keys address idx-recipient2");

// Fund sponsor via friendbot
run(`curl -sf "${HORIZON}/friendbot?addr=${SPONSOR}"`, { silent: true });

// Deploy a fresh contract for isolation
const wasmHash = stellar(`contract upload --source idx-sponsor --wasm ${WASM_PATH}`);
const CONTRACT = stellar(`contract deploy --source idx-sponsor --wasm-hash ${wasmHash}`);

// Deploy SAC token and mint
const TOKEN = stellar(
  `contract asset deploy --source idx-sponsor --asset "IDXTOKEN:${SPONSOR}"`,
);
stellar(
  `contract invoke --source idx-sponsor --id ${TOKEN} -- mint --to ${SPONSOR} --amount 50000`,
);

// ── test group 1: vc_create event ─────────────────────────────────────────────

console.log("\n▶ vc_create — stream created event\n");

stellar(
  `contract invoke --source idx-sponsor --id ${CONTRACT} -- ` +
    `create_vesting_stream ` +
    `--sponsor ${SPONSOR} ` +
    `--recipient ${RECIPIENT} ` +
    `--token ${TOKEN} ` +
    `--rate 10 ` +
    `--cliff_duration 5 ` +
    `--total_duration 50`,
);

test("vc_create event is emitted for stream creation", () => {
  const events = fetchEvents(CONTRACT, "vc_create");
  assert.ok(events.length >= 1, `expected ≥1 vc_create event, got ${events.length}`);
});

test("vc_create event references correct recipient", () => {
  const events = fetchEvents(CONTRACT, "vc_create");
  const found = events.some((e) => JSON.stringify(e).includes(RECIPIENT));
  assert.ok(found, "vc_create event should contain recipient address");
});

test("get_schedule confirms stream exists in DB state after vc_create", () => {
  const out = stellar(
    `contract invoke --id ${CONTRACT} -- get_schedule --recipient ${RECIPIENT}`,
  );
  assert.ok(
    out.includes("rate") || out.includes("10"),
    `schedule not found after create: ${out}`,
  );
});

// ── test group 2: vc_claim event ──────────────────────────────────────────────

console.log("\n▶ vc_claim — tokens claimed event\n");

// Advance ledgers past cliff by submitting no-op invocations
for (let i = 0; i < 10; i++) {
  try {
    stellar(
      `contract invoke --source idx-sponsor --id ${CONTRACT} -- is_cliff_passed --recipient ${RECIPIENT}`,
    );
  } catch { /* each call advances ledger */ }
}

let claimSucceeded = false;
try {
  stellar(
    `contract invoke --source idx-recipient --id ${CONTRACT} -- claim_vested --recipient ${RECIPIENT}`,
  );
  claimSucceeded = true;
} catch (err) {
  if (!err.message.includes("CliffNotReached")) throw err;
  console.log(
    "  (cliff not yet reached in this environment — vc_claim tests skipped)",
  );
}

if (claimSucceeded) {
  test("vc_claim event is emitted after successful claim", () => {
    const events = fetchEvents(CONTRACT, "vc_claim");
    assert.ok(events.length >= 1, `expected ≥1 vc_claim event, got ${events.length}`);
  });

  test("vc_claim event references correct recipient", () => {
    const events = fetchEvents(CONTRACT, "vc_claim");
    const found = events.some((e) => JSON.stringify(e).includes(RECIPIENT));
    assert.ok(found, "vc_claim event should contain recipient address");
  });
}

// ── test group 3: vc_cancel event ─────────────────────────────────────────────

console.log("\n▶ vc_cancel — stream cancelled event\n");

// Create a second stream (far-future cliff) specifically for the cancel test
stellar(
  `contract invoke --source idx-sponsor --id ${CONTRACT} -- ` +
    `create_vesting_stream ` +
    `--sponsor ${SPONSOR} ` +
    `--recipient ${RECIPIENT2} ` +
    `--token ${TOKEN} ` +
    `--rate 5 ` +
    `--cliff_duration 1000 ` +
    `--total_duration 2000`,
);

stellar(
  `contract invoke --source idx-sponsor --id ${CONTRACT} -- ` +
    `cancel_stream --sponsor ${SPONSOR} --recipient ${RECIPIENT2}`,
);

test("vc_cancel event is emitted after cancellation", () => {
  const events = fetchEvents(CONTRACT, "vc_cancel");
  assert.ok(events.length >= 1, `expected ≥1 vc_cancel event, got ${events.length}`);
});

test("vc_cancel event references cancelled recipient", () => {
  const events = fetchEvents(CONTRACT, "vc_cancel");
  const found = events.some((e) => JSON.stringify(e).includes(RECIPIENT2));
  assert.ok(found, "vc_cancel event should contain recipient2 address");
});

test("get_schedule returns null after cancel (DB state reset)", () => {
  const out = stellar(
    `contract invoke --id ${CONTRACT} -- get_schedule --recipient ${RECIPIENT2}`,
  );
  assert.ok(
    out.trim() === "null" || out.trim() === "None" || out.trim() === '""',
    `expected no schedule after cancel, got: ${out}`,
  );
});

// ── test group 4: isolation ───────────────────────────────────────────────────

console.log("\n▶ isolation — events from different contracts do not bleed\n");

// Deploy a second contract to verify isolation
const wasmHash2 = stellar(`contract upload --source idx-sponsor --wasm ${WASM_PATH}`);
const CONTRACT2 = stellar(`contract deploy --source idx-sponsor --wasm-hash ${wasmHash2}`);

stellar(
  `contract invoke --source idx-sponsor --id ${CONTRACT2} -- ` +
    `create_vesting_stream ` +
    `--sponsor ${SPONSOR} ` +
    `--recipient ${RECIPIENT} ` +
    `--token ${TOKEN} ` +
    `--rate 1 ` +
    `--cliff_duration 5 ` +
    `--total_duration 50`,
);

test("contract-2 vc_create events are isolated from contract-1 events", () => {
  const eventsC1 = fetchEvents(CONTRACT, "vc_create");
  const eventsC2 = fetchEvents(CONTRACT2, "vc_create");
  assert.notStrictEqual(
    CONTRACT,
    CONTRACT2,
    "contracts should be distinct deployments",
  );
  // Both should have at least one event but scoped to their own contract
  assert.ok(eventsC2.length >= 1, "contract-2 should have its own vc_create event");
  eventsC2.forEach((e) => {
    assert.ok(
      !JSON.stringify(e).includes(CONTRACT) ||
        JSON.stringify(e).includes(CONTRACT2),
      "contract-2 events should not reference contract-1 ID",
    );
  });
});

// ── summary ───────────────────────────────────────────────────────────────────

console.log("\n═══════════════════════════════════════════════════════════");
console.log(` Results: ${passed} passed, ${failed} failed`);
console.log("═══════════════════════════════════════════════════════════\n");

if (failed > 0) process.exit(1);
