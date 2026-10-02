# ADR-0003: Cliff Math and Catch-Up Claim

- **Status**: Accepted
- **Date**: 2026-06-26

## Context

A cliff-vesting contract must answer: *what happens to tokens that accrued during the cliff period?*

Two common models exist:

1. **Forfeit model** – tokens accrue only after the cliff; the cliff period is a pure lock.
2. **Catch-up model** – tokens accrue from `start_ledger`; the cliff gates *withdrawal*, not accrual. On first claim after the cliff, all back-accrued tokens are released at once.

The catch-up model is standard in equity vesting (cliff grant) and is more attractive to contributors because no value is lost simply by waiting.

## Decision

The contract implements the **catch-up model**. `last_claimed_ledger` is initialised to `start_ledger`, not `cliff_ledger`. The first successful `claim_vested` call after `cliff_ledger` pays out all ledgers since `start_ledger`:

```
claimable_ledgers = min(current_ledger, end_ledger) − last_claimed_ledger
claimable_amount  = claimable_ledgers × rate_per_ledger
```

No special cliff-bonus code path exists; the catch-up emerges naturally from the formula because `last_claimed_ledger` was never advanced during the cliff period.

The same formula applies inside `cancel_stream`: if the cliff has passed, the recipient keeps all accrued tokens; if not, the sponsor receives a full refund.

## Consequences

- The first post-cliff claim delivers a larger-than-usual transfer (the lump-sum catch-up). Callers should be aware of this when sizing gas budgets for that transaction.
- The math is branchless for the normal claim path — no separate "cliff bonus" state.
- `cancel_stream` before the cliff always results in a zero recipient share; the pre-cliff period is entirely reversible for the sponsor.
