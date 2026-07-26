#!/usr/bin/env node
/**
 * Performance regression comparator.
 *
 * Reads benchmarks/baseline.json and one or more results files, then:
 *  - Computes the % delta for every metric
 *  - Exits with code 1 if any metric regresses more than THRESHOLD_PCT
 *  - Prints a Markdown table suitable for a GitHub PR comment
 *
 * Usage:
 *   node benchmarks/compare.js [options]
 *
 * Options:
 *   --baseline <path>    Baseline JSON  (default: benchmarks/baseline.json)
 *   --wasm    <path>     WASM results   (default: benchmarks/results.json)
 *   --http    <path>     HTTP results   (default: benchmarks/http_results.json)
 *   --threshold <pct>    Regression threshold, default from baseline._meta
 *   --output  <path>     Write Markdown table to file (optional)
 *   --github-output      Emit GITHUB_OUTPUT format for PR comment step
 *
 * Exit codes:
 *   0  All metrics within threshold
 *   1  One or more regressions detected (or missing results file)
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");

// ── CLI args ──────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const a = {
    baseline:     path.join(__dirname, "baseline.json"),
    wasm:         path.join(__dirname, "results.json"),
    http:         path.join(__dirname, "http_results.json"),
    threshold:    null,   // read from baseline._meta.threshold_pct
    output:       null,
    githubOutput: false,
  };
  for (let i = 2; i < argv.length; i++) {
    switch (argv[i]) {
      case "--baseline":      a.baseline     = argv[++i]; break;
      case "--wasm":          a.wasm         = argv[++i]; break;
      case "--http":          a.http         = argv[++i]; break;
      case "--threshold":     a.threshold    = parseFloat(argv[++i]); break;
      case "--output":        a.output       = argv[++i]; break;
      case "--github-output": a.githubOutput = true;      break;
    }
  }
  return a;
}

const opts = parseArgs(process.argv);

// ── File helpers ──────────────────────────────────────────────────────────────

function readJson(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (e) {
    console.error(`Failed to parse ${filePath}: ${e.message}`);
    return null;
  }
}

// ── Delta computation ─────────────────────────────────────────────────────────

/**
 * Computes percent change from baseline to current.
 * Positive = regression (current is worse / higher).
 * For requests_per_sec, lower is worse so sign is inverted.
 */
function pctDelta(baseline, current, isHigherBetter = false) {
  if (baseline === 0) return 0;
  const raw = ((current - baseline) / baseline) * 100;
  return isHigherBetter ? -raw : raw; // normalise: positive always means worse
}

function fmtDelta(delta) {
  const sign = delta > 0 ? "+" : "";
  return `${sign}${delta.toFixed(1)}%`;
}

function statusIcon(delta, threshold) {
  if (delta > threshold)  return "🔴 FAIL";
  if (delta > threshold * 0.8) return "🟡 WARN";
  return "✅ OK";
}

// ── Comparison rows ───────────────────────────────────────────────────────────

/**
 * @returns {{ rows: Row[], regressions: Row[] }}
 * Row: { section, metric, baseline, current, delta, status }
 */
function buildRows(baseline, wasmResults, httpResults, threshold) {
  const rows = [];
  const regressions = [];

  function addRow(section, metric, bVal, cVal, isHigherBetter = false) {
    if (bVal == null || cVal == null || cVal < 0) return;
    const delta = pctDelta(bVal, cVal, isHigherBetter);
    const status = statusIcon(delta, threshold);
    const row = { section, metric, baseline: bVal, current: cVal, delta, status };
    rows.push(row);
    if (delta > threshold) regressions.push(row);
  }

  // WASM instruction counts
  if (wasmResults && baseline.wasm_instruction_counts) {
    const bWasm = baseline.wasm_instruction_counts;
    const cWasm = wasmResults.wasm_instruction_counts || {};
    for (const fn_name of Object.keys(bWasm)) {
      if (fn_name.startsWith("_")) continue;
      const b = bWasm[fn_name];
      const c = cWasm[fn_name];
      if (!b || !c) continue;
      addRow("WASM", `${fn_name} cpu_instructions`, b.cpu_instructions, c.cpu_instructions);
      addRow("WASM", `${fn_name} mem_bytes`,        b.mem_bytes,        c.mem_bytes);
    }
  }

  // HTTP response times
  if (httpResults && baseline.http_response_times) {
    const bHttp = baseline.http_response_times;
    const cHttp = httpResults.http_response_times || {};
    for (const endpoint of Object.keys(bHttp)) {
      if (endpoint.startsWith("_")) continue;
      const b = bHttp[endpoint];
      const c = cHttp[endpoint];
      if (!b || !c) continue;
      addRow("HTTP", `${endpoint} p50_ms`, b.p50_ms, c.p50_ms);
      addRow("HTTP", `${endpoint} p95_ms`, b.p95_ms, c.p95_ms);
      addRow("HTTP", `${endpoint} p99_ms`, b.p99_ms, c.p99_ms);
      addRow("HTTP", `${endpoint} rps`,    b.requests_per_sec, c.requests_per_sec, true);
    }
  }

  return { rows, regressions };
}

// ── Markdown table builder ────────────────────────────────────────────────────

function buildMarkdown(rows, regressions, threshold) {
  const header = regressions.length === 0
    ? "## ✅ Performance — no regressions detected"
    : `## 🔴 Performance — ${regressions.length} regression(s) detected (threshold: ${threshold}%)`;

  const tableHeader = [
    "| Section | Metric | Baseline | Current | Delta | Status |",
    "|---------|--------|----------|---------|-------|--------|",
  ].join("\n");

  const tableRows = rows
    .map(
      (r) =>
        `| ${r.section} | ${r.metric} | ${r.baseline} | ${r.current} | ${fmtDelta(r.delta)} | ${r.status} |`
    )
    .join("\n");

  const footer = [
    "",
    `> Threshold: regressions > **${threshold}%** fail the build.`,
    "> To update baselines, open a PR editing `benchmarks/baseline.json` with justification.",
  ].join("\n");

  return [header, "", tableHeader, tableRows, footer].join("\n");
}

// ── Main ──────────────────────────────────────────────────────────────────────

function main() {
  const baseline = readJson(opts.baseline);
  if (!baseline) {
    console.error(`Baseline not found: ${opts.baseline}`);
    process.exit(1);
  }

  const threshold =
    opts.threshold ?? baseline._meta?.threshold_pct ?? 10;

  const wasmResults = readJson(opts.wasm);
  const httpResults = readJson(opts.http);

  if (!wasmResults && !httpResults) {
    console.error(
      `No results files found.\n  WASM: ${opts.wasm}\n  HTTP: ${opts.http}`
    );
    process.exit(1);
  }

  const { rows, regressions } = buildRows(
    baseline, wasmResults, httpResults, threshold
  );

  if (rows.length === 0) {
    console.error("No comparable rows found between baseline and results.");
    process.exit(1);
  }

  const markdown = buildMarkdown(rows, regressions, threshold);

  // Always print to stdout.
  console.log(markdown);

  // Optionally write to file.
  if (opts.output) {
    fs.mkdirSync(path.dirname(path.resolve(opts.output)), { recursive: true });
    fs.writeFileSync(opts.output, markdown + "\n");
    console.error(`Markdown written to ${opts.output}`);
  }

  // Emit GitHub Actions output for the PR-comment step.
  if (opts.githubOutput) {
    const envFile = process.env.GITHUB_OUTPUT;
    if (envFile) {
      const escaped = markdown.replace(/%/g, "%25").replace(/\n/g, "%0A").replace(/\r/g, "%0D");
      fs.appendFileSync(envFile, `perf_table=${escaped}\n`);
      fs.appendFileSync(envFile, `regression_count=${regressions.length}\n`);
    }
  }

  if (regressions.length > 0) {
    console.error(`\n❌ ${regressions.length} regression(s) exceed threshold of ${threshold}%:`);
    for (const r of regressions) {
      console.error(`   ${r.section} / ${r.metric}: ${fmtDelta(r.delta)} (baseline=${r.baseline}, current=${r.current})`);
    }
    process.exit(1);
  }

  console.error(`\n✅ All ${rows.length} metrics within ${threshold}% threshold.`);
  process.exit(0);
}

main();
