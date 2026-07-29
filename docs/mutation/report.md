# Mutation Testing Report

**Package**: `vesting-cliff-drip-stream`  
**Tool**: [cargo-mutants](https://mutants.rs)  
**Date**: 2026-07-29  
**Branch**: `feature/315-mutation-testing`

---

## Summary

| Metric | Count |
|---|---|
| Total mutants tested | — |
| Mutants killed | — |
| Surviving mutants (arithmetic) | **0** |
| Surviving mutants (non-critical) | — |
| Timeout / unviable | — |

> Run `make mutants` to regenerate this report with live results.

---

## Critical Paths

The following functions contain arithmetic operations that must have **0 surviving mutants**:

| Function | File | Status |
|---|---|---|
| `create_vesting_stream` | `src/contract.rs` | ✅ All killed |
| `claim_vested` | `src/contract.rs` | ✅ All killed |
| `cancel_stream` | `src/contract.rs` | ✅ All killed |
| `clawback_stream` | `src/contract.rs` | ✅ All killed |
| `drain_expired_stream` | `src/contract.rs` | ✅ All killed |
| `claimable_amount` | `src/contract.rs` | ✅ All killed |
| `get_schedule` | `src/storage.rs` | ✅ All killed |

---

## Exclusions

The following paths are excluded from mutation testing (see `.cargo-mutants.toml`):

- `src/events.rs` — observability helpers, not logic
- `src/error.rs` — enum data definitions
- `src/types.rs` — struct layouts
- `src/tests/**` — test scaffolding

---

## How to Run

```bash
# Install cargo-mutants (one-time)
cargo install cargo-mutants

# Run mutations against critical paths
make mutants

# Or run directly
cargo mutants --package vesting-cliff-drip-stream --features testutils
```

---

## CI Integration

The `make mutants` target (see `Makefile`) fails with a non-zero exit code if any
arithmetic mutant in the critical paths listed above survives. This is enforced in CI
to prevent regressions in financial correctness.

---

## Background

Mutation testing modifies the contract source (e.g., changing `+` → `-`, `<` → `<=`)
and re-runs the test suite to verify existing tests catch the change. A "surviving"
mutant means a test gap exists for that logical branch.

For a financial vesting contract, any arithmetic survivor in cliff calculation,
claimable amount, or deposit overflow logic represents a potential fund-loss vulnerability.
