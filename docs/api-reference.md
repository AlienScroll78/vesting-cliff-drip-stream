# API Reference — VestingDrips Contract

Contract ID is referred to as `$VESTING_CONTRACT` throughout the CLI examples.
All amounts are in the token's smallest unit (stroops for XLM-based SAC tokens).
Ledger sequences are `u32` values from `env.ledger().sequence()`.

---

## Table of Contents

- [Mutating Functions](#mutating-functions)
  - [create_vesting_stream](#create_vesting_stream)
  - [claim_vested](#claim_vested)
  - [cancel_stream](#cancel_stream)
- [View Functions](#view-functions)
  - [get_schedule](#get_schedule)
  - [claimable_amount](#claimable_amount)
  - [is_cliff_passed](#is_cliff_passed)
  - [get_status](#get_status)
- [Types](#types)
  - [VestingSchedule](#vestingschedule)
  - [StreamStatus](#streamstatus)
- [Error Codes](#error-codes)
- [Events](#events)

---

## Mutating Functions

### `create_vesting_stream`

Creates a new cliff-vesting stream. The sponsor transfers the full token deposit (`rate × total_duration`) into the contract vault at creation time.

**Auth required:** `sponsor`

```rust
pub fn create_vesting_stream(
    env: Env,
    sponsor: Address,       // funder; must authorise and hold sufficient tokens
    recipient: Address,     // beneficiary
    token: Address,         // SAC-compatible token contract
    rate: i128,             // tokens per ledger; must be > 0
    cliff_duration: u32,    // ledgers from now until cliff
    total_duration: u32,    // total stream length in ledgers; must be > cliff_duration
) -> Result<(), VestingError>
```

**Derived values stored:**

| Field | Computed as |
|---|---|
| `start_ledger` | `env.ledger().sequence()` at call time |
| `cliff_ledger` | `start_ledger + cliff_duration` |
| `end_ledger` | `start_ledger + total_duration` |
| `total_deposit` | `rate × total_duration` |

**Errors:**

| Code | Name | Condition |
|---|---|---|
| 4 | `InvalidRate` | `rate ≤ 0` |
| 3 | `InvalidDuration` | `total_duration ≤ cliff_duration` |
| 5 | `DepositOverflow` | `rate × total_duration` overflows `i128`, or ledger addition overflows `u32` |
| 6 | `ScheduleAlreadyExists` | A stream already exists for `recipient` |

**CLI example:**

```bash
stellar contract invoke \
  --id "$VESTING_CONTRACT" \
  --source "$SPONSOR" \
  --network testnet \
  -- \
  create_vesting_stream \
  --sponsor  "$SPONSOR" \
  --recipient "$RECIPIENT" \
  --token    "$TOKEN" \
  --rate     10 \
  --cliff_duration  17280 \
  --total_duration  172800
```

Or use the provided helper:

```bash
export VESTING_CONTRACT=<contract-id>
export SPONSOR=default          # stellar key name
export RECIPIENT=G...
export TOKEN=C...
export RATE=10
export CLIFF_DURATION=17280     # ~1 day  (5 s/ledger)
export TOTAL_DURATION=172800    # ~10 days

./scripts/invoke_create.sh
```

---

### `claim_vested`

Claims all tokens accrued since the last claim (or since `start_ledger` on the first claim after the cliff). The cliff produces an instant "catch-up" payout covering every ledger from `start_ledger` to now.

**Auth required:** `recipient`

```rust
pub fn claim_vested(
    env: Env,
    recipient: Address,
) -> Result<i128, VestingError>
```

**Returns:** `i128` — amount transferred to `recipient`.

**Claim calculation:**

```
active_end      = min(current_ledger, end_ledger)
claimable       = (active_end − last_claimed_ledger) × rate_per_ledger
```

After a successful claim `last_claimed_ledger` is updated to `active_end`. When `active_end == end_ledger` the schedule is removed from storage and a `vc_done` event is emitted.

**Errors:**

| Code | Name | Condition |
|---|---|---|
| 1 | `ScheduleNotFound` | No active schedule for `recipient` |
| 2 | `CliffNotReached` | `current_ledger < cliff_ledger` |
| 7 | `NothingToClaim` | Computed claimable amount is 0 |

**CLI example:**

```bash
stellar contract invoke \
  --id "$VESTING_CONTRACT" \
  --source "$RECIPIENT" \
  --network testnet \
  -- \
  claim_vested \
  --recipient "$RECIPIENT"
```

Or use the provided helper:

```bash
export VESTING_CONTRACT=<contract-id>
export RECIPIENT=<key-name-or-address>

./scripts/invoke_claim.sh
```

---

### `cancel_stream`

Cancels an active stream. Token distribution depends on whether the cliff has been reached:

- **Cliff passed:** recipient receives all accrued-but-unclaimed tokens; sponsor is refunded the remainder.
- **Cliff not passed:** sponsor receives the full remaining deposit; recipient receives nothing.

The schedule is removed from storage in both cases.

**Auth required:** `sponsor`

```rust
pub fn cancel_stream(
    env: Env,
    sponsor: Address,
    recipient: Address,
) -> Result<(), VestingError>
```

**Returns:** `()` on success.

**Payout logic:**

```
# Cliff passed
active_end       = min(current_ledger, end_ledger)
recipient_share  = (active_end − last_claimed_ledger) × rate_per_ledger
sponsor_refund   = (end_ledger − active_end)          × rate_per_ledger

# Cliff NOT passed
recipient_share  = 0
sponsor_refund   = (end_ledger − last_claimed_ledger) × rate_per_ledger
```

**Errors:**

| Code | Name | Condition |
|---|---|---|
| 1 | `ScheduleNotFound` | No active schedule for `recipient` |

**CLI example:**

```bash
stellar contract invoke \
  --id "$VESTING_CONTRACT" \
  --source "$SPONSOR" \
  --network testnet \
  -- \
  cancel_stream \
  --sponsor   "$SPONSOR" \
  --recipient "$RECIPIENT"
```

---

## View Functions

View functions do not require auth, do not modify state, and return `0` / `false` / `None` when no schedule exists rather than erroring.

### `get_schedule`

Returns the full vesting schedule for `recipient`.

```rust
pub fn get_schedule(env: Env, recipient: Address) -> Option<VestingSchedule>
```

**Returns:** `Some(VestingSchedule)` or `None` if no schedule exists.

**CLI example:**

```bash
stellar contract invoke \
  --id "$VESTING_CONTRACT" \
  --network testnet \
  -- \
  get_schedule \
  --recipient "$RECIPIENT"
```

---

### `claimable_amount`

Returns the number of tokens currently claimable. Returns `0` if the cliff has not been reached or no schedule exists.

```rust
pub fn claimable_amount(env: Env, recipient: Address) -> i128
```

**Returns:** `i128` ≥ 0.

**CLI example:**

```bash
stellar contract invoke \
  --id "$VESTING_CONTRACT" \
  --network testnet \
  -- \
  claimable_amount \
  --recipient "$RECIPIENT"
```

---

### `is_cliff_passed`

Returns whether the cliff ledger has been reached.

```rust
pub fn is_cliff_passed(env: Env, recipient: Address) -> bool
```

**Returns:** `true` if `current_ledger ≥ cliff_ledger`, `false` otherwise (including when no schedule exists).

**CLI example:**

```bash
stellar contract invoke \
  --id "$VESTING_CONTRACT" \
  --network testnet \
  -- \
  is_cliff_passed \
  --recipient "$RECIPIENT"
```

---

### `get_status`

Returns the lifecycle status of the stream.

```rust
pub fn get_status(env: Env, recipient: Address) -> Option<StreamStatus>
```

**Returns:** `Some(StreamStatus)` or `None` when no schedule exists.

| Return value | Meaning |
|---|---|
| `Some(PreCliff)` | Stream exists; cliff not yet reached |
| `Some(Active)` | Cliff passed; tokens dripping until `end_ledger` |
| `Some(Completed)` | `end_ledger` reached; all tokens vested |
| `None` | No schedule (never created, cancelled, or completed and removed) |

**CLI example:**

```bash
stellar contract invoke \
  --id "$VESTING_CONTRACT" \
  --network testnet \
  -- \
  get_status \
  --recipient "$RECIPIENT"
```

---

## Types

### `VestingSchedule`

XDR type: `SCVal::Map` (Soroban `contracttype`). Stored in persistent contract storage keyed by `DataKey::Schedule(recipient)`.

```rust
#[contracttype]
pub struct VestingSchedule {
    pub token:               Address,  // SAC token contract
    pub rate_per_ledger:     i128,     // tokens released per ledger
    pub start_ledger:        u32,      // ledger at stream creation
    pub cliff_ledger:        u32,      // ledger where cliff is reached
    pub end_ledger:          u32,      // ledger where stream ends
    pub last_claimed_ledger: u32,      // last ledger through which tokens were claimed
                                       // (initialised to start_ledger)
}
```

**XDR field encoding:**

| Field | XDR type |
|---|---|
| `token` | `SCVal::Address` |
| `rate_per_ledger` | `SCVal::I128` |
| `start_ledger` | `SCVal::U32` |
| `cliff_ledger` | `SCVal::U32` |
| `end_ledger` | `SCVal::U32` |
| `last_claimed_ledger` | `SCVal::U32` |

---

### `StreamStatus`

XDR type: `SCVal::Vec` (Soroban enum contracttype).

```rust
#[contracttype]
pub enum StreamStatus {
    PreCliff,   // 0 — cliff not yet reached
    Active,     // 1 — cliff passed, stream dripping
    Completed,  // 2 — end_ledger reached
    Cancelled,  // 3 — sponsor cancelled (schedule removed from storage)
}
```

> `Cancelled` is never returned by `get_status` at runtime because the schedule is deleted on cancellation, causing `get_status` to return `None`. The variant exists for use by off-chain indexers reconstructing state from events.

---

## Error Codes

All errors are returned as `u32` in the XDR `ScError::Contract` envelope.

| Code | Name | Returned by | Meaning |
|---|---|---|---|
| 1 | `ScheduleNotFound` | `claim_vested`, `cancel_stream` | No active schedule for the recipient |
| 2 | `CliffNotReached` | `claim_vested` | `current_ledger < cliff_ledger` |
| 3 | `InvalidDuration` | `create_vesting_stream` | `total_duration ≤ cliff_duration` |
| 4 | `InvalidRate` | `create_vesting_stream` | `rate ≤ 0` |
| 5 | `DepositOverflow` | `create_vesting_stream` | `rate × total_duration` overflows `i128` |
| 6 | `ScheduleAlreadyExists` | `create_vesting_stream` | Stream already exists for recipient |
| 7 | `NothingToClaim` | `claim_vested` | Claimable amount is 0 at current ledger |

Safe deposit upper bound: `rate ≤ i128::MAX / total_duration`. One unit above that limit returns `DepositOverflow`.

---

## Events

Events are emitted via `env.events().publish()`. Topics and data are XDR-encoded `SCVal` sequences.

### `vc_create` — Stream created

Emitted by `create_vesting_stream`.

| Field | Type | Value |
|---|---|---|
| Topic[0] | `SCVal::Symbol` | `"vc_create"` |
| Topic[1] | `SCVal::Address` | `recipient` |
| Data[0] | `SCVal::Address` | `sponsor` |
| Data[1] | `SCVal::Address` | `token` |
| Data[2] | `SCVal::I128` | `rate_per_ledger` |
| Data[3] | `SCVal::U32` | `start_ledger` |
| Data[4] | `SCVal::U32` | `cliff_ledger` |
| Data[5] | `SCVal::U32` | `end_ledger` |

### `vc_claim` — Tokens claimed

Emitted by `claim_vested` on every successful claim (including final claim).

| Field | Type | Value |
|---|---|---|
| Topic[0] | `SCVal::Symbol` | `"vc_claim"` |
| Topic[1] | `SCVal::Address` | `recipient` |
| Data[0] | `SCVal::I128` | `amount` transferred |
| Data[1] | `SCVal::U32` | `ledger_claimed_through` |

### `vc_done` — Stream completed

Emitted by `claim_vested` when the final claim drains the stream.

| Field | Type | Value |
|---|---|---|
| Topic[0] | `SCVal::Symbol` | `"vc_done"` |
| Topic[1] | `SCVal::Address` | `recipient` |
| Data | `SCVal::Address` | `token` |

### `vc_cancel` — Stream cancelled

Emitted by `cancel_stream`.

| Field | Type | Value |
|---|---|---|
| Topic[0] | `SCVal::Symbol` | `"vc_cancel"` |
| Topic[1] | `SCVal::Address` | `recipient` |
| Data | `SCVal::I128` | `refunded_amount` returned to sponsor |

---

## `contract_version` Field

All schedule-related API responses (e.g. `GET /schedule/:recipient`) include a `contract_version` field.

This value reflects the on-chain ledger sequence at the time of the last version fetch, formatted as `"ledger-{sequence}"`. It is fetched via `SorobanRpc.getLatestLedger()` and **cached for 5 minutes** to avoid excessive RPC calls.

**Example:**
```json
{
  "recipient": "GABC...",
  "contract_version": "ledger-123456"
}
```

**Semantics:**
- Treat `contract_version` as an opaque string for display and debugging purposes only.
- A change in value between requests does not necessarily indicate a contract upgrade — it reflects ledger progression.
- The value is not suitable for strict contract version gating; use the contract's Wasm hash for that.


---

## Backend REST API (v1)

The backend exposes a REST API under `/api/v1/` for the sponsor dashboard and
event pipeline. All v1 endpoints require a valid JWT unless noted otherwise.

### Authentication Flow (#288)

Authentication uses wallet-native Stellar keypair signatures, eliminating passwords.

#### `POST /api/v1/auth/challenge`

Issues a one-time nonce tied to the wallet address. The nonce is stored in
Redis with a 5-minute TTL and is consumed on first use (replay protection).

Rate-limited to **10 requests per minute per IP**.

**Request body:**

```json
{ "address": "G..." }
```

**Response 200:**

```json
{
  "nonce": "550e8400-e29b-41d4-a716-446655440000",
  "expires_in": 300,
  "created_at": 1722312073023,
  "message_to_sign": "G...:550e8400-...:1722312073023"
}
```

**Errors:** `400` invalid address, `429` rate limit exceeded.

---

#### `POST /api/v1/auth/verify`

Verifies the signed challenge and returns a JWT. The JWT contains `sub` (wallet
address), is signed with **RS256** (or HS256 in dev with `JWT_SECRET`), and
expires in 1 hour by default (`JWT_EXPIRY` env var).

Rate-limited to **10 requests per minute per IP**.

**Request body:**

```json
{
  "address": "G...",
  "nonce": "550e8400-e29b-41d4-a716-446655440000",
  "timestamp": 1722312073023,
  "signature": "<base64-encoded Ed25519 signature>"
}
```

Signature is computed over `{address}:{nonce}:{timestamp}` using the wallet's
private key (Ed25519).

**Response 200:**

```json
{
  "token": "eyJhbGci...",
  "expires_in": "1h",
  "wallet_address": "G..."
}
```

**Errors:** `400` missing/invalid fields, `401` bad signature, `429` rate limit.

---

#### `POST /api/v1/auth/refresh`

Exchanges a non-expired JWT for a new one with a fresh expiry. Pass the current
token in the `Authorization: Bearer <token>` header.

**Response 200:**

```json
{
  "token": "eyJhbGci...",
  "expires_in": "1h",
  "wallet_address": "G..."
}
```

**Errors:** `401` missing/invalid/expired token.

---

### `GET /api/v1/schedules` (#289)

Returns all vesting streams created by a given sponsor address, with optional
filtering, multi-field sorting, offset pagination, and cursor-based pagination.
Response is cached in Redis for **5 seconds**.

**Auth:** `Authorization: Bearer <token>` (JWT `sub` must match `sponsor` param).

**Query parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `sponsor` | string | ✓ | Stellar G... address of the stream funder |
| `status` | string | — | Filter: `active` \| `pre_cliff` \| `expired` \| `cancelled` |
| `sort` | string | — | `cliff_asc` (default) \| `cliff_desc` \| `end_asc` \| `end_desc` \| `claimable_asc` \| `claimable_desc` \| `recipient_asc` \| `recipient_desc` |
| `page` | integer | — | Page number, 1-based (default: `1`) |
| `limit` | integer | — | Items per page, max 100 (default: `25`) |
| `cursor` | string | — | Opaque base64url cursor from a previous response (takes precedence over `page`) |

**Example:**

```
GET /api/v1/schedules?sponsor=GABC...&status=active&sort=cliff_asc&page=1&limit=25
Authorization: Bearer eyJhbGci...
```

**Response 200:**

```json
{
  "items": [
    {
      "recipient": "GXYZ...",
      "sponsor": "GABC...",
      "token": "CTOK...",
      "rate_per_ledger": "100",
      "start_ledger": 50000,
      "cliff_ledger": 67280,
      "end_ledger": 222800,
      "status": "active",
      "cancelled_at": null,
      "claimable_amount": "12500",
      "created_at": "2026-07-30T06:00:00.000Z"
    }
  ],
  "total": 42,
  "page": 1,
  "limit": 25,
  "next_cursor": "eyJwYWdlIjoyLCJvZmZzZXQiOjI1fQ",
  "prev_cursor": null
}
```

**Status values:**

| Value | Meaning |
|-------|---------|
| `active` | Cliff passed; tokens dripping |
| `pre_cliff` | Stream exists; cliff not yet reached |
| `expired` | `end_ledger` reached; stream complete |
| `cancelled` | Sponsor cancelled the stream |

**Errors:** `400` invalid params, `401` missing/invalid JWT, `403` JWT address ≠ sponsor, `500` DB error.

---

### `GET /api/v1/worker/status` (#287)

Reports the health and lag of the Horizon event ingestion worker. Useful for
monitoring dashboards and alerting.

**Auth:** None (internal/ops use; protect with network policy in production).

**Response 200:**

```json
{
  "running": true,
  "lastLedger": 1234560,
  "chainTip": 1234563,
  "lagLedgers": 3,
  "lastPollAt": "2026-07-30T06:21:00.000Z",
  "backoffMs": 0,
  "errorCount": 0
}
```

A `lagLedgers` value consistently above `HORIZON_FINALITY_DEPTH` (default 3)
indicates the worker is falling behind and may need investigation.

---

### Database Schema (#286)

#### `stream_events`

Persists decoded contract events for efficient historical queries.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `event_type` | enum | `vc_create` \| `vc_claim` \| `vc_cancel` \| `vc_done` \| `vc_drain` |
| `recipient` | varchar(56) | Recipient Stellar address |
| `sponsor` | varchar(56) | Sponsor address (vc_create / vc_drain only) |
| `token` | varchar(56) | Token contract address |
| `amount` | bigint | Claimed / refunded amount (vc_claim / vc_cancel) |
| `ledger_sequence` | integer | Ledger number of the event |
| `tx_hash` | varchar(64) | Transaction hash (unique — prevents duplicate ingestion) |
| `created_at` | timestamptz | Row insertion time |

**Indexes:** `(recipient, event_type)`, `sponsor`, `ledger_sequence`, `created_at`.

#### `stream_events_dlq`

Dead-letter queue for events that cannot be decoded after `MAX_DECODE_ATTEMPTS` (3).

| Column | Type | Description |
|--------|------|-------------|
| `horizon_event_id` | text | Horizon event ID (unique) |
| `raw_payload` | jsonb | Full raw Horizon event record |
| `attempt_count` | integer | Number of decode attempts |
| `last_error` | text | Most recent decode error message |

#### Backfill script (#286)

To populate `stream_events` from Horizon history on first run:

```bash
DATABASE_URL=postgres://... \
HORIZON_URL=https://horizon-testnet.stellar.org \
TESTNET_CONTRACT_ID=C... \
tsx backend/scripts/backfill_stream_events.ts
```

Use `BACKFILL_START_CURSOR=<paging_token>` to resume from a checkpoint.
Use `BACKFILL_DRY_RUN=1` to log without writing.
