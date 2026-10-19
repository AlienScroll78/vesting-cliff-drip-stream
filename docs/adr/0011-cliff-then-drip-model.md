# ADR-0011: Cliff-Then-Drip Vesting Model

- **Status**: Accepted
- **Date**: 2026-10-19

## Context

A vesting contract for long-term contributor retention must answer two foundational design questions:

1. **When do tokens start accruing?** — at stream creation, or only after some commitment gate?
2. **What happens to value that accrued during the lock period?** — is it forfeited, released all at once, or dripped forward?

Standard Drips streams release tokens linearly from the moment the stream is created. There is no lock period; a contributor can claim on day one. This is fine for advisor stipends or continuous service agreements, but is insufficient for equity-style grants where the sponsor wants to ensure a minimum commitment before any value is unlocked.

Several vesting models were evaluated:

| Model | Description |
|---|---|
| **Pure cliff (all-or-nothing)** | 100% of tokens unlock at a single future ledger; nothing before or after. |
| **Cliff-then-drip (this contract)** | Tokens accrue linearly from `start_ledger`; the cliff gates _withdrawal_. After the cliff, accrued tokens are released in a catch-up lump sum, then tokens continue to drip linearly until `end_ledger`. |
| **Monthly milestones** | Tokens unlock at fixed intervals (e.g., every 30 days). Each milestone releases a discrete tranche. |
| **Exponential drip** | Release rate accelerates over time, front-loading early accrual or back-loading it toward the end of the vesting period. |
| **Pure linear (no cliff)** | Tokens drip linearly from creation with no lock period (standard Drips behaviour). |

The contract is built on Soroban (Stellar), which imposes constraints relevant to the choice:

- Ledger sequence numbers (not wall-clock time) are the only trustless time primitive available on-chain. Any model must be expressible in ledger-counted intervals.
- `i128` integer arithmetic is used for all token amounts; fractional tokens are not representable unless the token's own decimal factor is used.
- Storage is persistent but carries a TTL; state machines with many time-checkpoints increase both storage cost and bug surface area.
- There is no on-chain scheduler or callback; all state transitions happen as a result of an explicit contract call.

### Why pure cliff was rejected

A pure cliff releases 100% of the allocation at a single ledger. This satisfies the "no early exit" requirement but is binary — there is no mechanism for a contributor who leaves after the cliff to receive a fair share of what they earned post-cliff. It also creates a cliff-spike liquidity event that may be undesirable for token economies that want predictable circulating supply.

### Why monthly milestones were rejected

Milestone schedules require the contract to store a list of unlock events and iterate over them on every claim. On Soroban, iteration over a stored `Vec` costs CPU proportional to the number of milestones, and each new milestone is an additional XDR-encoded field. A separate [`MilestoneSchedule`](../../src/types.rs) struct exists for this use case, but it is architecturally distinct from the core cliff-then-drip flow and is not the default model.

The milestone model also requires the contract to know all unlock dates at creation time, which is inflexible for agreements where the total duration is known but intermediate milestones are not yet decided.

### Why exponential drip was rejected

Exponential curves require either a lookup table (fixed-size, discretised) or a power function computed at every claim. Soroban does not provide a native exponentiation instruction; an approximation in integer arithmetic is either imprecise or requires many multiplications, increasing CPU cost. The resulting formula is also harder to audit and verify than a simple linear product.

From a contributor perspective, an exponential curve that back-loads rewards incentivises short-tenured contributors to stay only until the curve's inflection point, then leave — the opposite of the intended retention effect.

## Decision

Implement the **cliff-then-drip** model. Tokens accrue linearly from `start_ledger` at `rate_per_ledger` tokens per ledger. The cliff (`cliff_ledger`) gates _withdrawal_, not accrual. The first successful `claim_vested` call after `cliff_ledger` releases all tokens that have accrued since `start_ledger` in a single catch-up transfer, then tokens continue to drip linearly until `end_ledger`.

### Catch-up semantics vs cliff-unlock-only semantics

Two sub-variants exist once a cliff-gated model is chosen:

- **Cliff-unlock-only**: only the tokens notionally unlocked _at_ the cliff ledger are released on first claim (i.e., one ledger's worth). Tokens accrued between `start_ledger` and `cliff_ledger` are forfeited.
- **Catch-up (this contract)**: `last_claimed_ledger` is initialised to `start_ledger`, not `cliff_ledger`. The cliff blocks withdrawal but does not block accrual. On first claim, all ledgers from `start_ledger` are counted.

The catch-up model was chosen because:

1. **No value is lost by simply waiting.** A contributor who respects the lock period is not penalised; the full cliff period's worth of tokens is waiting for them on day one of eligibility.
2. **Alignment with equity vesting norms.** Standard four-year cliff equity grants (e.g., one-year cliff with monthly vesting thereafter) release all accrued equity at the cliff date, then continue monthly. This contract mirrors that semantics for on-chain grants.
3. **Simpler state machine.** No separate "cliff bonus" code path is needed. The formula below produces the catch-up naturally from a single calculation because `last_claimed_ledger` was never advanced during the lock period.

### Mathematical model

All quantities are integers. `ledger` is the current Soroban ledger sequence number.

**After cliff is reached (`ledger ≥ cliff_ledger`):**

```
active_end       = min(ledger, end_ledger)
claimable_ledgers = active_end − last_claimed_ledger
claimable_amount  = claimable_ledgers × rate_per_ledger
```

On first claim after cliff, `last_claimed_ledger = start_ledger`, so the full cliff period is included in `claimable_ledgers`.

**At or after `end_ledger` (dust collection):**

To prevent sub-`rate_per_ledger` dust from being permanently locked in the vault:

```
claimable_amount = total_deposited − claimed_amount
```

where `total_deposited = (end_ledger − start_ledger) × rate_per_ledger`.

This guarantees that the sum of all claim amounts exactly equals the total deposit, with no rounding remainder locked in the contract.

**Before cliff (`ledger < cliff_ledger`):**

Returns `VestingError::CliffNotReached` (code 2). No tokens are released. The view function `claimable_amount` returns `0`.

**Invariants:**

- `start_ledger < cliff_ledger < end_ledger` — enforced at creation by `VestingError::InvalidDuration` (code 3).
- `rate_per_ledger > 0` — enforced by `VestingError::InvalidRate` (code 4).
- `rate_per_ledger × total_duration ≤ i128::MAX` — checked via `checked_mul`; overflow returns `VestingError::DepositOverflow` (code 5).
- `claimable_amount ≤ total_deposited − previously_claimed` — the dust-collection branch enforces this ceiling.

**Cancel before cliff:**

The entire deposit is refunded to the sponsor. The recipient receives zero. This is consistent with the model: no tokens have been _withdrawn_, so the sponsor can reclaim the full allocation.

**Cancel after cliff:**

The recipient keeps all tokens accrued up to `min(current_ledger, end_ledger)`. The sponsor receives the remainder. This is enforced by the same formula used in `claim_vested`.

### Comparison with standard Drips

For a detailed feature comparison and migration guide, see [`docs/comparison.md`](../comparison.md).

Key differences:

| Property | Standard Drips | This contract |
|---|---|---|
| First claimable ledger | Stream creation | `cliff_ledger` |
| Accrual start | Stream creation | Stream creation (ledger-counted; cliff gates withdrawal) |
| First-claim amount | One period's worth | All accrued since `start_ledger` (catch-up lump sum) |
| Cancel before cliff | Proportional split | 100% to sponsor |
| Cancel after cliff | Proportional split | Recipient keeps earned; sponsor gets remainder |

## Consequences

- The first post-cliff claim delivers a lump-sum catch-up that is larger than any subsequent single-claim amount. Front-end wallets and gas estimators should account for the larger transfer on the first claim.
- `cancel_stream` before the cliff is fully reversible for the sponsor. The pre-cliff period functions as an option on the sponsor's side — if the contributor leaves early, the sponsor recovers everything.
- `cancel_stream` after the cliff is partially reversible: the sponsor recovers the unearned portion, but the cliff catch-up and any post-cliff drip amounts the recipient has claimed cannot be recalled (except via `clawback_stream` for compliance reasons with SAC-clawback-enabled tokens).
- The branchless single formula for accrual simplifies audits: there is no separate "cliff bonus" accumulator, no additional event for the cliff release, and no state flag tracking whether the first claim has been made.
- Off-chain indexers must be aware that `StreamCreated` and the first `TokensClaimed` event after the cliff will show a gap in ledger coverage (the lock period) with a large claim amount, which is expected behaviour and not a bug.
