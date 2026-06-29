"use strict";

/**
 * Integration test: GET /schedule/:recipient includes contract_version,
 * and the version is cached (RPC called only once within 5 minutes).
 *
 * Run: node tests/integration/schedule_version.test.js
 */

const assert = require("assert");

// ── Minimal mocks ─────────────────────────────────────────────────────────────

let rpcCallCount = 0;

// Mock the StellarSdk via module cache manipulation
const mockScVal = (val) => ({
  switch: () => ({ name: "scvMap" }),
  value: () => ({
    value: () => [
      { key: () => ({ value: () => "cliff_ledger" }), val: () => ({ value: () => 1000n }) },
      { key: () => ({ value: () => "end_ledger" }),   val: () => ({ value: () => 2000n }) },
      { key: () => ({ value: () => "rate_per_ledger" }), val: () => ({ value: () => 100n }) },
      { key: () => ({ value: () => "sponsor" }),      val: () => ({ value: () => "GSPONSOR" }) },
      { key: () => ({ value: () => "token" }),        val: () => ({ value: () => "CTOKEN" }) },
    ],
  }),
});

const mockServer = {
  simulateTransaction: async () => ({ result: { retval: mockScVal() } }),
  getLatestLedger: async () => {
    rpcCallCount++;
    return { sequence: 12345 };
  },
};

// Patch require for lib and contract-version
const Module = require("module");
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request.endsWith("/lib") || request.endsWith("../lib")) {
    return {
      loadConfig: () => ({
        HORIZON_URL: "http://mock",
        NETWORK_PASSPHRASE: "Test",
        CONTRACT_ID: "CCONTRACT",
        SOROBAN_RPC_URL: "http://mock-rpc",
      }),
      StellarSdk: {
        SorobanRpc: { Server: class { constructor() { return mockServer; } } },
        Contract: class { constructor() { return { call: () => ({}) }; } },
        TransactionBuilder: class {
          constructor() {}
          addOperation() { return this; }
          setTimeout() { return this; }
          build() { return {}; }
        },
        BASE_FEE: "100",
        Address: { fromString: () => ({ toScVal: () => ({}) }) },
      },
    };
  }
  return originalLoad.apply(this, arguments);
};

// ── Load modules under test ───────────────────────────────────────────────────

// Reset cache between test module loads
delete require.cache[require.resolve("../../backend/src/contract-version")];
delete require.cache[require.resolve("../../backend/src/routes/schedule")];

const { getContractVersion } = require("../../backend/src/contract-version");
const { scheduleHandler } = require("../../backend/src/routes/schedule");

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeReq(path) {
  const EventEmitter = require("events");
  const req = new EventEmitter();
  req.method = "GET";
  req.url = path;
  process.nextTick(() => req.emit("end"));
  return req;
}

function makeRes() {
  const res = { statusCode: null, headers: {}, body: "" };
  res.writeHead = (code, headers) => { res.statusCode = code; Object.assign(res.headers, headers); };
  res.end = (body) => { res.body = body; };
  return res;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

async function testContractVersionFieldPresent() {
  const req = makeReq("/schedule/GRECIPIENT");
  const res = makeRes();
  await scheduleHandler(req, res);

  assert.strictEqual(res.statusCode, 200, `Expected 200, got ${res.statusCode}`);
  const body = JSON.parse(res.body);
  assert.ok("contract_version" in body, "contract_version field missing from response");
  assert.match(body.contract_version, /^ledger-\d+$/, "contract_version should match 'ledger-N'");
  console.log("✓ contract_version field present:", body.contract_version);
}

async function testCachePreventsDuplicateRpcCalls() {
  // Reset module cache to get fresh cache state
  delete require.cache[require.resolve("../../backend/src/contract-version")];
  const { getContractVersion } = require("../../backend/src/contract-version");

  const config = { SOROBAN_RPC_URL: "http://mock" };
  rpcCallCount = 0;

  const v1 = await getContractVersion(config);
  const v2 = await getContractVersion(config);

  assert.strictEqual(rpcCallCount, 1, `RPC should be called once; was called ${rpcCallCount} times`);
  assert.strictEqual(v1, v2, "Cached value should equal first value");
  console.log("✓ Cache works: RPC called once, both calls returned:", v1);
}

(async () => {
  try {
    await testContractVersionFieldPresent();
    await testCachePreventsDuplicateRpcCalls();
    console.log("\nAll tests passed.");
  } catch (err) {
    console.error("\nTest failed:", err.message);
    process.exit(1);
  }
})();
