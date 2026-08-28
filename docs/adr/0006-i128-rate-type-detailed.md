# ADR-0006: i128 as the Rate and Token Amount Type

- **Status**: Accepted
- **Date**: 2026-07-30

## Context

The `create_vesting_stream` function accepts a `rate` parameter that represents
the number of tokens released to the recipient per ledger. This value is
subsequently multiplied by ledger counts (stored as `u32`) to derive:

- the **total deposit** transferred from the sponsor at stream creation
  (`rate × total_duration`);
- each **claimable amount** (`rate × elapsed_ledgers`);
- the **refund** or **recipient share** computed during `cancel_stream`; and
- the **emergency drain amount** recovered via `emergency_drain`.

The choice of numeric type for `rate` therefore affects overflow safety,
inter-operability with the Soroban token interface, gas cost, and the
developer experience for callers that need to display human-readable amounts.

### Alternatives considered

| Option | Representation | Unit |
|--------|---------------|------|
| A | `i128` integer | tokens (or stroops) per ledger |
| B | `i128` integer | tokens (or stroops) per second |
| C | `i128` integer | tokens (or stroops) per day |
| D | Fixed-point decimal (e.g. `(i128, u8)` mantissa + scale) | fractional tokens per ledger |
| E | Basis-points integer (`i128`, where 10 000 bps = 100 %) | percentage of principal per ledger |

**Option B — per second**: Soroban ledger time is not guaranteed to be
uniform; the protocol targets ~5 s/ledger but this can drift during
network congestion or validator restarts. Expressing rate in seconds couples
the contract to an externally-observable wall-clock assumption and forces
callers to convert between wall-clock and ledger counts at every call site.
Ledger-based arithmetic is more predictable and verifiable on-chain.

**Option C — per day**: A "per day" rate is friendly for display but requires
an approximate ledger-per-day constant (≈ 17 280 at 5 s/ledger) baked into
the contract. That constant is a protocol-level assumption that can change,
making the contract incorrect without an upgrade. The conversion also loses
precision for small allocations: a 1-token-per-day rate silently rounds to
zero if the wrong divisor is used.

**Option D — fixed-point decimal**: Soroban's XDR type system and the
`token::Client` interface both operate on plain `i128` integers. Introducing
a fixed-point pair `(i128, u8)` would require custom arithmetic, a second
storage field in `VestingSchedule`, additional gas, and casting at every
`transfer` call site. The Stellar asset convention is already fixed-point
at the presentation layer (1 unit = 10⁻⁷ of the display denomination for
native XLM), so the stroop granularity is handled by the token contract, not
here.

**Option E — basis points**: Basis-point rates express the stream as a
fraction of the total deposit, which is meaningful for percentage-based
vesting schedules. However, basis-point math requires knowledge of the total
principal at every claim, adds a division at each step, and can produce
rounding error that accumulates across many partial claims. The contract's
simpler invariant is `claimable = rate × elapsed_ledgers`, which does not
require the principal to be stored redundantly.

### Soroban integer type constraints

The Soroban SDK supports the following integer types in contract interfaces:
`u32`, `u64`, `u128`, `i32`, `i64`, `i128`. Of these, `i128` is the widest
signed type and is the type used by `token::Client::transfer` and
`token::Client::balance`. Using any narrower type would require an explicit
`as i128` cast at every token interaction, creating a maintenance burden and a
potential source of silent truncation bugs.

`u128` was considered but rejected because the Soroban token interface uses
`i128`, and negative-value errors (e.g., `InvalidRate`) are most cleanly
expressed by checking `rate <= 0` on a signed type rather than relying on
underflow of an unsigned type.

## Decision

`rate_per_ledger` and all derived token amounts are typed as **`i128`**, matching
the Soroban SDK token interface directly:

```rust
// In VestingSchedule (types.rs)
pub rate_per_ledger: i128,

// In create_vesting_stream (contract.rs)
pub fn create_vesting_stream(
    env: Env,
    sponsor: Address,
    recipient: Address,
    token: Address,
    rate: i128,           // tokens-per-ledger, must be > 0
    cliff_duration: u32,
    total_duration: u32,
) -> Result<(), VestingError>
```

All multiplications use `checked_mul` to convert potential overflow into the
recoverable `DepositOverflow` error rather than a runtime panic:

```rust
rate.checked_mul(total_duration as i128)
    .ok_or(VestingError::DepositOverflow)
```

Negative and zero rates are rejected at entry:

```rust
if rate <= 0 {
    return Err(VestingError::InvalidRate);
}
```

### Safe rate boundary

For a stream of duration `d` ledgers, the maximum rate that will not overflow
is:

```
rate_max = i128::MAX / d
         = 170_141_183_460_469_231_731_687_303_715_884_105_727 / d
```

For a 10-year stream at 5 s/ledger (≈ 63 072 000 ledgers), `rate_max ≈ 2.7 × 10³⁰`
tokens-per-ledger. For practical SAC tokens with 7 decimal places (1 display
unit = 10 000 000 stroops), this accommodates rates up to approximately
2.7 × 10²³ display units per ledger — far beyond any realistic vesting schedule.

## Consequences

### Benefits

- **No cast overhead**: `token::Client::transfer` accepts `&i128` directly; no
  conversion is needed at transfer time.
- **Uniform type surface**: callers interact with a single numeric type
  throughout the API, reducing cognitive load.
- **Overflow is recoverable**: `checked_mul` turns overflow into the
  `DepositOverflow` error (code 5), which clients can handle gracefully.
- **Gas-efficient**: integer multiplication is a single instruction; no
  division, scaling, or multi-word arithmetic is needed for the core vesting
  loop.

### Trade-offs

- **UI must convert to display units**: the contract stores and transmits
  raw token amounts (stroops or the token's base unit). UIs must divide by the
  token's `decimals` value to present a human-friendly number. This is standard
  practice for Stellar tokens and should be handled in the presentation layer,
  not the contract.

  Example (TypeScript):
  ```typescript
  const ratePerLedger = BigInt(schedule.rate_per_ledger);
  const decimals = 7n; // for XLM-equivalent tokens
  const displayRatePerDay = (ratePerLedger * 17_280n) / 10n ** decimals;
  ```

  The constant 17 280 is the approximate number of ledgers per day at 5 s/ledger
  and **must be treated as an estimate** in the UI — it should not be stored
  in the contract.

- **Ledger-time assumptions in UX copy**: any UI that converts `rate_per_ledger`
  to a wall-clock equivalent (e.g., "~X tokens per day") must document that the
  displayed figure is based on a nominal 5-second ledger time and may differ
  from actual release timing during periods of network instability.

- **Signed type requires rate > 0 guard**: because `i128` is signed, the
  contract must explicitly reject `rate <= 0`. This guard is in place and is
  covered by the `InvalidRate` (code 4) integration test.

### Migration consideration

If a future version of the contract needs to support sub-ledger granularity
(e.g., fractional-token rates), the recommended path is:

1. Introduce a new field `rate_scale: u8` alongside the existing
   `rate_per_ledger: i128`, where `rate_per_ledger` is interpreted as
   `rate_per_ledger / 10^rate_scale` tokens per ledger.
2. Assign a new ADR number (0007 or later) and status `Supersedes ADR-0006`.
3. Deploy via a contract upgrade; existing streams use the old layout
   (`rate_scale` defaults to 0) because the storage key is per-recipient and
   the schedule version can be inferred from the presence of the new field.

Changing the `rate` parameter type in the public API (e.g., from `i128` to a
struct) is a **breaking ABI change** and would require a new contract address
or a migration transaction for all active streams.
