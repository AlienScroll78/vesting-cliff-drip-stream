# Coverage Report

**Target:** `src/contract.rs` ≥90% line coverage and ≥85% branch coverage
**Tool:** `cargo llvm-cov` (install: `cargo install cargo-llvm-cov`)
**CI:** The [coverage workflow](https://github.com/AlienScroll78/vesting-cliff-drip-stream/actions/workflows/coverage.yml) enforces both thresholds and uploads HTML and LCOV reports.

## Quick start

```bash
# Install once
cargo install cargo-llvm-cov

# Generate the contract-only HTML and LCOV reports and check thresholds
make coverage-ci
```

## Thresholds

| Metric | Threshold | CI enforcement |
|---|---|---|
| Line coverage | 90% | `--fail-under-lines 90` |
| Branch coverage | 85% | `--fail-under-branches 85` |

## Per-module coverage breakdown

Coverage is scoped to `src/contract.rs`; test helpers and other modules do not affect the gate.

## Reports

- HTML report: `docs/coverage/html/index.html` (CI artifact)
- LCOV export: `docs/coverage/lcov.info` (CI artifact)

## Covered paths in contract.rs

The focused edge-case suite lives in `src/tests/test_coverage.rs`; shared test setup in `src/tests/` is excluded from the measured source by the `src/contract.rs` include filter.

The cliff-ledger overflow is only reachable by setting `max_cliff_ratio` to its valid maximum (10,000 bps) before creating the stream. The default 5,000 bps cap rejects that input earlier as an invalid duration.
