# Event Schema

Complete schema for every contract event, with topic discriminators, field
names and types, XDR encoding, and JSON examples for indexers.

## StreamCreated

Emitted when a sponsor creates a new vesting stream via
`create_vesting_stream`.

| Field | Type | XDR Type | Description |
|---|---|---|---|
| sponsor | Address | ScAddress | Stream sponsor (topic) |
| recipient | Address | ScAddress | Stream recipient (topic) |
| token | Address | ScAddress | SAC token being vested |
| rate | i128 | ScVal I128 | Tokens released per ledger |
| start_ledger | u32 | ScVal U32 | Ledger at which vesting starts |
| cliff_ledger | u32 | ScVal U32 | Ledger at which cliff passes |
| end_ledger | u32 | ScVal U32 | Ledger at which stream ends |
| total_deposit | i128 | ScVal I128 | Total tokens deposited upfront |

Topic discriminator: `StreamCreated` (Symbol). Topics: `[StreamCreated, sponsor, recipient]`.

XDR binary: Soroban event topics are encoded as `ScVec[ScSymbol("StreamCreated"), ScAddress(sponsor), ScAddress(recipient)]`. Data is a `ScMap` of the `StreamCreatedData` struct fields.

Example JSON payload:

```json
{
  "event": "StreamCreated",
  "topics": ["StreamCreated", "GDSPONSOR...", "GDRECIP..."],
  "data": {
    "token": "CDTOKEN...",
    "rate": "10",
    "start_ledger": 100,
    "cliff_ledger": 150,
    "end_ledger": 300,
    "total_deposit": "2000"
  }
}
```

Terminal: yes, emitted once per stream (at creation).

## TokensClaimed

Emitted when a recipient successfully claims vested tokens via `claim_vested`.

| Field | Type | XDR Type | Description |
|---|---|---|---|
| recipient | Address | ScAddress | Claiming recipient (topic) |
| amount | i128 | ScVal I128 | Tokens transferred in this claim |
| ledger_claimed_through | u32 | ScVal U32 | Ledger up to which tokens were claimed |

Topic discriminator: `vc_claim` (symbol_short). Topics: `[vc_claim, recipient]`.

Example JSON payload:

```json
{
  "event": "TokensClaimed",
  "topics": ["vc_claim", "GDRECIP..."],
  "data": {
    "amount": "500",
    "ledger_claimed_through": 200
  }
}
```

Terminal: no, repeatable on every successful claim until the stream is exhausted.

## StreamCancelled

Emitted when a sponsor cancels a stream via `cancel_stream`.

| Field | Type | XDR Type | Description |
|---|---|---|---|
| recipient | Address | ScAddress | Cancelled stream recipient (topic) |
| sponsor_refund | i128 | ScVal I128 | Unvested tokens refunded to sponsor |

Topic discriminator: `vc_cancel` (symbol_short). Topics: `[vc_cancel, recipient]`.

Example JSON payload:

```json
{
  "event": "StreamCancelled",
  "topics": ["vc_cancel", "GDRECIP..."],
  "data": {
    "sponsor_refund": "1000"
  }
}
```

Terminal: yes, a cancelled stream cannot be claimed or resumed.

## StreamClawedBack

Emitted when a sponsor performs a compliance clawback.

| Field | Type | XDR Type | Description |
|---|---|---|---|
| recipient | Address | ScAddress | Stream recipient (topic) |
| sponsor | Address | ScAddress | Sponsor performing the clawback |
| token | Address | ScAddress | SAC token (must support clawback flag) |
| amount | i128 | ScVal I128 | Tokens recovered by sponsor |
| reason | String | ScVal String | Compliance reason |

Topic discriminator: `vc_claw` (symbol_short). Topics: `[vc_claw, recipient]`.

Example JSON payload:

```json
{
  "event": "StreamClawedBack",
  "topics": ["vc_claw", "GDRECIP..."],
  "data": {
    "sponsor": "GDSPONSOR...",
    "token": "CDTOKEN...",
    "amount": "1500",
    "reason": "regulatory-action"
  }
}
```

Terminal: yes, a clawed-back stream is closed.

## StreamDrained

Emitted when an expired stream is drained.

| Field | Type | XDR Type | Description |
|---|---|---|---|
| recipient | Address | ScAddress | Stream recipient (topic) |
| caller | Address | ScAddress | Address that triggered the drain |
| sponsor | Address | ScAddress | Original stream sponsor |
| token | Address | ScAddress | SAC token |
| amount | i128 | ScVal I128 | Dust swept from the expired stream |

Topic discriminator: `vc_drain` (symbol_short). Topics: `[vc_drain, recipient]`.

Example JSON payload:

```json
{
  "event": "StreamDrained",
  "topics": ["vc_drain", "GDRECIP..."],
  "data": {
    "caller": "GDADMIN...",
    "sponsor": "GDSPONSOR...",
    "token": "CDTOKEN...",
    "amount": "3"
  }
}
```

Terminal: yes, drains only an already-expired stream.

## StreamPaused

Emitted when a sponsor pauses a stream via `pause_stream`.

| Field | Type | XDR Type | Description |
|---|---|---|---|
| recipient | Address | ScAddress | Paused stream recipient (topic) |
| sponsor | Address | ScAddress | Sponsor that paused the stream |
| paused_at_ledger | u32 | ScVal U32 | Ledger at which the stream paused |

Example JSON payload:

```json
{
  "event": "StreamPaused",
  "topics": ["StreamPaused", "GDRECIP..."],
  "data": {
    "sponsor": "GDSPONSOR...",
    "paused_at_ledger": 180
  }
}
```

Terminal: no, the stream can be resumed with `resume_stream`.

## StreamResumed

Emitted when a sponsor resumes a paused stream via `resume_stream`.

| Field | Type | XDR Type | Description |
|---|---|---|---|
| recipient | Address | ScAddress | Resumed stream recipient (topic) |
| sponsor | Address | ScAddress | Sponsor that resumed the stream |
| end_ledger | u32 | ScVal U32 | Adjusted end ledger after pause |

Example JSON payload:

```json
{
  "event": "StreamResumed",
  "topics": ["StreamResumed", "GDRECIP..."],
  "data": {
    "sponsor": "GDSPONSOR...",
    "end_ledger": 320
  }
}
```

Terminal: no, a stream can be paused and resumed repeatedly.

## MinDepositUpdated

Emitted when the admin updates the minimum deposit via `set_min_deposit`.

| Field | Type | XDR Type | Description |
|---|---|---|---|
| admin | Address | ScAddress | Admin that updated the threshold (topic) |
| min_deposit | i128 | ScVal I128 | New minimum total deposit |

Example JSON payload:

```json
{
  "event": "MinDepositUpdated",
  "topics": ["MinDepositUpdated", "GDADMIN..."],
  "data": {
    "min_deposit": "100"
  }
}
```

Terminal: no, the threshold can be updated any number of times.

## Terminal vs repeatable events

- Terminal (emitted at most once per stream): `StreamCreated`,
  `StreamCancelled`, `StreamClawedBack`, `StreamDrained`.
- Repeatable: `TokensClaimed`, `StreamPaused`, `StreamResumed`,
  `MinDepositUpdated`.

## Indexer implementation notes

- Filter events by contract address and event topic. With Soroban RPC,
  use `getEvents` with `filters: [{ contractIds: ["<CONTRACT_ID>"],
  topics: [["StreamCreated"]] }]` to capture new streams.
- Use `vc_cancel`, `vc_claw`, `vc_drain` topic filters to detect terminal
  state transitions without replaying every claim.
- Page with `cursor` and persist it per contract so re-indexing resumes
  without gaps.

## Storage costs and TTL

- Emitted events are retained by the network's event store, not by the
  contract's own storage, so they do not consume contract rent.
- The contract's on-chain schedule entries live in persistent storage and
  have a TTL that is extended (~60 days) on every read and write, keeping
  active streams alive while expired streams are eventually evicted.