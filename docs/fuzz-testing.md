# Fuzz Testing

This document describes the fuzz-testing setup for the `vesting-cliff-drip-stream`
Soroban contract, covering how to run fuzz targets locally, how the CI nightly job
works, and how to handle crash inputs.

---

## Background

Manual unit tests cannot cover the full input space of arithmetic-heavy smart
contracts. Fuzz testing lets libFuzzer generate millions of random inputs per
minute and track code coverage, exploring combinations that human-authored tests
are unlikely to reach. This has historically revealed overflow bugs, unexpected
panics, and off-by-one errors in Soroban contracts.

---

## Architecture

Because Soroban contracts require a host environment, the fuzz targets are
implemented as **pure Rust harnesses** that mirror every validation step from
the real contract. Each harness reads structured bytes, parses them into typed
fields using the same layout as the corpus seeds, and runs the logic through the
same checked-arithmetic and guard functions as `contract.rs`. This gives full
coverage of all error paths without a live blockchain environment.

---

## Prerequisites

```bash
# cargo-fuzz requires nightly Rust
rustup install nightly

# Install cargo-fuzz
cargo install cargo-fuzz --locked
```

---

## Fuzz targets

| Target | File | What it covers |
|--------|------|----------------|
| `create_vesting_stream` | `fuzz/fuzz_targets/create_vesting_stream.rs` | All `create_vesting_stream` validation branches: `InvalidRate`, `InvalidDuration`, `DepositOverflow`, `DepositBelowMinimum`, `InvalidRecipient`, cliff-ratio check, ledger overflow, metadata length |
| `claim_vested` | `fuzz/fuzz_targets/claim_vested.rs` | `claim_vested` claimable-amount arithmetic: cliff gate, dust collection, overflow guard, `NothingToClaim`, invariants (non-negative, never-exceeds-deposit) |
| `cancel_stream` | `fuzz/fuzz_targets/cancel_stream.rs` | `cancel_stream` refund-split: pre-cliff full refund, post-cliff earned/remainder split, overflow guard, non-negative invariants |
| `metadata_validation` | `fuzz/fuzz_targets/metadata_validation.rs` | Metadata byte validation: UTF-8 decode, length, null bytes, binary content |

---

## Running locally

All commands must be run from the repository root.

### Run a target for 60 seconds

```bash
cargo fuzz run create_vesting_stream -- -max_total_time=60
```

### Run using the existing seed corpus

```bash
cargo fuzz run create_vesting_stream fuzz/corpus/create_vesting_stream/ \
  -- -max_total_time=600
```

### Run all targets sequentially for 10 minutes each

```bash
for target in create_vesting_stream claim_vested cancel_stream metadata_validation; do
  cargo fuzz run "$target" "fuzz/corpus/$target/" -- -max_total_time=600
done
```

### Run with address sanitiser (recommended for finding memory bugs)

```bash
cargo fuzz run create_vesting_stream -- -max_total_time=600 -sanitize_address=1
```

---

## Input layout

Each fuzz target documents its input layout at the top of the source file. The
layouts are designed to maximise the chance that libFuzzer discovers structured
valid inputs early (using the seed corpus) and then mutates toward boundaries.

### `create_vesting_stream` input layout

```
[0..16)   rate            – i128 (little-endian)
[16..20)  cliff_duration  – u32
[20..24)  total_duration  – u32
[24..56)  sponsor_bytes   – 32 bytes (address stand-in)
[56..88)  recipient_bytes – 32 bytes (address stand-in)
[88..92)  start_ledger    – u32
[92..93)  has_metadata    – u8 (0 = no metadata)
[93..)    metadata + token bytes (variable length, split at midpoint)
```

### `claim_vested` input layout

```
[0..4)    current_ledger       – u32
[4..8)    start_ledger         – u32
[8..12)   cliff_duration       – u32
[12..16)  total_duration       – u32
[16..20)  last_claimed_ledger  – u32
[20..36)  rate                 – i128
[36..52)  claimed_amount       – i128
[52..53)  paused               – u8
```

### `cancel_stream` input layout

```
[0..4)    current_ledger       – u32
[4..8)    start_ledger         – u32
[8..12)   cliff_duration       – u32
[12..16)  total_duration       – u32
[16..20)  last_claimed_ledger  – u32
[20..36)  rate                 – i128
[36..52)  claimed_amount       – i128
[52..56)  sponsor_bytes_head   – u32 (first 4 bytes of sponsor identity)
[56..60)  recipient_bytes_head – u32 (first 4 bytes of recipient identity)
```

---

## Seed corpus

Seed corpus files live under `fuzz/corpus/<target>/` and are committed to the
repository. They are binary files that encode interesting boundary values (zero
rate, max u32, overflow thresholds, etc.). The `.gitignore` tracks directory
structure but ignores generated corpus files created by the fuzzer at runtime
(which can grow very large).

To regenerate or extend the seed corpus:

```bash
python3 scripts/gen_fuzz_corpus.py
```

---

## Handling crash inputs

When libFuzzer finds a crash, it writes the input to
`fuzz/artifacts/<target>/crash-<hash>`.

### Reproduce a crash

```bash
cargo fuzz run <target> fuzz/artifacts/<target>/crash-<hash>
```

### Minimise a crash input

```bash
cargo fuzz tmin <target> fuzz/artifacts/<target>/crash-<hash>
```

### Commit a crash as a regression test

1. Reproduce and confirm the crash.
2. Fix the underlying bug.
3. Copy the minimised crash input into `fuzz/regression/<target>/`:

   ```bash
   cp fuzz/artifacts/<target>/crash-<hash> \
      fuzz/regression/<target>/<descriptive-name>
   ```

4. Commit both the fix and the regression input together. The CI fuzz job
   replays all files in `fuzz/regression/` on every run.

---

## CI nightly fuzz job

The workflow is defined in `.github/workflows/fuzz.yml` and runs:

- **Schedule**: nightly at 03:00 UTC on `main`.
- **Manual trigger**: via `workflow_dispatch` with an optional `fuzz_duration_seconds` input.

Each run:
1. Replays all committed regression inputs (fast, no time limit).
2. Fuzzes each target for `FUZZ_DURATION` seconds (default 600 = 10 min) using the seed corpus.
3. Uploads crash inputs as a GitHub Actions artifact (`fuzz-crashes-<run_id>`) if any step fails.
4. Uploads the updated corpus as `fuzz-corpus-<run_id>` for review and local download.

### Downloading crash inputs from CI

1. Go to the failed workflow run on GitHub.
2. Download the `fuzz-crashes-<run_id>` artifact.
3. Reproduce locally (see above).

---

## Coverage report

To measure which lines are exercised by the fuzz corpus:

```bash
# Build coverage instrumentation
cargo fuzz coverage create_vesting_stream fuzz/corpus/create_vesting_stream/

# Generate HTML report (requires llvm-cov)
cargo fuzz coverage create_vesting_stream fuzz/corpus/create_vesting_stream/ \
  -- -artifact_prefix=fuzz/coverage/
```

---

## Adding a new fuzz target

1. Create `fuzz/fuzz_targets/<name>.rs`.
2. Add a `[[bin]]` entry to `fuzz/Cargo.toml`.
3. Create seed corpus files in `fuzz/corpus/<name>/`.
4. Create `fuzz/regression/<name>/.gitkeep` to track the empty directory.
5. Add a fuzz step for `<name>` in `.github/workflows/fuzz.yml`.
6. Document the input layout in this file.
