#!/usr/bin/env bash
# check_bench_regression.sh — CI benchmark regression check
# Closes #621, #622, #623, #624
#
# Fails if any benchmark metric exceeds its baseline by more than
# BENCH_THRESHOLD_PCT percent (default 10%).
#
# Usage:
#   ./scripts/check_bench_regression.sh
#
# Environment variables:
#   BENCH_THRESHOLD_PCT   Regression percentage threshold (default: 10)
#   BENCH_BASELINE        Path to baseline JSON file (default: benchmarks/baseline.json)
#   BENCH_RESULTS         Path to results JSON file  (default: benchmarks/results.json)
#
# Generate results.json before running this script:
#   cargo test --features testutils bench_ -- --nocapture 2>/dev/null \
#     | grep '^BENCH' | sed 's/^BENCH //' \
#     | jq -s '{benchmarks: .}' > benchmarks/results.json

set -euo pipefail

THRESHOLD_PCT="${BENCH_THRESHOLD_PCT:-10}"
BASELINE="${BENCH_BASELINE:-benchmarks/baseline.json}"
RESULTS="${BENCH_RESULTS:-benchmarks/results.json}"

# ── Validate inputs ────────────────────────────────────────────────────────────

if [[ ! -f "$BASELINE" ]]; then
  echo "ERROR: Baseline file '$BASELINE' not found."
  echo "Expected baseline at: $BASELINE"
  exit 1
fi

if [[ ! -f "$RESULTS" ]]; then
  echo "ERROR: Results file '$RESULTS' not found."
  echo ""
  echo "Generate it with:"
  echo "  cargo test --features testutils bench_ -- --nocapture 2>/dev/null \\"
  echo "    | grep '^BENCH' | sed 's/^BENCH //' \\"
  echo "    | jq -s '{benchmarks: .}' > benchmarks/results.json"
  exit 1
fi

echo "╔══════════════════════════════════════════════════════════════════════╗"
echo "║           Benchmark Regression Check                                ║"
echo "╚══════════════════════════════════════════════════════════════════════╝"
echo ""
echo "  Baseline : $BASELINE"
echo "  Results  : $RESULTS"
echo "  Threshold: ${THRESHOLD_PCT}%"
echo ""

# ── Run comparison via Python ──────────────────────────────────────────────────

python3 - <<EOF
import json, sys

with open('${BASELINE}') as f:
    baseline_data = json.load(f)

# Baseline may use wasm_instruction_counts key or benchmarks key
if 'wasm_instruction_counts' in baseline_data:
    baseline = baseline_data['wasm_instruction_counts']
    # Convert to list-of-dicts format
    baseline_list = [{'fn': k, **v} for k, v in baseline.items() if not k.startswith('_')]
else:
    baseline_list = baseline_data.get('benchmarks', [])

with open('${RESULTS}') as f:
    results_data = json.load(f)

results = {b['fn']: b for b in results_data.get('benchmarks', [])}

threshold = ${THRESHOLD_PCT} / 100
failed = []
missing = []
passed = 0

print(f"  {'Function':<40} {'Metric':<20} {'Baseline':>12} {'Result':>12} {'Delta':>8} {'Status'}")
print(f"  {'-'*40} {'-'*20} {'-'*12} {'-'*12} {'-'*8} {'-'*6}")

for base_entry in baseline_list:
    fn_name = base_entry.get('fn') or base_entry.get('name', '')
    if not fn_name or fn_name.startswith('_'):
        continue

    if fn_name not in results:
        missing.append(fn_name)
        continue

    result = results[fn_name]

    for metric, metric_label in [
        ('cpu_instructions', 'cpu_instructions'),
        ('memory_bytes', 'memory_bytes'),
    ]:
        base_val = base_entry.get(metric, 0)
        result_val = result.get(metric, 0)

        if base_val == 0:
            continue

        ratio = (result_val - base_val) / base_val
        sign = '+' if ratio >= 0 else ''
        status = '✅ PASS' if ratio <= threshold else '❌ FAIL'

        print(f"  {fn_name:<40} {metric_label:<20} {base_val:>12,} {result_val:>12,} {sign}{ratio*100:>7.1f}% {status}")

        if ratio > threshold:
            failed.append(f"{fn_name}.{metric}: {sign}{ratio*100:.1f}% (limit: +{threshold*100:.0f}%)")
        else:
            passed += 1

print("")

if missing:
    print(f"  ⚠️  {len(missing)} function(s) in baseline missing from results:")
    for fn_name in missing:
        print(f"     - {fn_name}")
    print("")

total = passed + len(failed)
print(f"  Results: {passed}/{total} checks passed")
print("")

if failed:
    print(f"  ❌ REGRESSION DETECTED — {len(failed)} benchmark(s) exceeded {threshold*100:.0f}% threshold:")
    for msg in failed:
        print(f"     FAIL  {msg}")
    print("")
    print("  To update baseline after a justified perf change:")
    print("    1. Edit benchmarks/baseline.json with new values")
    print("    2. Submit a PR with a written justification")
    sys.exit(1)
else:
    print(f"  ✅ All benchmarks within {threshold*100:.0f}% regression threshold. No regressions detected.")
    sys.exit(0)
EOF
