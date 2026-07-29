# Coverage Report — contract.rs
**Target:** 100% line coverage on `src/contract.rs`
**Tool:** `cargo llvm-cov` (install: `cargo install cargo-llvm-cov`)

## How to regenerate

```bash
# Install once
cargo install cargo-llvm-cov

# Generate HTML report
cargo llvm-cov --features testutils --html --output-dir docs/coverage/html

# Generate lcov for CI
cargo llvm-cov --features testutils --lcov --output-path docs/coverage/lcov.info
```

## Covered paths in contract.rs (issue #95)

| Function | Branch | Test |
|---|---|---|
| `create_vesting_stream` | `InvalidRate` | `test_create_stream_zero_rate_fails`, `test_regression_negative_rate_rejected` |
| `create_vesting_stream` | `InvalidDuration` | `test_create_stream_invalid_duration_fails` |
| `create_vesting_stream` | `ScheduleAlreadyExists` | `test_create_duplicate_stream_fails` |
| `create_vesting_stream` | `DepositOverflow` (rate×duration) | `test_create_deposit_overflow_from_rate_mul` |
| `create_vesting_stream` | `DepositOverflow` (end_ledger) | `test_create_deposit_overflow_from_total_add` |
| `create_vesting_stream` | success path | `test_create_stream_success` |
| `cancel_stream` | `ScheduleNotFound` | `test_cancel_nonexistent_stream_fails` |
| `cancel_stream` | before cliff, full refund | `test_cancel_before_cliff_full_refund`, `test_cancel_one_ledger_before_cliff_full_refund` |
| `cancel_stream` | at cliff boundary | `test_cancel_exactly_at_cliff_splits_tokens` |
| `cancel_stream` | after cliff, split | `test_cancel_after_cliff_splits_tokens`, `test_cancel_one_ledger_after_cliff_splits_tokens` |
| `cancel_stream` | sponsor_refund == 0 (cancel at end) | `test_cancel_at_end_ledger_zero_sponsor_refund` |
| `claim_vested` | `ScheduleNotFound` | `test_claim_nonexistent_schedule_fails` |
| `claim_vested` | `CliffNotReached` | `test_claim_before_cliff_fails` |
| `claim_vested` | `NothingToClaim` | `test_double_claim_same_ledger_returns_nothing_to_claim` |
| `claim_vested` | stream finished → remove schedule | `test_claim_past_end_caps_at_end_ledger` |
| `claim_vested` | partial claim | `test_partial_claim_mid_stream` |
| `get_schedule` | `Some` | `test_create_stream_success` |
| `get_schedule` | `None` | `test_get_schedule_returns_none_after_completion` |
| `claimable_amount` | no schedule → 0 | `test_claimable_amount_no_schedule_returns_zero` |
| `claimable_amount` | before cliff → 0 | `test_claimable_amount_before_cliff_is_zero`, `test_regression_claimable_amount_zero_before_cliff` |
| `claimable_amount` | after cliff | `test_claimable_amount_after_cliff` |
| `is_cliff_passed` | no schedule → false | `test_is_cliff_passed_no_schedule_returns_false` |
| `is_cliff_passed` | before/after cliff | `test_is_cliff_passed`, `test_regression_is_cliff_passed_boundary` |

## CI enforcement

Add to `.github/workflows/ci.yml`:

```yaml
- name: Check coverage
  run: |
    cargo install cargo-llvm-cov
    cargo llvm-cov --features testutils --fail-under-lines 100 -- --lib
```
