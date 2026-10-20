# ADR-0010: Permissionless Drain with 1-Year Delay

| Field    | Value                          |
|----------|--------------------------------|
| Status   | Accepted                       |
| Date     | 2026-09-29                     |
| Issue    | [#799](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/799), [#316](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/316) |
| Related  | [ADR-0001](0001-per-recipient-storage-key.md), [ADR-0005](0005-ttl-persistent-storage-strategy.md) |

## Context

When a vesting stream reaches `end_ledger` and the recipient never claims, the remaining tokens sit in the contract vault indefinitely. The `VestingSchedule` entry continues to occupy persistent storage, consuming Stellar state-rent budget.

There is no automatic expiry mechanism on Soroban persistent storage (TTL bump prevents expiry while the stream is active — see ADR-0005). Once `end_ledger` passes and the recipient has claimed everything, the schedule is deleted. However, if the recipient never claims at all, the schedule and the tokens remain in limbo.

Several cleanup strategies were considered:

| Strategy | Problem |
|----------|---------|
| Sponsor-only drain | Requires sponsor liveness. If the sponsor loses their key or is unresponsive, tokens are locked forever. |
| Admin drain | Introduces a privileged admin with the power to move tokens — trust assumption inconsistent with the no-admin-backdoor design principle. |
| Immediate permissionless drain (no delay) | Creates a race condition: a caller could drain tokens the day after `end_ledger` before the recipient has a chance to claim. |
| TTL eviction (let storage expire naturally) | Persistent storage TTL eviction removes the schedule entry but does **not** transfer tokens out of the contract vault. Tokens would be stranded without a transfer mechanism. |
| 1-year permissionless drain | Balances recipient protection (generous window to claim) with cleanup liveness (anyone can trigger). |

The 1-year delay constant is derived from the Stellar ledger close time assumption:

```
6,307,200 ledgers × 5 seconds/ledger = 31,536,000 seconds = 365 days
```

This constant is hardcoded to avoid it being subject to admin configuration (which would reintroduce a trust assumption).

## Decision

**Implement `drain_expired_stream` as a permissionless entry-point with a 1-year delay after `end_ledger`.**

- Any `Address` may call `drain_expired_stream(env, caller, recipient)`.
- No `require_auth` on the `caller` — no signature required.
- The function checks `env.ledger().sequence() >= schedule.end_ledger + 6_307_200`. If the condition is not met, it returns `DrainDelayNotExpired` (error code 10).
- If the condition is met, all remaining tokens in the vault are transferred to `schedule.sponsor` (not to the `caller`).
- A `StreamDrained` event is emitted with `recipient`, `sponsor`, and `amount`.
- The `VestingSchedule` entry is deleted from persistent storage.

The caller receives no tokens and no payment — they bear the transaction fee as a public-good contribution to contract hygiene.

## Consequences

**Positive**

- No privileged admin required for cleanup; consistent with the no-admin-backdoor design principle.
- Sponsors always recover unclaimed tokens; tokens cannot be permanently stranded in the vault.
- The 1-year grace period is generous enough to accommodate any recipient delays, key recovery scenarios, or legal holds.
- Permissionless caller means automated bots, infrastructure operators, or any community member can perform cleanup without special access.
- Emitting `StreamDrained` allows the off-chain indexer to mark streams as drained and remove them from active dashboards.

**Negative**

- Unclaimed tokens are not available to the sponsor for up to 1 year after `end_ledger`. Sponsors who want earlier recovery must cancel the stream while it is still active.
- The hardcoded 6,307,200-ledger constant assumes a 5-second average ledger close time. If Stellar's consensus speed changes significantly, the actual elapsed time could drift from ~1 year. This is an accepted approximation.
- Zero incentive for callers means automated cleanup may not happen promptly; however, the contract correctness does not depend on draining occurring.

**Neutral**

- `drain_expired_stream` cannot be called before `end_ledger` — the `StreamNotExpired` error (code 8) is returned if `end_ledger` has not been reached at all.
- The function is separate from `cancel_stream`; cancellation remains the standard path for active streams and does not have an auth-free variant.
