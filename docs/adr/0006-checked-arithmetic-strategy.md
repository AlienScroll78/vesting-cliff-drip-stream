# ADR-0006: Checked Arithmetic Strategy and Overflow Boundary Documentation

- **Status**: Accepted
- **Date**: 2026-07-30

## Context

The contract performs integer arithmetic on two distinct numeric domains:

1. **Token amounts** (`i128`): multiplication of `rate_per_ledger × duration` to compute a total deposit. The product must fit within `i128` because the Soroban token interface requires `i128` for all transfer amounts. The maximum value `i128::MAX` is approximately 1.70 × 10³⁸.

2. **Ledger sequence numbers** (`u32`): addition of `start_ledger + cliff_duration` and `start_ledger + total_duration` to derive `cliff_ledger` and `end_ledger`. Both operands and the result must fit within `u32`. The maximum value `u32::MAX` is 4,294,967,295.

In Rust, integer overflow on `u32` and `i128` in debug mode causes a panic; in release mode it silently wraps. Either outcome is unacceptable in a smart contract:

- A **panic** aborts the transaction with a host error, not a typed `VestingError`, giving clients no structured error code to switch on.
- A **silent wrap** produces a logically incorrect ledger height or token amount. For example, a deposit amount that wraps to a small positive value could pass validation while the contract holds far fewer tokens than intended, leaving it insolvent.

Two Rust overflow-handling alternatives were evaluated:

- `wrapping_mul` / `wrapping_add`: silently wraps; hides bugs in production.
- `checked_mul` / `checked_add`: returns `None` on overflow, which the contract converts into a deterministic `VestingError::DepositOverflow` (code 5).

A third option, `saturating_mul`, was rejected because it would allow a technically-valid-but-wrong result to be used silently (e.g., a deposit capped at `i128::MAX` tokens would incorrectly succeed at the token-transfer stage if the sponsor's balance is insufficient).

## Decision

All arithmetic operations in the contract that can overflow use the `checked_*` family of methods. Any `None` result is mapped to `VestingError::DepositOverflow` (error code 5), defined in `src/error.rs`.

### Arithmetic operations and their overflow protection

| Location | Operation | Type | Method | Failure |
|---|---|---|---|---|
| `src/contract.rs` — `calculate_total_deposit` | `rate × total_duration` | `i128 × i128` | `checked_mul` | `DepositOverflow` |
| `src/contract.rs` — `create_vesting_stream` | `start_ledger + cliff_duration` | `u32 + u32` | `checked_add` | `DepositOverflow` |
| `src/contract.rs` — `create_vesting_stream` | `start_ledger + total_duration` | `u32 + u32` | `checked_add` | `DepositOverflow` |
| `src/contract.rs` — `drain_expired_stream` | `end_ledger + DRAIN_DELAY_LEDGERS` | `u32 + u32` | `checked_add` | `DepositOverflow` |

The `cancel_stream` and `claim_vested` subtraction operations (`active_end - last_claimed_ledger`, `end_ledger - last_claimed_ledger`) are safe by construction: `active_end` is always `≤ end_ledger` and `last_claimed_ledger` is always initialised to `start_ledger` and only advanced forward, so these differences are always non-negative and bounded by the total duration.

### Implementation

`calculate_total_deposit` is the canonical entry point for the deposit multiplication:

```rust
pub fn calculate_total_deposit(
    rate: i128,
    total_duration: u32,
) -> Result<i128, VestingError> {
    rate.checked_mul(total_duration as i128)
        .ok_or(VestingError::DepositOverflow)
}
```

Ledger additions in `create_vesting_stream`:

```rust
let cliff_ledger: u32 = start_ledger
    .checked_add(cliff_duration)
    .ok_or(VestingError::DepositOverflow)?;

let end_ledger: u32 = start_ledger
    .checked_add(total_duration)
    .ok_or(VestingError::DepositOverflow)?;
```

### Overflow boundary formula

For `calculate_total_deposit`, the exact safe boundary is:

```
safe if: rate ≤ i128::MAX / total_duration
unsafe if: rate > i128::MAX / total_duration
```

Equivalently, the maximum safe `rate` for a given `total_duration` is:

```
max_safe_rate = i128::MAX / total_duration
             = 170_141_183_460_469_231_731_687_303_715_884_105_727 / total_duration
```

At the exact boundary, `rate × total_duration` produces a value ≤ `i128::MAX` and the call succeeds. One unit above the boundary causes `checked_mul` to return `None`, and the contract returns `DepositOverflow`.

For ledger additions, the boundary is:

```
safe if: start_ledger + cliff_duration ≤ u32::MAX  (4,294,967,295)
safe if: start_ledger + total_duration ≤ u32::MAX
```

In practice, `start_ledger` is the current network ledger sequence (~50 million on mainnet as of 2026). The maximum safe `total_duration` is approximately `u32::MAX − start_ledger ≈ 4.24 billion ledgers (~680 years)`. No real vesting schedule will approach this limit.

### Error code assignment

`DepositOverflow` reuses error code 5 for all arithmetic failures because:

1. Both multiplication and addition overflows share the same root cause (inputs too large).
2. Clients receive a clear, actionable signal: the provided parameters exceed the contract's safe range.
3. Introducing separate codes for each arithmetic site would expand the error space without adding client-actionable information.

See [ADR-0004](0004-error-code-numbering.md) for the error code numbering policy.

## Test Coverage Requirements

Every overflow path must have a dedicated test. The following tests are required and present in the test suite:

### In `src/tests/test_coverage.rs`

| Test | Overflow path covered |
|---|---|
| `test_create_deposit_overflow_from_rate_mul` | `rate.checked_mul(total_duration)` — `i128::MAX` rate with duration > 1 |
| `test_create_deposit_overflow_from_cliff_add` | `start_ledger.checked_add(cliff_duration)` — `u32::MAX` cliff |
| `test_create_deposit_overflow_from_total_add` | `start_ledger.checked_add(total_duration)` — `u32::MAX` total |

### In `src/tests/test_fuzz.rs` (proptest)

| Test | Overflow path covered |
|---|---|
| `f1_overflow_returns_deposit_overflow` | Any `(rate, total_duration)` product that overflows `i128` |
| `f2_max_rate_always_overflows` | `i128::MAX` rate for any `total_duration ≥ 2` |
| `f3_boundary_one_above_overflows` | Exact boundary: `rate = i128::MAX / total_duration` succeeds; `rate + 1` overflows |
| `f4_extreme_durations_no_panic` | `total_duration ≤ cliff_duration` returns `InvalidDuration`, not a panic |
| `f5_valid_inputs_succeed` | Valid small inputs never panic or return unexpected errors |

### Coverage rule

Any future arithmetic operation added to the contract that can overflow must:

1. Use `checked_*` and map `None` to a `VestingError` variant.
2. Include at least one unit test for the exact overflow boundary.
3. Include at least one proptest that exercises the overflow range exhaustively.
4. Be listed in the arithmetic operations table in the Decision section above.

This ADR must be reviewed and the table updated before any new arithmetic is merged.

## Consequences

- All arithmetic failures produce a deterministic `DepositOverflow` (code 5) error that clients can handle gracefully. No panics, no silent wraps.
- The overflow boundary formula (`i128::MAX / total_duration`) is documented in the README Security Considerations section and in this ADR, so future contributors do not need to rediscover it.
- Using `checked_*` adds minimal runtime cost: a single branch per operation on modern hardware, with no heap allocation.
- The overhead of returning `Result` from `calculate_total_deposit` propagates through the call chain via `?`. This is idiomatic Rust and does not require special handling at call sites.
- Future arithmetic operations (e.g., a new fee calculation or a compound-interest model) must follow the same pattern. The test coverage rule above enforces this at review time.

## References

- `src/contract.rs` — `calculate_total_deposit`, `create_vesting_stream`, `drain_expired_stream`
- `src/error.rs` — `VestingError::DepositOverflow` (code 5)
- `src/tests/test_coverage.rs` — deterministic overflow tests
- `src/tests/test_fuzz.rs` — property-based overflow tests (F1–F5)
- [ADR-0002 — i128 for Rate and Token Amounts](0002-i128-rate-representation.md)
- [ADR-0004 — Error Code Numbering](0004-error-code-numbering.md)
- [docs/storage.md](../storage.md) — storage layout and related design context
