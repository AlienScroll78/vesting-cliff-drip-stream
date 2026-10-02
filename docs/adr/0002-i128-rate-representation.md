# ADR-0002: i128 for Rate and Token Amounts

- **Status**: Accepted
- **Date**: 2026-06-26

## Context

Token amounts on Stellar are expressed in stroops (1 XLM = 10 000 000 stroops). SAC token balances and transfer amounts use `i128` throughout the Soroban token interface. The contract must multiply `rate_per_ledger` by a ledger count (up to `u32::MAX ≈ 4.3 × 10⁹`) to compute the total deposit and claimable amounts.

Using `u64` (max ~1.8 × 10¹⁹) risks overflow for realistic token allocations at fine-grained rates. The Soroban SDK's `token::Client` already requires `i128` for `transfer` calls, so any narrower type would require a cast at every call site.

## Decision

`rate_per_ledger` and all derived token amounts (`total_deposit`, `claimable_amount`, `recipient_share`, `sponsor_refund`) are typed as `i128`, matching the Soroban token interface directly.

```rust
pub rate_per_ledger: i128,
```

All multiplications use `checked_mul` to convert overflow into a recoverable `DepositOverflow` error rather than a panic:

```rust
rate.checked_mul(total_duration as i128)
    .ok_or(VestingError::DepositOverflow)
```

A negative `rate` is rejected at validation time (`InvalidRate`), so the signed type introduces no semantic ambiguity.

## Consequences

- No casts needed when calling `token::Client::transfer`.
- The maximum safe rate for a stream of duration `d` is `i128::MAX / d`; callers that exceed this receive `DepositOverflow`.
- Using a signed type means defensive `rate <= 0` validation is required at entry, which is already enforced.
