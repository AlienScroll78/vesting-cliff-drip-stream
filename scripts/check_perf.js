#!/usr/bin/env node
/**
 * scripts/check_perf.js
 *
 * Compares performance benchmark results against stored baselines.
 *
 * Usage:
 *   node scripts/check_perf.js \
 *     --results  benchmarks/results.json \
 *     --baseline benchmarks/baseline.json \
 *     [--output  benchmarks/report.md]
 *
 * Exit codes:
 *   0 – all metrics within threshold
 *   1 – one or more regressions exceed threshold
 *
 * The script writes a Markdown table to --output (or stdout) formatted for
 * posting as a GitHub PR comment via the `peter-evans/create-or-update-comment`
 * action.
 */

import { readFileSync, writeFileSync } from "fs";
import { parseArgs } from "util";

// ── CLI args ──────────────────────────────────────────────────────────────────

const { values: args } = parseArgs({
  options: {
    results: { type: "string", default: "benchmarks/results.json" },
    baseline: { type: "string", default: "benchmarks/baseline.json" },
    output: { type: "string", default: "" },
  },
  strict: true,
});

// ── Load files ────────────────────────────────────────────────────────────────

let results, baseline;

try {
  results = JSON.parse(readFileSync(args.results, "utf8"));
} catch (err) {
  console.error(`❌ Could not read results file: ${args.results}\n${err.message}`);
  process.exit(1);
}

try {
  baseline = JSON.parse(readFileSync(args.baseline, "utf8"));
} catch (err) {
  console.error(`❌ Could not read baseline file: ${args.baseline}\n${err.message}`);
  process.exit(1);
}

const THRESHOLD = baseline.regression_threshold ?? 0.10;

// ── Comparison helpers ────────────────────────────────────────────────────────

/**
 * Compute the percentage delta between current and baseline.
 * Positive = regression (current is larger), negative = improvement.
 */
function delta(current, base) {
  if (base === 0) return 0;
  return (current - base) / base;
}

function pct(d) {
  const sign = d >= 0 ? "+" : "";
  return `${sign}${(d * 100).toFixed(1)}%`;
}

function statusEmoji(d) {
  if (d > THRESHOLD) return "🔴"; // regression
  if (d > THRESHOLD * 0.5) return "🟡"; // approaching threshold
  return "✅";
}

// ── Instruction count comparison ──────────────────────────────────────────────

const instrRows = [];
let instrFailed = false;

// results.json has the shape: { benchmarks: [ { fn, cpu_instructions, memory_bytes }, ... ] }
const resultMap = {};
for (const entry of results.benchmarks ?? []) {
  resultMap[entry.fn] = entry;
}

const instrBaseline = baseline.wasm_instruction_counts ?? {};
for (const [fn, base] of Object.entries(instrBaseline)) {
  if (fn.startsWith("_")) continue; // skip notes

  const current = resultMap[fn];
  if (!current) {
    instrRows.push(`| \`${fn}\` | cpu | — | ${base.cpu_instructions.toLocaleString()} | ⚠️ missing |`);
    instrRows.push(`| \`${fn}\` | mem | — | ${base.memory_bytes.toLocaleString()} | ⚠️ missing |`);
    continue;
  }

  const cpuDelta = delta(current.cpu_instructions, base.cpu_instructions);
  const memDelta = delta(current.memory_bytes, base.memory_bytes);

  if (cpuDelta > THRESHOLD || memDelta > THRESHOLD) {
    instrFailed = true;
  }

  instrRows.push(
    `| \`${fn}\` | cpu | ${current.cpu_instructions.toLocaleString()} | ${base.cpu_instructions.toLocaleString()} | ${statusEmoji(cpuDelta)} ${pct(cpuDelta)} |`
  );
  instrRows.push(
    `| \`${fn}\` | mem | ${current.memory_bytes.toLocaleString()} | ${base.memory_bytes.toLocaleString()} | ${statusEmoji(memDelta)} ${pct(memDelta)} |`
  );
}

// ── HTTP response time comparison ─────────────────────────────────────────────

const httpRows = [];
let httpFailed = false;

const httpResults = results.http_response_times ?? {};
const httpBaseline = baseline.http_response_times ?? {};

for (const [endpoint, base] of Object.entries(httpBaseline)) {
  if (endpoint.startsWith("_")) continue;

  const current = httpResults[endpoint];
  if (!current) {
    httpRows.push(`| \`${endpoint}\` | p99 | — | ${base.p99_ms} ms | ⚠️ missing |`);
    continue;
  }

  for (const pctile of ["p50_ms", "p95_ms", "p99_ms"]) {
    if (base[pctile] == null) continue;
    const d = delta(current[pctile] ?? 0, base[pctile]);
    if (d > THRESHOLD) httpFailed = true;
    const label = pctile.replace("_ms", "").toUpperCase();
    httpRows.push(
      `| \`${endpoint}\` | ${label} | ${(current[pctile] ?? "—")} ms | ${base[pctile]} ms | ${statusEmoji(d)} ${pct(d)} |`
    );
  }
}

// ── Lighthouse comparison ─────────────────────────────────────────────────────

const lhRows = [];
let lhFailed = false;

const lhResults = results.lighthouse ?? {};
const lhBaseline = baseline.lighthouse ?? {};

for (const [metric, baseScore] of Object.entries(lhBaseline)) {
  if (metric.startsWith("_")) continue;

  const current = lhResults[metric];
  if (current == null) {
    lhRows.push(`| ${metric} | — | ${baseScore} | ⚠️ missing |`);
    continue;
  }

  // Lighthouse: lower is regression (score dropped).
  const d = delta(baseScore, current); // intentionally inverted
  if (current < baseScore * (1 - THRESHOLD)) lhFailed = true;
  const status = current >= baseScore ? "✅" : current >= baseScore * (1 - THRESHOLD * 0.5) ? "🟡" : "🔴";
  lhRows.push(`| ${metric} | ${current} | ${baseScore} | ${status} ${current >= baseScore ? "+" : ""}${current - baseScore} |`);
}

// ── Build report ──────────────────────────────────────────────────────────────

const overall = instrFailed || httpFailed || lhFailed;
const statusLine = overall
  ? "## ⚠️ Performance Regression Detected"
  : "## ✅ Performance Gate Passed";

const threshold_pct = `${(THRESHOLD * 100).toFixed(0)}%`;

let report = `${statusLine}

> Threshold: **${threshold_pct}** regression on any metric fails the gate.
> Baseline: \`benchmarks/baseline.json\` — update via PR with written justification.

`;

// WASM instruction counts
if (instrRows.length > 0) {
  report += `### WASM Instruction Counts (Soroban budget API)

| Function | Metric | Current | Baseline | Δ |
|---|---|---|---|---|
${instrRows.join("\n")}

`;
}

// HTTP response times
if (httpRows.length > 0) {
  report += `### HTTP Response Times (autocannon, local RPC node)

| Endpoint | Percentile | Current | Baseline | Δ |
|---|---|---|---|---|
${httpRows.join("\n")}

`;
} else {
  report += `### HTTP Response Times

> HTTP benchmarks were not run in this workflow (no local RPC node available).

`;
}

// Lighthouse
if (lhRows.length > 0) {
  report += `### Lighthouse Scores

| Metric | Current | Baseline | Δ |
|---|---|---|---|
${lhRows.join("\n")}

`;
} else {
  report += `### Lighthouse Scores

> Lighthouse benchmarks were not run in this workflow.

`;
}

// Failures summary
if (overall) {
  const failures = [];
  if (instrFailed) failures.push("WASM instruction counts");
  if (httpFailed) failures.push("HTTP response times");
  if (lhFailed) failures.push("Lighthouse scores");
  report += `---

**Failing categories:** ${failures.join(", ")}

To update baselines, open a PR that modifies \`benchmarks/baseline.json\` with a
justification comment in the PR description explaining why the new values are
acceptable. See [docs/performance.md](docs/performance.md) for the full process.
`;
}

// ── Output ────────────────────────────────────────────────────────────────────

if (args.output) {
  writeFileSync(args.output, report, "utf8");
  console.log(`Report written to ${args.output}`);
} else {
  console.log(report);
}

// Print summary to stderr for CI log visibility.
console.error(overall ? "❌ Performance gate FAILED" : "✅ Performance gate passed");

process.exit(overall ? 1 : 0);
