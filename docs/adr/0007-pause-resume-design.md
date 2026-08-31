# ADR-0007: Pause/Resume Design

- **Status**: Proposed
- **Date**: 2026-08-29

## Context

Long-term contributor relationships sometimes require the ability to temporarily
halt a vesting stream without destroying it. Scenarios include:

- A contributor takes an approved leave of absence; the sponsor wants to stop
  accrual without losing the stream configuration or forfeiting the deposited
  tokens.
- A compliance hold is placed pending review; the stream must be frozen but not
  cancelled, so that it can be reinstated if the hold is lifted.
- A dispute arises; both parties agree to pause while negotiating rather than
  trigger an irreversible cancel/clawback.

`cancel_stream` is a one-way exit: tokens are redistributed and the schedule is
deleted. It cannot serve as a temporary pause. `clawback_stream` is a compliance
tool that returns all remaining tokens to the sponsor and is equally destructive.
Neither satisfies the requirement for a reversible, sponsor-controlled suspension
that preserves the recipient's future entitlements.

The feature therefore requires a first-class pause/resume mechanism in the
`VestingSchedule` struct and two new contract entry points.

## Decision

The contract stores pause state directly in `VestingSchedule` using two new
fields:

```rust
pub paused_at_ledger: Option<u32>,
pub accumulated_pause_ledgers: u32,
```

**`paused_at_ledger`** is `None` while the stream is running and `Some(ledger)`
the moment `pause_stream` is called. Its presence is the canonical signal that
the stream is paused; no separate boolean flag is needed.

**`accumulated_pause_ledgers`** is a running total of all ledgers the stream has
spent paused across potentially multiple pause/resume cycles. It is informational
and available to off-chain indexers for audit purposes; it does not participate in
the accrual formula directly.

### `pause_stream`

```rust
pub fn pause_stream(env, sponsor, recipient) -> Result<(), VestingError>
```

- Requires `sponsor.require_auth()`.
- Verifies `schedule.sponsor == sponsor` (only the original funder can pause).
- Returns `StreamAlreadyPaused` if `paused_at_ledger.is_some()`.
- Sets `paused_at_ledger = Some(env.ledger().sequence())`.
- Emits `StreamPaused { recipient, sponsor, ledger }`.

### `resume_stream`

```rust
pub fn resume_stream(env, sponsor, recipient) -> Result<(), VestingError>
```

- Requires `sponsor.require_auth()`.
- Returns `StreamNotPaused` if `paused_at_ledger.is_none()`.
- Computes `paused_duration = current_ledger − paused_at_ledger`.
- Shifts `cliff_ledger += paused_duration` and `end_ledger += paused_duration`.
- Adds `paused_duration` to `accumulated_pause_ledgers`.
- Clears `paused_at_ledger = None`.
- Emits `StreamResumed { recipient, sponsor, new_end_ledger }`.

### Accrual during a pause

No tokens accrue while `paused_at_ledger.is_some()`. This is enforced in two
places:

1. `claim_vested` returns `NothingToClaim` immediately when the stream is paused,
   without computing an amount. Accrual picks up from the correct
   `last_claimed_ledger` after resume because the timeline has been shifted
   forward to exclude the pause window.
2. `claimable_amount` returns `0` when the stream is paused, keeping the view
   consistent with the guard in the mutating path.

The end-to-end timeline after a pause/resume cycle:

```
Original:  start────cliff──────────────────────end
Pause at P, resume at R (duration = R - P):
Adjusted:  start────cliff+(R-P)──────────────────────end+(R-P)
```

Accrual is uninterrupted from the recipient's perspective: the same total
number of tokens vest over the same number of active ledgers; the calendar
simply shifts forward.

## Alternatives Considered

### Alternative A: Freeze rate to zero, preserve end_ledger

Set `rate_per_ledger = 0` on pause and restore it on resume. `end_ledger` is
not changed.

**Why rejected**: The total deposit computed at creation (`rate × total_duration`)
no longer equals the actual tokens held in the vault once the rate is modified.
Any view that derives totals from the stored rate would return incorrect figures.
Restoring the original rate on resume requires storing a second field (the
pre-pause rate), adding complexity. It also silently erodes the recipient's
entitlement: a 30-day pause with a fixed `end_ledger` means 30 days of tokens
are never accrued and remain locked in the vault indefinitely, creating a dust
problem.

### Alternative B: Adjust end_ledger only, no paused_at_ledger field

Instead of storing `paused_at_ledger`, compute the shifted end on a separate
admin call that takes an explicit `extend_by` argument. The sponsor would
manually measure the pause duration and pass it in.

**Why rejected**: Puts the burden of measuring the pause duration on the caller,
introducing off-by-one risk at the ledger boundary. The contract has no way to
verify the supplied duration against the actual pause window, opening a griefing
vector where a sponsor could extend the stream beyond the intended duration under
the guise of a resume. Storing `paused_at_ledger` makes the pause duration
trustlessly verifiable from on-chain state.

### Alternative C: Separate paused balance accumulator

Maintain an `accrued_before_pause: i128` field. When pausing, compute and snapshot
the accrued-but-unclaimed amount. On claim, pay out the snapshot plus anything
accrued since resume.

**Why rejected**: Introduces a second accrual value that must stay in sync with
`last_claimed_ledger`. The existing claim formula
(`(active_end − last_claimed_ledger) × rate`) already handles arbitrary start
points; snapshotting a balance is redundant. The snapshot would also need to be
updated on every intermediate claim between pause events, making the state
machine more complex and the storage footprint larger. The `paused_at_ledger`
approach achieves the same correctness by shifting the timeline rather than
accumulating balances.

### Alternative D: Emit a synthetic last_claimed_ledger update on pause

On pause, advance `last_claimed_ledger` to the pause ledger and emit a zero-value
claim event to signal that accrual has stopped. This converts paused time into
"already claimed at zero" time, so the formula automatically skips it.

**Why rejected**: A zero-value claim event is semantically misleading and would
corrupt `total_claimed` accounting or require special-casing. It also makes the
pause state implicit (it can only be inferred from the gap between
`last_claimed_ledger` and the current ledger), preventing the contract from
distinguishing a pause from a recipient who simply hasn't claimed yet.

## Consequences

### Storage

`VestingSchedule` grows by two fields: `Option<u32>` (5 bytes in XDR) and `u32`
(4 bytes). Per-stream storage cost increases by roughly 9 bytes. At Soroban's
current fee schedule this is negligible. XDR forward-compatibility is maintained
because `Option` fields missing from old entries decode as `None` and `u32` fields
decode as `0`, matching the "not paused, no accumulated pause" initial state.

### TTL implications

`pause_stream` and `resume_stream` both call `storage::set_schedule`, which
invokes `ensure_ttl` (see ADR-0005). A paused stream therefore refreshes its TTL
on every pause/resume call, keeping it alive with no separate keeper needed.
However, a stream that is paused and then never resumed will have its TTL
refreshed only if someone queries or interacts with it. Sponsors should be aware
that a paused, abandoned stream could eventually expire if it is never touched
again — the same TTL risk that exists for any inactive stream.

### Event semantics

Two new events are introduced:

| Event | Topics | Data |
|---|---|---|
| `StreamPaused` | `("vc_pause", recipient)` | `(sponsor, paused_at_ledger)` |
| `StreamResumed` | `("vc_resume", recipient)` | `(sponsor, new_end_ledger)` |

Off-chain indexers must handle the shifted `end_ledger` on `StreamResumed`: any
cached deadline or "time remaining" calculation becomes stale at resume and must
be recomputed from the on-chain schedule. The `accumulated_pause_ledgers` field
on the schedule provides a complete audit trail of total pause time without
requiring indexers to replay all pause/resume events.

### Interaction with cancel and clawback

`cancel_stream` respects `paused_at_ledger` naturally: if the cliff has passed,
the accrued amount is computed from `last_claimed_ledger` to
`min(current_ledger, end_ledger)`, which is correct whether or not the stream is
paused (a paused stream simply has no new ledgers accruing). No special branch is
needed. Similarly, `clawback_stream` and `drain_expired_stream` are unaffected
because they operate on the vault balance rather than the accrual formula.

### Authorization boundary

Only the original sponsor can pause and resume. This is consistent with
`cancel_stream`'s authorization model. The recipient has no mechanism to force a
resume — a design choice that prioritizes the sponsor's administrative authority.
Future work could add a `recipient_dispute_pause` path, but that is out of scope
for this feature.

### New error codes

| Code | Name | Meaning |
|---|---|---|
| TBD | `StreamAlreadyPaused` | `pause_stream` called on a stream that is already paused |
| TBD | `StreamNotPaused` | `resume_stream` called on a stream that is not paused |

Error code numbers must be assigned during implementation, following the
sequential scheme established in ADR-0004.
