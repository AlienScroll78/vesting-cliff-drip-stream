# API Reference — VestingDrips Contract

Complete documentation for all contract entry points, view functions, types, and events.

Contract ID is referred to as `$VESTING_CONTRACT` throughout the CLI examples.
All amounts are in the token's smallest unit (stroops for XLM-based SAC tokens).
Ledger sequences are `u32` values from `env.ledger().sequence()`.

---

## Table of Contents

- [HTTP API](#http-api)
- [Mutating Functions](#mutating-functions)
  - [create_vesting_stream](#create_vesting_stream)
  - [cancel_stream](#cancel_stream)
  - [clawback_stream](#clawback_stream)
  - [migrate_schedule](#migrate_schedule)
  - [emergency_drain](#emergency_drain)
- [Recipient Functions](#recipient-functions)
  - [claim_vested](#claim_vested)
- [Permissionless Functions](#permissionless-functions)
  - [drain_expired_stream](#drain_expired_stream)
- [View Functions](#view-functions)
  - [get_schedule](#get_schedule)
  - [claimable_amount](#claimable_amount)
  - [is_cliff_passed](#is_cliff_passed)
  - [get_status](#get_status)
  - [get_stats](#get_stats)
  - [get_min_deposit](#get_min_deposit)
- [Types](#types)
  - [VestingSchedule](#vestingschedule)
  - [StreamStatus](#streamstatus)
  - [StreamStats](#streamstats)
  - [DataKey](#datakey)
- [Error Codes](#error-codes)
- [Events](#events)

---

## HTTP API

### GET /api/v1/schedules/:recipient

Returns the full vesting schedule for a Stellar recipient address, including computed fields for the current ledger.

**Behavior**
- Returns `200` with a `VestingScheduleResponse` payload when the schedule exists.
- Returns `404` when no schedule exists for the recipient.
- Returns `400` for invalid Stellar addresses.
- Applies a `60 req/min` rate limit per IP.
- Caches responses for approximately 3 seconds based on the current ledger time.

**Response shape**

```json
{
  "recipient": "G...",
  "token": "C...",
  "rate_per_ledger": 10,
  "start_ledger": 1000,
  "cliff_ledger": 1100,
  "end_ledger": 2000,
  "last_claimed_ledger": 1000,
  "claimable_amount": 100,
  "is_cliff_passed": true
}
```

The OpenAPI document is available in [docs/api.yaml](docs/api.yaml).

---

## Mutating Functions

### `create_vesting_stream`

Creates a new cliff-vesting stream. The sponsor transfers the full token deposit (`rate × total_duration`) into the contract vault at creation time.

**Auth required:** `sponsor`

#### Signature

```rust
pub fn create_vesting_stream(
    env: Env,
    sponsor: Address,
    recipient: Address,
    token: Address,
    rate: i128,
    cliff_duration: u32,
    total_duration: u32,
) -> Result<(), VestingError>
```

#### Parameters

| Name | Type | Description | Constraints |
|------|------|-------------|-------------|
| `sponsor` | `Address` | Funder; must sign and hold sufficient tokens | — |
| `recipient` | `Address` | Beneficiary who will claim tokens | Must differ from `sponsor` |
| `token` | `Address` | [SAC](../docs/glossary.md#sac-stellar-asset-contract)-compatible token contract | — |
| `rate` | `i128` | Tokens released per [ledger](../docs/glossary.md#ledger) | Must be > 0 |
| `cliff_duration` | `u32` | Ledgers from now until [cliff](../docs/glossary.md#cliff) | Must be < `total_duration` |
| `total_duration` | `u32` | Total stream length in ledgers | Must be > `cliff_duration` |

#### Derived Values

| Field | Computed as |
|---|---|
| `start_ledger` | `env.ledger().sequence()` at call time |
| `cliff_ledger` | `start_ledger + cliff_duration` |
| `end_ledger` | `start_ledger + total_duration` |
| `total_deposit` | `rate × total_duration` |

#### Returns

`Result<(), VestingError>` — `Ok(())` on success

#### Errors

| Code | Name | Condition |
|---|---|---|
| 4 | `InvalidRate` | `rate` ≤ 0 |
| 3 | `InvalidDuration` | `total_duration` ≤ `cliff_duration` |
| 11 | `InvalidRecipient` | `sponsor` == `recipient` |
| 5 | `DepositOverflow` | `rate × total_duration` overflows `i128`, or ledger addition overflows `u32` |
| 14 | `DepositBelowMinimum` | `total_deposit` < configured minimum |
| 6 | `ScheduleAlreadyExists` | A stream already exists for `recipient` |
| 9 | `TransferFailed` | Token transfer from sponsor to contract failed |

#### Rust Example

```rust
use soroban_sdk::{Address, Env};

let env = Env::default();
let sponsor = Address::from_string(&String::from_str(&env, "GSPONSOR..."));
let recipient = Address::from_string(&String::from_str(&env, "GRECIPIENT..."));
let token = Address::from_string(&String::from_str(&env, "CTOKEN..."));

client.create_vesting_stream(
    &sponsor,
    &recipient,
    &token,
    &10_i128,          // rate: 10 tokens/ledger
    &17_280_u32,       // cliff: ~1 day
    &172_800_u32,      // total: ~10 days
)?;
```

#### TypeScript Example

```typescript
import { Contract, Address } from '@stellar/stellar-sdk';

const contract = new Contract(VESTING_CONTRACT);

await contract.call(
  'create_vesting_stream',
  sponsorAddress,         // sponsor
  recipientAddress,       // recipient
  tokenAddress,           // token
  10n,                    // rate
  17_280,                 // cliff_duration
  172_800,                // total_duration
);
```

#### CLI Example

```bash
stellar contract invoke \
  --id "$VESTING_CONTRACT" \
  --source "$SPONSOR" \
  --network testnet \
  -- \
  create_vesting_stream \
  --sponsor "$SPONSOR" \
  --recipient "$RECIPIENT" \
  --token "$TOKEN" \
  --rate 10 \
  --cliff_duration 17280 \
  --total_duration 172800
```

Or use the provided helper script:

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
### `cancel_stream`

Cancels an active stream. Token distribution depends on whether the cliff has been reached:

- **Cliff passed:** recipient receives all accrued-but-unclaimed tokens; sponsor is refunded the remainder.
- **Cliff not passed:** sponsor receives the full remaining deposit; recipient receives nothing.

The schedule is removed from storage in both cases.

**Auth required:** `sponsor`

#### Signature

```rust
pub fn cancel_stream(
    env: Env,
    sponsor: Address,
    recipient: Address,
) -> Result<(), VestingError>
```

#### Parameters

| Name | Type | Description |
|------|------|-------------|
| `sponsor` | `Address` | Original stream funder; must sign |
| `recipient` | `Address` | Stream beneficiary |

#### Returns

`Result<(), VestingError>` — `Ok(())` on success

#### Payout Logic

```
# Cliff passed
active_end       = min(current_ledger, end_ledger)
recipient_share  = (active_end − last_claimed_ledger) × rate_per_ledger
sponsor_refund   = (end_ledger − active_end) × rate_per_ledger

# Cliff NOT passed
recipient_share  = 0
sponsor_refund   = (end_ledger − last_claimed_ledger) × rate_per_ledger
```

#### Errors

| Code | Name | Condition |
|---|---|---|
| 1 | `ScheduleNotFound` | No active schedule for `recipient` |
| 9 | `TransferFailed` | Token transfer failed |

#### Rust Example

```rust
use soroban_sdk::{Address, Env};

let env = Env::default();
let sponsor = Address::from_string(&String::from_str(&env, "GSPONSOR..."));
let recipient = Address::from_string(&String::from_str(&env, "GRECIPIENT..."));

client.cancel_stream(&sponsor, &recipient)?;
```

#### TypeScript Example

```typescript
import { Contract } from '@stellar/stellar-sdk';

const contract = new Contract(VESTING_CONTRACT);

await contract.call(
  'cancel_stream',
  sponsorAddress,
  recipientAddress,
);
```

#### CLI Example

```bash
stellar contract invoke \
  --id "$VESTING_CONTRACT" \
  --source "$SPONSOR" \
  --network testnet \
  -- \
  cancel_stream \
  --sponsor "$SPONSOR" \
  --recipient "$RECIPIENT"
```

---

### `clawback_stream`

Compliance clawback: the original sponsor recovers **all remaining tokens** in the vault, bypassing cliff state. Only available on tokens that support the SAC clawback flag.

**Auth required:** `sponsor`

#### Signature

```rust
pub fn clawback_stream(
    env: Env,
    sponsor: Address,
    recipient: Address,
    reason: String,
) -> Result<(), VestingError>
```

#### Parameters

| Name | Type | Description | Constraints |
|------|------|-------------|-------------|
| `sponsor` | `Address` | Original stream funder; must sign | — |
| `recipient` | `Address` | Stream beneficiary | — |
| `reason` | `String` | Compliance reason | Max 256 chars |

#### Returns

`Result<(), VestingError>` — `Ok(())` on success

#### Errors

| Code | Name | Condition |
|---|---|---|
| 1 | `ScheduleNotFound` | No active schedule for `recipient` |
| 15 | `ClawbackNotSupported` | Token does not support SAC clawback |

#### Rust Example

```rust
use soroban_sdk::{Address, Env, String};

let env = Env::default();
let sponsor = Address::from_string(&String::from_str(&env, "GSPONSOR..."));
let recipient = Address::from_string(&String::from_str(&env, "GRECIPIENT..."));
let reason = String::from_str(&env, "AML violation - account freeze required");

client.clawback_stream(&sponsor, &recipient, &reason)?;
```

#### TypeScript Example

```typescript
import { Contract } from '@stellar/stellar-sdk';

const contract = new Contract(VESTING_CONTRACT);

await contract.call(
  'clawback_stream',
  sponsorAddress,
  recipientAddress,
  'Regulatory compliance - sanctions list match',
);
```

#### CLI Example

```bash
stellar contract invoke \
  --id "$VESTING_CONTRACT" \
  --source "$SPONSOR" \
  --network testnet \
  -- \
  clawback_stream \
  --sponsor "$SPONSOR" \
  --recipient "$RECIPIENT" \
  --reason "Regulatory compliance requirement"
```

---

### `migrate_schedule`

Upgrades a legacy (`version = 0`) schedule to the current schema version. Only needed for streams created before the versioning field was introduced.

**Auth required:** `admin`

#### Signature

```rust
pub fn migrate_schedule(
    env: Env,
    admin: Address,
    recipient: Address,
) -> Result<(), VestingError>
```

#### Parameters

| Name | Type | Description |
|------|------|-------------|
| `admin` | `Address` | Contract admin; must sign |
| `recipient` | `Address` | Recipient whose schedule should be migrated |

#### Returns

`Result<(), VestingError>` — `Ok(())` on success (idempotent)

#### Errors

| Code | Name | Condition |
|---|---|---|
| 13 | `Unauthorized` | Caller is not the contract admin |
| 1 | `ScheduleNotFound` | No schedule exists for `recipient` |

#### Rust Example

```rust
use soroban_sdk::{Address, Env};

let env = Env::default();
let admin = Address::from_string(&String::from_str(&env, "GADMIN..."));
let recipient = Address::from_string(&String::from_str(&env, "GRECIPIENT..."));

client.migrate_schedule(&admin, &recipient)?;
```

#### CLI Example

```bash
stellar contract invoke \
  --id "$VESTING_CONTRACT" \
  --source "$ADMIN" \
  --network testnet \
  -- \
  migrate_schedule \
  --admin "$ADMIN" \
  --recipient "$RECIPIENT"
```

---

### `emergency_drain`

Recovers unclaimed tokens from an expired stream after a 1-year safety delay. Used when recipient keys are permanently lost.

**Auth required:** `sponsor`

#### Signature

```rust
pub fn emergency_drain(
    env: Env,
    sponsor: Address,
    recipient: Address,
) -> Result<(), VestingError>
```

#### Parameters

| Name | Type | Description |
|------|------|-------------|
| `sponsor` | `Address` | Original stream funder; must sign |
| `recipient` | `Address` | Stream beneficiary whose tokens will be recovered |

#### Returns

`Result<(), VestingError>` — `Ok(())` on success

#### Safety Delay

Drain is only allowed after:
```
end_ledger + 3,153,600 ledgers (~1 year at 5s/ledger)
```

#### Errors

| Code | Name | Condition |
|---|---|---|
| 1 | `ScheduleNotFound` | No schedule exists for `recipient` |
| 8 | `StreamNotExpired` | `end_ledger` has not yet been reached |
| 10 | `DrainDelayNotExpired` | The 1-year delay after `end_ledger` has not passed |
| 9 | `TransferFailed` | Token transfer failed |

#### Rust Example

```rust
use soroban_sdk::{Address, Env};

let env = Env::default();
let sponsor = Address::from_string(&String::from_str(&env, "GSPONSOR..."));
let recipient = Address::from_string(&String::from_str(&env, "GRECIPIENT..."));

client.emergency_drain(&sponsor, &recipient)?;
```

#### TypeScript Example

```typescript
import { Contract } from '@stellar/stellar-sdk';

const contract = new Contract(VESTING_CONTRACT);

await contract.call(
  'emergency_drain',
  sponsorAddress,
  recipientAddress,
);
```

#### CLI Example

```bash
stellar contract invoke \
  --id "$VESTING_CONTRACT" \
  --source "$SPONSOR" \
  --network testnet \
  -- \
  emergency_drain \
  --sponsor "$SPONSOR" \
  --recipient "$RECIPIENT"
```

---

## Recipient Functions

### `claim_vested`

Claims all tokens accrued since the last claim (or since `start_ledger` on the first claim after the cliff). The cliff produces an instant "catch-up" payout covering every ledger from `start_ledger` to now.

**Auth required:** `recipient`

#### Signature

```rust
pub fn claim_vested(
    env: Env,
    recipient: Address,
) -> Result<i128, VestingError>
```

#### Parameters

| Name | Type | Description |
|------|------|-------------|
| `recipient` | `Address` | Beneficiary; must sign |

#### Returns

`Result<i128, VestingError>` — Amount transferred to `recipient`

#### Claim Calculation

```
active_end      = min(current_ledger, end_ledger)
claimable       = (active_end − last_claimed_ledger) × rate_per_ledger
```

After a successful claim, `last_claimed_ledger` is updated to `active_end`. When `active_end == end_ledger`, the schedule is removed from storage and a `vc_done` event is emitted.

#### Errors

| Code | Name | Condition |
|---|---|---|
| 1 | `ScheduleNotFound` | No active schedule for `recipient` |
| 2 | `CliffNotReached` | `current_ledger` < `cliff_ledger` |
| 7 | `NothingToClaim` | Computed claimable amount is 0 |
| 9 | `TransferFailed` | Token transfer failed |

#### Rust Example

```rust
use soroban_sdk::{Address, Env};

let env = Env::default();
let recipient = Address::from_string(&String::from_str(&env, "GRECIPIENT..."));

let amount = client.claim_vested(&recipient)?;
```

#### TypeScript Example

```typescript
import { Contract } from '@stellar/stellar-sdk';

const contract = new Contract(VESTING_CONTRACT);

const result = await contract.call(
  'claim_vested',
  recipientAddress,
);

console.log(`Claimed ${result} tokens`);
```

#### CLI Example

```bash
stellar contract invoke \
  --id "$VESTING_CONTRACT" \
  --source "$RECIPIENT" \
  --network testnet \
  -- \
  claim_vested \
  --recipient "$RECIPIENT"
```

Or use the provided helper script:

```bash
export VESTING_CONTRACT=<contract-id>
export RECIPIENT=<key-name-or-address>

./scripts/invoke_claim.sh
```

---

## Permissionless Functions

### `drain_expired_stream`

Permissionless cleanup of a fully expired stream. Available to **any caller** after `end_ledger + 3,153,600` ledgers (~1 year) have elapsed. Transfers remaining tokens to the original sponsor.

**Auth required:** None (callable by anyone)

#### Signature

```rust
pub fn drain_expired_stream(
    env: Env,
    caller: Address,
    recipient: Address,
) -> Result<(), VestingError>
```

#### Parameters

| Name | Type | Description |
|------|------|-------------|
| `caller` | `Address` | Any address initiating cleanup (no auth required) |
| `recipient` | `Address` | Stream beneficiary whose expired schedule will be drained |

#### Returns

`Result<(), VestingError>` — `Ok(())` on success

#### Errors

| Code | Name | Condition |
|---|---|---|
| 1 | `ScheduleNotFound` | No schedule exists for `recipient` |
| 8 | `StreamNotExpired` | `end_ledger` has not yet been reached |
| 10 | `DrainDelayNotExpired` | The 1-year delay after `end_ledger` has not passed |

#### Rust Example

```rust
use soroban_sdk::{Address, Env};

let env = Env::default();
let caller = Address::from_string(&String::from_str(&env, "GCALLER..."));
let recipient = Address::from_string(&String::from_str(&env, "GRECIPIENT..."));

client.drain_expired_stream(&caller, &recipient)?;
```

#### TypeScript Example

```typescript
import { Contract } from '@stellar/stellar-sdk';

const contract = new Contract(VESTING_CONTRACT);

await contract.call(
  'drain_expired_stream',
  callerAddress,
  recipientAddress,
);
```

#### CLI Example

```bash
stellar contract invoke \
  --id "$VESTING_CONTRACT" \
  --source "$ANY_ADDRESS" \
  --network testnet \
  -- \
  drain_expired_stream \
  --caller "$ANY_ADDRESS" \
  --recipient "$RECIPIENT"
```

---

## View Functions

View functions do not require auth, do not modify state, and return safe defaults (`0` / `false` / `None`) when no schedule exists rather than erroring.

### `get_schedule`

Returns the full vesting schedule for `recipient`.

#### Signature

```rust
pub fn get_schedule(
    env: Env,
    recipient: Address,
) -> Option<VestingSchedule>
```

#### Parameters

| Name | Type | Description |
|------|------|-------------|
| `recipient` | `Address` | Stream beneficiary |

#### Returns

`Option<VestingSchedule>` — `Some(schedule)` or `None` if no schedule exists

See [VestingSchedule](#vestingschedule) for the full struct definition.

#### Rust Example

```rust
use soroban_sdk::{Address, Env};

let env = Env::default();
let recipient = Address::from_string(&String::from_str(&env, "GRECIPIENT..."));

if let Some(schedule) = client.get_schedule(&recipient) {
    println!("Rate: {}, Cliff: {}", schedule.rate_per_ledger, schedule.cliff_ledger);
}
```

#### TypeScript Example

```typescript
import { Contract } from '@stellar/stellar-sdk';

const contract = new Contract(VESTING_CONTRACT);

const schedule = await contract.call('get_schedule', recipientAddress);

if (schedule) {
  console.log(`Rate: ${schedule.rate_per_ledger}`);
  console.log(`Cliff: ${schedule.cliff_ledger}`);
}
```

#### CLI Example

```bash
stellar contract invoke \
  --id "$VESTING_CONTRACT" \
  --network testnet \
  -- \
  get_schedule \
  --recipient "$RECIPIENT"
```

#### Example Output

```json
{
  "version": 1,
  "token": "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
  "sponsor": "GABC...",
  "rate_per_ledger": "10",
  "start_ledger": 1000000,
  "cliff_ledger": 1017280,
  "end_ledger": 1172800,
  "last_claimed_ledger": 1000000,
  "total_claimed": "0"
}
```

---

### `claimable_amount`

Returns the number of tokens currently claimable. Returns `0` if the cliff has not been reached or no schedule exists.

#### Signature

```rust
pub fn claimable_amount(
    env: Env,
    recipient: Address,
) -> i128
```

#### Parameters

| Name | Type | Description |
|------|------|-------------|
| `recipient` | `Address` | Stream beneficiary |

#### Returns

`i128` ≥ 0 — Number of tokens claimable right now

#### Expected Output at Each Phase

| Stream Phase | Claimable Amount |
|--------------|------------------|
| Pre-cliff | `0` |
| First claim after cliff | `(current_ledger - start_ledger) × rate` |
| Active (subsequent claims) | `(current_ledger - last_claimed_ledger) × rate` |
| Fully claimed | `0` |
| No schedule | `0` |

#### Rust Example

```rust
use soroban_sdk::{Address, Env};

let env = Env::default();
let recipient = Address::from_string(&String::from_str(&env, "GRECIPIENT..."));

let amount = client.claimable_amount(&recipient);
println!("Claimable: {}", amount);
```

#### TypeScript Example

```typescript
import { Contract } from '@stellar/stellar-sdk';

const contract = new Contract(VESTING_CONTRACT);

const claimable = await contract.call('claimable_amount', recipientAddress);
console.log(`Claimable: ${claimable} tokens`);
```

#### CLI Example

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

#### Signature

```rust
pub fn is_cliff_passed(
    env: Env,
    recipient: Address,
) -> bool
```

#### Parameters

| Name | Type | Description |
|------|------|-------------|
| `recipient` | `Address` | Stream beneficiary |

#### Returns

`bool` — `true` if `current_ledger ≥ cliff_ledger`, `false` otherwise (including when no schedule exists)

#### Rust Example

```rust
use soroban_sdk::{Address, Env};

let env = Env::default();
let recipient = Address::from_string(&String::from_str(&env, "GRECIPIENT..."));

if client.is_cliff_passed(&recipient) {
    println!("Cliff passed - tokens are claimable");
}
```

#### TypeScript Example

```typescript
import { Contract } from '@stellar/stellar-sdk';

const contract = new Contract(VESTING_CONTRACT);

const cliffPassed = await contract.call('is_cliff_passed', recipientAddress);

if (cliffPassed) {
  console.log('Cliff passed - claiming enabled');
}
```

#### CLI Example

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

#### Signature

```rust
pub fn get_status(
    env: Env,
    recipient: Address,
) -> Option<StreamStatus>
```

#### Parameters

| Name | Type | Description |
|------|------|-------------|
| `recipient` | `Address` | Stream beneficiary |

#### Returns

`Option<StreamStatus>` — See [StreamStatus](#streamstatus) for variants

| Return value | Meaning |
|---|---|
| `Some(PreCliff)` | Stream exists; cliff not yet reached |
| `Some(Active)` | Cliff passed; tokens dripping until `end_ledger` |
| `Some(Completed)` | `end_ledger` reached; all tokens vested |
| `None` | No schedule (never created, cancelled, or completed and removed) |

#### Rust Example

```rust
use soroban_sdk::{Address, Env};
use crate::types::StreamStatus;

let env = Env::default();
let recipient = Address::from_string(&String::from_str(&env, "GRECIPIENT..."));

match client.get_status(&recipient) {
    Some(StreamStatus::PreCliff) => println!("Waiting for cliff"),
    Some(StreamStatus::Active) => println!("Stream active"),
    Some(StreamStatus::Completed) => println!("Stream completed"),
    None => println!("No stream found"),
    _ => {}
}
```

#### TypeScript Example

```typescript
import { Contract } from '@stellar/stellar-sdk';

const contract = new Contract(VESTING_CONTRACT);

const status = await contract.call('get_status', recipientAddress);

const statusLabels = {
  0: 'Pre-cliff',
  1: 'Active',
  2: 'Completed',
  3: 'Cancelled',
};

console.log(`Stream status: ${statusLabels[status] || 'None'}`);
```

#### CLI Example

```bash
stellar contract invoke \
  --id "$VESTING_CONTRACT" \
  --network testnet \
  -- \
  get_status \
  --recipient "$RECIPIENT"
```

---

### `get_stats`

Returns consolidated statistics for a vesting stream: total deposited, claimed, remaining, and claimable right now.

#### Signature

```rust
pub fn get_stats(
    env: Env,
    recipient: Address,
) -> Option<StreamStats>
```

#### Parameters

| Name | Type | Description |
|------|------|-------------|
| `recipient` | `Address` | Stream beneficiary |

#### Returns

`Option<StreamStats>` — `Some(stats)` or `None` if no schedule exists

See [StreamStats](#streamstats) for the full struct definition.

#### Mathematical Invariants

- `total_deposited == total_claimed + remaining`
- `claimable_now <= remaining`

#### Rust Example

```rust
use soroban_sdk::{Address, Env};

let env = Env::default();
let recipient = Address::from_string(&String::from_str(&env, "GRECIPIENT..."));

if let Some(stats) = client.get_stats(&recipient) {
    println!("Total: {}", stats.total_deposited);
    println!("Claimed: {}", stats.total_claimed);
    println!("Remaining: {}", stats.remaining);
    println!("Claimable now: {}", stats.claimable_now);
}
```

#### TypeScript Example

```typescript
import { Contract } from '@stellar/stellar-sdk';

const contract = new Contract(VESTING_CONTRACT);

const stats = await contract.call('get_stats', recipientAddress);

if (stats) {
  console.log(`Total deposited: ${stats.total_deposited}`);
  console.log(`Already claimed: ${stats.total_claimed}`);
  console.log(`Still in vault: ${stats.remaining}`);
  console.log(`Claimable now: ${stats.claimable_now}`);
}
```

#### CLI Example

```bash
stellar contract invoke \
  --id "$VESTING_CONTRACT" \
  --network testnet \
  -- \
  get_stats \
  --recipient "$RECIPIENT"
```

#### Example Output

```json
{
  "total_deposited": "1728000",
  "total_claimed": "500000",
  "remaining": "1228000",
  "claimable_now": "50000"
}
```

---

### `get_min_deposit`

Returns the current minimum deposit threshold configured for the contract.

#### Signature

```rust
pub fn get_min_deposit(env: Env) -> i128
```

#### Parameters

None

#### Returns

`i128` — Current minimum total deposit value (default: 100)

#### Rust Example

```rust
use soroban_sdk::Env;

let env = Env::default();

let min_deposit = client.get_min_deposit();
println!("Minimum deposit: {}", min_deposit);
```

#### TypeScript Example

```typescript
import { Contract } from '@stellar/stellar-sdk';

const contract = new Contract(VESTING_CONTRACT);

const minDeposit = await contract.call('get_min_deposit');
console.log(`Minimum deposit: ${minDeposit}`);
```

#### CLI Example

```bash
stellar contract invoke \
  --id "$VESTING_CONTRACT" \
  --network testnet \
  -- \
  get_min_deposit
```

---

## Types

### `VestingSchedule`

Represents a single vesting schedule stored per recipient in persistent contract storage.

#### Definition

```rust
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct VestingSchedule {
    pub version: u32,
    pub token: Address,
    pub sponsor: Address,
    pub rate_per_ledger: i128,
    pub start_ledger: u32,
    pub cliff_ledger: u32,
    pub end_ledger: u32,
    pub last_claimed_ledger: u32,
    pub total_claimed: i128,
}
```

#### Fields

| Field | Type | Description |
|-------|------|-------------|
| `version` | `u32` | Schema version (0 = legacy, 1 = current) |
| `token` | `Address` | SAC token being streamed |
| `sponsor` | `Address` | Original funder of the stream |
| `rate_per_ledger` | `i128` | Tokens released per ledger after cliff |
| `start_ledger` | `u32` | Ledger at stream creation |
| `cliff_ledger` | `u32` | Ledger where cliff is reached |
| `end_ledger` | `u32` | Ledger where stream ends (no more accrual) |
| `last_claimed_ledger` | `u32` | Last ledger through which tokens were claimed |
| `total_claimed` | `i128` | Running total of tokens transferred to recipient |

#### Storage

- **Key:** `DataKey::Schedule(recipient: Address)`
- **Tier:** [Persistent storage](../docs/glossary.md#persistent-storage)
- **TTL:** Bumped to ~60 days on every read/write

#### XDR Field Encoding

| Field | XDR type |
|---|---|
| `version` | `SCVal::U32` |
| `token` | `SCVal::Address` |
| `sponsor` | `SCVal::Address` |
| `rate_per_ledger` | `SCVal::I128` |
| `start_ledger` | `SCVal::U32` |
| `cliff_ledger` | `SCVal::U32` |
| `end_ledger` | `SCVal::U32` |
| `last_claimed_ledger` | `SCVal::U32` |
| `total_claimed` | `SCVal::I128` |

---

### `StreamStatus`

Human-readable lifecycle status of a vesting stream.

#### Definition

```rust
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum StreamStatus {
    PreCliff,   // 0
    Active,     // 1
    Completed,  // 2
    Cancelled,  // 3
}
```

#### Variants

| Variant | Value | Meaning | UI Badge Color |
|---------|-------|---------|----------------|
| `PreCliff` | 0 | Cliff not yet reached; no tokens claimable | Amber (#F59E0B) |
| `Active` | 1 | Cliff passed; tokens dripping linearly | Blue (#3B82F6) |
| `Completed` | 2 | Stream fully drained (`end_ledger` reached) | Green (#22C55E) |
| `Cancelled` | 3 | Sponsor cancelled before completion | Red (#EF4444) |

#### Notes

- `Cancelled` is never returned by `get_status` at runtime because the schedule is deleted on cancellation (returns `None` instead)
- The variant exists for off-chain indexers reconstructing state from events

#### XDR Encoding

`StreamStatus` is encoded as `SCVal::Vec` (Soroban enum contracttype) with the variant index as the first element.

---

### `StreamStats`

Consolidated statistics for a vesting stream.

#### Definition

```rust
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct StreamStats {
    pub total_deposited: i128,
    pub total_claimed: i128,
    pub remaining: i128,
    pub claimable_now: i128,
}
```

#### Fields

| Field | Type | Description |
|-------|------|-------------|
| `total_deposited` | `i128` | Total tokens deposited at stream creation (`rate × total_duration`) |
| `total_claimed` | `i128` | Tokens already transferred to recipient via `claim_vested` |
| `remaining` | `i128` | Tokens still held by contract vault for this stream |
| `claimable_now` | `i128` | Tokens claimable right now (zero if cliff not reached) |

#### Invariants

```
total_deposited == total_claimed + remaining
claimable_now <= remaining
```

---

### `DataKey`

Storage key variants used for keying contract data.

#### Definition

```rust
#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Schedule(Address),
    MinDeposit,
}
```

#### Variants

| Variant | Storage Key | Value Type | Description |
|---------|-------------|------------|-------------|
| `Schedule(Address)` | Per-recipient | `VestingSchedule` | Individual vesting schedule |
| `MinDeposit` | Instance-level | `i128` | Minimum deposit threshold |

---

## Error Codes

All errors are returned as `u32` in the XDR `ScError::Contract` envelope. Code 0 is reserved for success by the Soroban runtime and is never used here.

| Code | Name | Returned by | Meaning |
|---|---|---|---|
| 1 | `ScheduleNotFound` | `claim_vested`, `cancel_stream`, `clawback_stream`, `migrate_schedule`, `emergency_drain`, `drain_expired_stream` | No active schedule for the recipient |
| 2 | `CliffNotReached` | `claim_vested` | `current_ledger` < `cliff_ledger` |
| 3 | `InvalidDuration` | `create_vesting_stream` | `total_duration` ≤ `cliff_duration` |
| 4 | `InvalidRate` | `create_vesting_stream`, `set_min_deposit` | `rate` ≤ 0 or `min_deposit` ≤ 0 |
| 5 | `DepositOverflow` | `create_vesting_stream`, `drain_expired_stream`, `emergency_drain` | `rate × total_duration` overflows `i128`, or ledger addition overflows `u32` |
| 6 | `ScheduleAlreadyExists` | `create_vesting_stream` | Stream already exists for recipient |
| 7 | `NothingToClaim` | `claim_vested` | Claimable amount is 0 at current ledger |
| 8 | `StreamNotExpired` | `emergency_drain`, `drain_expired_stream` | `end_ledger` has not yet been reached |
| 9 | `TransferFailed` | `create_vesting_stream`, `claim_vested`, `cancel_stream`, `emergency_drain` | Token transfer call failed |
| 10 | `DrainDelayNotExpired` | `emergency_drain`, `drain_expired_stream` | The 1-year delay after `end_ledger` has not passed |
| 11 | `InvalidRecipient` | `create_vesting_stream` | `sponsor` and `recipient` are the same address |
| 12 | `AlreadyInitialized` | `initialize` | Admin has already been set |
| 13 | `Unauthorized` | `upgrade`, `transfer_admin`, `migrate_schedule` | Caller is not the contract admin |
| 14 | `DepositBelowMinimum` | `create_vesting_stream` | `total_deposit` < configured minimum |
| 15 | `ClawbackNotSupported` | `clawback_stream` | Token does not support SAC clawback |

### Safe Deposit Boundary

The safe upper bound for `rate` is:
```
rate ≤ i128::MAX / total_duration
```

One unit above this threshold returns `DepositOverflow`.

### Error Handling Examples

#### Rust

```rust
use crate::error::VestingError;

match client.claim_vested(&recipient) {
    Ok(amount) => println!("Claimed: {}", amount),
    Err(VestingError::CliffNotReached) => println!("Cliff not reached yet"),
    Err(VestingError::ScheduleNotFound) => println!("No stream found"),
    Err(e) => println!("Error: {:?}", e),
}
```

#### TypeScript

```typescript
try {
  await contract.call('claim_vested', recipientAddress);
} catch (error) {
  const code = error.code;
  
  switch (code) {
    case 1:
      console.error('Schedule not found');
      break;
    case 2:
      console.error('Cliff not reached');
      break;
    case 7:
      console.error('Nothing to claim');
      break;
    default:
      console.error(`Contract error ${code}`);
  }
}
```

---

## Events

Events are emitted via `env.events().publish()`. Topics and data are XDR-encoded `SCVal` sequences.

### `StreamCreated` — Stream created

Emitted by `create_vesting_stream`.

#### Structure

| Field | Type | Value |
|---|---|---|
| Topic[0] | `SCVal::Symbol` | `"StreamCreated"` |
| Topic[1] | `SCVal::Address` | `sponsor` |
| Topic[2] | `SCVal::Address` | `recipient` |
| Data.token | `SCVal::Address` | `token` |
| Data.rate | `SCVal::I128` | `rate` |
| Data.start_ledger | `SCVal::U32` | `start_ledger` |
| Data.cliff_ledger | `SCVal::U32` | `cliff_ledger` |
| Data.end_ledger | `SCVal::U32` | `end_ledger` |
| Data.total_deposit | `SCVal::I128` | `total_deposit` |

#### Example (JSON representation)

```json
{
  "type": "contract",
  "contractId": "CVESTING...",
  "topic": ["vc_create", "GRECIPIENT..."],
  "value": [
    "GSPONSOR...",
    "CTOKEN...",
    "10",
    1000000,
    1017280,
    1172800
  ]
}
```

---

### `vc_claim` — Tokens claimed

Emitted by `claim_vested` on every successful claim (including final claim).

#### Structure

| Field | Type | Value |
|---|---|---|
| Topic[0] | `SCVal::Symbol` | `"vc_claim"` |
| Topic[1] | `SCVal::Address` | `recipient` |
| Data[0] | `SCVal::I128` | `amount` transferred |
| Data[1] | `SCVal::U32` | `ledger_claimed_through` |

#### Example (JSON representation)

```json
{
  "type": "contract",
  "contractId": "CVESTING...",
  "topic": ["vc_claim", "GRECIPIENT..."],
  "value": ["50000", 1020000]
}
```

---

### `vc_done` — Stream completed

Emitted by `claim_vested` when the final claim drains the stream.

#### Structure

| Field | Type | Value |
|---|---|---|
| Topic[0] | `SCVal::Symbol` | `"vc_done"` |
| Topic[1] | `SCVal::Address` | `recipient` |
| Data | `SCVal::Address` | `token` |

#### Example (JSON representation)

```json
{
  "type": "contract",
  "contractId": "CVESTING...",
  "topic": ["vc_done", "GRECIPIENT..."],
  "value": "CTOKEN..."
}
```

---

### `vc_cancel` — Stream cancelled

Emitted by `cancel_stream`.

#### Structure

| Field | Type | Value |
|---|---|---|
| Topic[0] | `SCVal::Symbol` | `"vc_cancel"` |
| Topic[1] | `SCVal::Address` | `recipient` |
| Data | `SCVal::I128` | `refunded_amount` returned to sponsor |

#### Example (JSON representation)

```json
{
  "type": "contract",
  "contractId": "CVESTING...",
  "topic": ["vc_cancel", "GRECIPIENT..."],
  "value": "1228000"
}
```

---

### `vc_clawback` — Stream clawed back

Emitted by `clawback_stream`.

#### Structure

| Field | Type | Value |
|---|---|---|
| Topic[0] | `SCVal::Symbol` | `"vc_clawback"` |
| Topic[1] | `SCVal::Address` | `recipient` |
| Data[0] | `SCVal::Address` | `sponsor` |
| Data[1] | `SCVal::Address` | `token` |
| Data[2] | `SCVal::I128` | `amount` recovered |
| Data[3] | `SCVal::String` | `reason` (compliance message) |

#### Example (JSON representation)

```json
{
  "type": "contract",
  "contractId": "CVESTING...",
  "topic": ["vc_clawback", "GRECIPIENT..."],
  "value": [
    "GSPONSOR...",
    "CTOKEN...",
    "1228000",
    "AML violation - account freeze required"
  ]
}
```

---

### `vc_drain` — Emergency drain executed

Emitted by `emergency_drain` and `drain_expired_stream`.

#### Structure

| Field | Type | Value |
|---|---|---|
| Topic[0] | `SCVal::Symbol` | `"vc_drain"` |
| Topic[1] | `SCVal::Address` | `recipient` |
| Data[0] | `SCVal::Address` | `sponsor` (token destination) |
| Data[1] | `SCVal::I128` | `amount` recovered |

For `drain_expired_stream`, an additional data field may be present:

| Field | Type | Value |
|---|---|---|
| Data[2] | `SCVal::Address` | `caller` (who initiated cleanup) |

#### Example (JSON representation)

```json
{
  "type": "contract",
  "contractId": "CVESTING...",
  "topic": ["vc_drain", "GRECIPIENT..."],
  "value": ["GSPONSOR...", "1228000"]
}
```

---

## Backend API Cross-References

If you're building a backend service that wraps this contract, here are the recommended HTTP endpoint mappings:

| Contract Function | HTTP Method | Suggested Endpoint | Notes |
|-------------------|-------------|-------------------|-------|
| `create_vesting_stream` | POST | `/api/v1/streams` | Body: `{sponsor, recipient, token, rate, cliff_duration, total_duration}` |
| `cancel_stream` | DELETE | `/api/v1/streams/:recipient` | Query param: `sponsor` |
| `clawback_stream` | POST | `/api/v1/streams/:recipient/clawback` | Body: `{sponsor, reason}` |
| `claim_vested` | POST | `/api/v1/streams/:recipient/claim` | Auth from recipient |
| `get_schedule` | GET | `/api/v1/streams/:recipient` | Returns full schedule |
| `get_stats` | GET | `/api/v1/streams/:recipient/stats` | Returns consolidated stats |
| `get_status` | GET | `/api/v1/streams/:recipient/status` | Returns badge status |
| `claimable_amount` | GET | `/api/v1/streams/:recipient/claimable` | Returns single `i128` value |

### Example: Backend GET /api/v1/streams/:recipient

```bash
curl -X GET "https://api.example.com/v1/streams/GRECIPIENT..." \
  -H "Authorization: Bearer $TOKEN"
```

**Response:**

```json
{
  "recipient": "GRECIPIENT...",
  "schedule": {
    "version": 1,
    "token": "CTOKEN...",
    "sponsor": "GSPONSOR...",
    "rate_per_ledger": "10",
    "start_ledger": 1000000,
    "cliff_ledger": 1017280,
    "end_ledger": 1172800,
    "last_claimed_ledger": 1000000,
    "total_claimed": "0"
  },
  "contract_version": "ledger-1020000"
}
```

### Example: Backend POST /api/v1/streams

```bash
curl -X POST "https://api.example.com/v1/streams" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $SPONSOR_TOKEN" \
  -d '{
    "sponsor": "GSPONSOR...",
    "recipient": "GRECIPIENT...",
    "token": "CTOKEN...",
    "rate": "10",
    "cliff_duration": 17280,
    "total_duration": 172800
  }'
```

**Response:**

```json
{
  "status": "created",
  "recipient": "GRECIPIENT...",
  "transaction_hash": "abc123...",
  "ledger": 1000000
}
```

---

## Contract Version Field

All schedule-related API responses (e.g. `GET /schedule/:recipient`) should include a `contract_version` field.

This value reflects the on-chain ledger sequence at the time of the last version fetch, formatted as `"ledger-{sequence}"`. It is fetched via `SorobanRpc.getLatestLedger()` and should be **cached for 5 minutes** to avoid excessive RPC calls.

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

## Additional Resources

- [Glossary](glossary.md) — Domain-specific term definitions
- [FAQ](faq.md) — Common questions about stream lifecycle, claiming, and fees
- [Comparison Guide](comparison.md) — Feature comparison with standard Drips
- [Architecture Decision Records](adr/README.md) — Design rationale for key decisions
- [Source Code](../src/contract.rs) — Complete contract implementation

---

**Last Updated:** 2026-07-29  
**Contract Version:** 1.0  
**Soroban SDK:** 21.x
