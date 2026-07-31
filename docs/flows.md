# Contract Flow Diagrams

## Lifecycle State Machine

The vesting stream lifecycle is modeled as a state machine that spans creation, cliff progression, claiming, cancellation, draining, and the documented pause/resume extension. The current contract implementation exposes the core states directly through the schedule storage and view functions; the pause/resume states are documented as a forward-compatible extension because the runtime contract does not yet implement dedicated pause entry-points.

### Mermaid state diagram

```mermaid
stateDiagram-v2
    [*] --> NotFound
    NotFound --> PreCliff: create_vesting_stream(valid params)

    PreCliff --> Active: current_ledger >= cliff_ledger
    PreCliff --> Paused: pause_stream (reserved/optional)
    PreCliff --> Cancelled: cancel_stream before cliff
    PreCliff --> Expired: storage entry expires or is lost

    Paused --> PreCliff: resume_stream while cliff not reached
    Paused --> Active: resume_stream after cliff is reached
    Paused --> Cancelled: cancel_stream while paused
    Paused --> Expired: storage entry expires or is lost

    Active --> Paused: pause_stream (reserved/optional)
    Active --> Drained: end_ledger reached or final claim exhausts the stream
    Active --> Cancelled: cancel_stream after cliff
    Active --> Expired: storage entry expires or is lost

    Cancelled --> NotFound: schedule removed from storage
    Drained --> NotFound: schedule removed from storage
    Expired --> NotFound: cleanup/recreate path
```

### State definitions

- NotFound
  - Entry conditions: no schedule exists for the recipient, either because it was never created or because a previous lifecycle ended and the storage entry was removed.
  - Allowed operations: create a new stream.
  - Exit conditions: successful creation transitions to PreCliff.

- PreCliff
  - Entry conditions: a stream exists and the current ledger is still before the cliff ledger.
  - Allowed operations: cancel the stream, inspect the schedule, and optionally pause/resume in a future extension.
  - Exit conditions: reaching the cliff moves the stream to Active; cancellation moves it to Cancelled; pause moves it to Paused; storage loss moves it to Expired.

- Active
  - Entry conditions: the cliff has been reached and the stream is still running before the end ledger.
  - Allowed operations: claim accrued tokens, cancel the stream, and optionally pause/resume in a future extension.
  - Exit conditions: the stream drains to Drained when the end ledger is reached or the final claim removes the schedule; cancellation moves it to Cancelled; pause moves it to Paused; storage loss moves it to Expired.

- Paused
  - Entry conditions: a pause/resume extension is enabled and the stream is temporarily halted.
  - Allowed operations: resume the stream, cancel it, and inspect status.
  - Exit conditions: resume transitions back to PreCliff or Active depending on whether the cliff is already passed; cancellation transitions to Cancelled; storage loss transitions to Expired.

- Expired
  - Entry conditions: the storage entry is no longer available because its TTL lapsed or the schedule was otherwise lost. In the current contract, this is an operational risk rather than a first-class entry-point.
  - Allowed operations: recreate the stream.
  - Exit conditions: a new creation transitions back to PreCliff.

- Cancelled
  - Entry conditions: the sponsor cancelled the stream before or after the cliff and the contract removed the schedule from storage.
  - Allowed operations: inspect historical state and create a new stream for the same recipient.
  - Exit conditions: a new creation transitions to PreCliff.

- Drained
  - Entry conditions: the stream reached its end ledger or the final claim consumed the remaining accrual and removed the schedule.
  - Allowed operations: inspect historical state and create a new stream for the same recipient.
  - Exit conditions: a new creation transitions to PreCliff.

### Transition table

| From | Action / condition | To | Notes |
|---|---|---|---|
| NotFound | create_vesting_stream with valid params | PreCliff | Stream is created and stored. |
| PreCliff | current_ledger >= cliff_ledger | Active | Cliff has been reached. |
| PreCliff | cancel_stream before cliff | Cancelled | Sponsor receives the full deposit refund. |
| PreCliff | pause_stream (future extension) | Paused | Optional pause/resume support. |
| PreCliff | storage entry expires | Expired | Operational edge case; schedule is no longer readable. |
| Paused | resume_stream and cliff not reached | PreCliff | Stream resumes before the cliff. |
| Paused | resume_stream and cliff reached | Active | Stream resumes after the cliff. |
| Paused | cancel_stream | Cancelled | Sponsor exits the paused stream. |
| Active | claim_vested until end_ledger reached | Drained | Final claim removes the schedule. |
| Active | cancel_stream after cliff | Cancelled | Recipient keeps accrued tokens; sponsor receives remainder. |
| Active | pause_stream (future extension) | Paused | Optional pause/resume support. |
| Active | storage entry expires | Expired | Operational edge case; schedule is no longer readable. |
| Cancelled | create_vesting_stream for same recipient | PreCliff | A new stream can be recreated. |
| Drained | create_vesting_stream for same recipient | PreCliff | A new stream can be recreated. |
| Expired | create_vesting_stream | PreCliff | Re-creating the stream restarts the lifecycle. |

### Invalid transitions and error mapping

| Error code | Error name | Invalid transition / trigger |
|---|---|---|
| 1 | ScheduleNotFound | `claim_vested` or `cancel_stream` executed when the stream is in NotFound, Cancelled, Drained, or Expired state. |
| 2 | CliffNotReached | `claim_vested` executed while the stream is still in PreCliff (or Paused before the cliff is reached). |
| 7 | NothingToClaim | `claim_vested` executed when the stream is Active or Paused but no additional accrual is available. |
| 6 | ScheduleAlreadyExists | `create_vesting_stream` attempted while a stream already exists in PreCliff, Active, Paused, or Cancelled/Drained history that still has an active schedule. |
| 3 | InvalidDuration | `create_vesting_stream` attempted with `total_duration <= cliff_duration`. |
| 4 | InvalidRate | `create_vesting_stream` attempted with a non-positive `rate`. |
| 5 | DepositOverflow | `create_vesting_stream` attempted with arithmetic overflow while computing the deposit. |

## 1. Stream Creation

```mermaid
sequenceDiagram
    actor Sponsor
    participant Contract
    participant Token

    Sponsor->>Contract: create_vesting_stream(sponsor, recipient, token, rate, cliff_duration, total_duration)
    Contract->>Contract: require_auth(sponsor)
    Contract->>Contract: validate params (rate > 0, total_duration > cliff_duration)
    Contract->>Contract: compute deposit = rate × total_duration
    Contract->>Token: transfer(sponsor → contract, deposit)
    Contract->>Contract: store VestingSchedule for recipient
    Contract-->>Sponsor: Ok(())
```

## 2. Claim After Cliff

```mermaid
sequenceDiagram
    actor Recipient
    participant Contract
    participant Token

    Recipient->>Contract: claim_vested(recipient)
    Contract->>Contract: require_auth(recipient)
    Contract->>Contract: load VestingSchedule
    Contract->>Contract: assert current_ledger ≥ cliff_ledger
    Contract->>Contract: compute claimable = rate × (current_ledger − last_claimed_ledger)
    Contract->>Token: transfer(contract → recipient, claimable)
    Contract->>Contract: update last_claimed_ledger
    Contract-->>Recipient: Ok(claimable)
```

## 3. Cancel Before Cliff

```mermaid
sequenceDiagram
    actor Sponsor
    actor Recipient
    participant Contract
    participant Token

    Sponsor->>Contract: cancel_stream(sponsor, recipient)
    Contract->>Contract: require_auth(sponsor)
    Contract->>Contract: load VestingSchedule
    Contract->>Contract: assert current_ledger < cliff_ledger
    Contract->>Token: transfer(contract → sponsor, full deposit)
    Contract->>Contract: delete VestingSchedule
    Contract-->>Sponsor: Ok(())
    Note over Recipient: Receives nothing (cliff not reached)
```

## 4. Cancel After Cliff

```mermaid
sequenceDiagram
    actor Sponsor
    actor Recipient
    participant Contract
    participant Token

    Sponsor->>Contract: cancel_stream(sponsor, recipient)
    Contract->>Contract: require_auth(sponsor)
    Contract->>Contract: load VestingSchedule
    Contract->>Contract: assert current_ledger ≥ cliff_ledger
    Contract->>Contract: compute accrued = rate × (current_ledger − last_claimed_ledger)
    Contract->>Token: transfer(contract → recipient, accrued)
    Contract->>Contract: compute remainder = deposit − accrued
    Contract->>Token: transfer(contract → sponsor, remainder)
    Contract->>Contract: delete VestingSchedule
    Contract-->>Sponsor: Ok(())
```
