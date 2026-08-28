# Third-Party Protocol Integration Guide

This guide provides technical specifications, code examples, and integration patterns for protocol developers building on top of the `VestingDrips` Soroban smart contract.

---

## Table of Contents

1. [Overview](#overview)
2. [Cross-Contract Calls (Soroban Rust SDK)](#cross-contract-calls-soroban-rust-sdk)
3. [TypeScript SDK Integration (@stellar/stellar-sdk)](#typescript-sdk-integration-stellarstellar-sdk)
4. [Soroban CLI Usage](#soroban-cli-usage)
5. [Event Subscriptions via Horizon & RPC](#event-subscriptions-via-horizon--rpc)
6. [Complete Error Handling Guide](#complete-error-handling-guide)
7. [Common Integration Pitfalls](#common-integration-pitfalls)
8. [Horizon API Rate Limiting & RPC Notes](#horizon-api-rate-limiting--rpc-notes)

---

## Overview

`VestingDrips` manages time-locked cliff vesting and linear drip streams for Stellar Asset Contract (SAC) compatible tokens on Soroban. External protocols (DAOs, payroll managers, token launchpads, vault aggregators) can interface directly with `VestingDrips` via on-chain cross-contract invocations, off-chain TypeScript/JavaScript SDKs, or standard RPC event indexing.

---

## Cross-Contract Calls (Soroban Rust SDK)

When invoking `VestingDrips` from another Soroban smart contract, use the Soroban SDK client generator or contract import macro.

### Contract Import & Client Setup

```rust
use soroban_sdk::{contractclient, Address, Env};

// Option 1: Define the client interface using contractclient
#[contractclient(name = "VestingDripsClient")]
pub trait VestingDripsInterface {
    fn create_vesting_stream(
        env: Env,
        sponsor: Address,
        recipient: Address,
        token: Address,
        rate: i128,
        cliff_duration: u32,
        total_duration: u32,
    ) -> Result<(), u32>;

    fn claim_vested(env: Env, recipient: Address) -> Result<i128, u32>;

    fn cancel_stream(env: Env, sponsor: Address, recipient: Address) -> Result<(), u32>;

    fn claimable_amount(env: Env, recipient: Address) -> i128;

    fn is_cliff_passed(env: Env, recipient: Address) -> bool;
}
```

### Invocations from External Contracts

```rust
pub fn create_stream_for_contributor(
    env: Env,
    vesting_contract_id: Address,
    sponsor: Address,
    recipient: Address,
    token: Address,
    rate: i128,
    cliff_duration: u32,
    total_duration: u32,
) {
    // Require sponsor authorization
    sponsor.require_auth();

    let client = VestingDripsClient::new(&env, &vesting_contract_id);
    
    // Invoke cross-contract stream creation
    client.create_vesting_stream(
        &sponsor,
        &recipient,
        &token,
        &rate,
        &cliff_duration,
        &total_duration,
    );
}

pub fn claim_on_behalf_or_check(
    env: Env,
    vesting_contract_id: Address,
    recipient: Address,
) -> i128 {
    let client = VestingDripsClient::new(&env, &vesting_contract_id);
    
    // View current claimable balance
    let claimable = client.claimable_amount(&recipient);
    
    if claimable > 0 && client.is_cliff_passed(&recipient) {
        // Perform claim (recipient authorization required)
        recipient.require_auth();
        client.claim_vested(&recipient)
    } else {
        0
    }
}
```

---

## TypeScript SDK Integration (@stellar/stellar-sdk)

Integrate `VestingDrips` into web applications, NodeJS backends, or SDK wrappers using `@stellar/stellar-sdk`.

### Prerequisites

```bash
npm install @stellar/stellar-sdk
```

### Initializing RPC Server and Contract

```typescript
import {
  rpc,
  Contract,
  Address,
  nativeToScVal,
  scValToNative,
  Keypair,
  TransactionBuilder,
  Networks,
  xdr,
} from "@stellar/stellar-sdk";

const RPC_URL = "https://soroban-testnet.stellar.org";
const NETWORK_PASSPHRASE = Networks.TESTNET;
const server = new rpc.Server(RPC_URL);

const VESTING_CONTRACT_ID = "CA...YOUR_CONTRACT_ID";
const contract = new Contract(VESTING_CONTRACT_ID);
```

### 1. Creating a Vesting Stream

```typescript
async function createVestingStream(
  sponsorKeypair: Keypair,
  recipientAddress: string,
  tokenAddress: string,
  ratePerLedger: bigint,
  cliffDurationLedgers: number,
  totalDurationLedgers: number
) {
  const account = await server.getAccount(sponsorKeypair.publicKey());

  const tx = new TransactionBuilder(account, {
    fee: "100000",
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      contract.call(
        "create_vesting_stream",
        new Address(sponsorKeypair.publicKey()).toScVal(),
        new Address(recipientAddress).toScVal(),
        new Address(tokenAddress).toScVal(),
        nativeToScVal(ratePerLedger, { type: "i128" }),
        nativeToScVal(cliffDurationLedgers, { type: "u32" }),
        nativeToScVal(totalDurationLedgers, { type: "u32" })
      )
    )
    .setTimeout(30)
    .build();

  // Prepare & simulate transaction (handles TTL extensions & footprint resolution)
  const preparedTx = await server.prepareTransaction(tx);
  preparedTx.sign(sponsorKeypair);

  const response = await server.sendTransaction(preparedTx);
  console.log("Transaction submitted hash:", response.hash);
  return response;
}
```

### 2. Claiming Vested Tokens

```typescript
async function claimVested(recipientKeypair: Keypair) {
  const account = await server.getAccount(recipientKeypair.publicKey());

  const tx = new TransactionBuilder(account, {
    fee: "100000",
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      contract.call(
        "claim_vested",
        new Address(recipientKeypair.publicKey()).toScVal()
      )
    )
    .setTimeout(30)
    .build();

  const preparedTx = await server.prepareTransaction(tx);
  preparedTx.sign(recipientKeypair);

  const response = await server.sendTransaction(preparedTx);
  return response;
}
```

### 3. Querying Read-Only View Functions

```typescript
async function getClaimableAmount(recipientAddress: string): Promise<bigint> {
  const tx = new TransactionBuilder(
    await server.getAccount(recipientAddress),
    { fee: "100", networkPassphrase: NETWORK_PASSPHRASE }
  )
    .addOperation(
      contract.call(
        "claimable_amount",
        new Address(recipientAddress).toScVal()
      )
    )
    .setTimeout(30)
    .build();

  const simulation = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationSuccess(simulation)) {
    const resultScVal = simulation.result.retval;
    return scValToNative(resultScVal) as bigint;
  }
  throw new Error("Simulation failed");
}
```

---

## Soroban CLI Usage

Developers can inspect and interact with the contract using the official `stellar` CLI tool.

### Stream Creation

```bash
stellar contract invoke \
  --id CA...YOUR_CONTRACT_ID \
  --source SPONSOR_SECRET_KEY \
  --network testnet \
  -- \
  create_vesting_stream \
  --sponsor GSPONSOR... \
  --recipient GRECIPIENT... \
  --token CTOKEN... \
  --rate 1000000 \
  --cliff_duration 17280 \
  --total_duration 172800
```

### Claim Vested Tokens

```bash
stellar contract invoke \
  --id CA...YOUR_CONTRACT_ID \
  --source RECIPIENT_SECRET_KEY \
  --network testnet \
  -- \
  claim_vested \
  --recipient GRECIPIENT...
```

### Cancel Stream

```bash
stellar contract invoke \
  --id CA...YOUR_CONTRACT_ID \
  --source SPONSOR_SECRET_KEY \
  --network testnet \
  -- \
  cancel_stream \
  --sponsor GSPONSOR... \
  --recipient GRECIPIENT...
```

### Read-Only Queries

```bash
# Check if cliff has passed (returns true/false)
stellar contract invoke \
  --id CA...YOUR_CONTRACT_ID \
  --network testnet \
  -- \
  is_cliff_passed \
  --recipient GRECIPIENT...

# Query claimable amount
stellar contract invoke \
  --id CA...YOUR_CONTRACT_ID \
  --network testnet \
  -- \
  claimable_amount \
  --recipient GRECIPIENT...

# Query stream statistics
stellar contract invoke \
  --id CA...YOUR_CONTRACT_ID \
  --network testnet \
  -- \
  get_stats \
  --recipient GRECIPIENT...
```

---

## Event Subscriptions via Horizon & RPC

`VestingDrips` publishes structured events on key lifecycle actions. Event topics use short symbols and recipient addresses for targeted filtering.

### Event Definitions & Topics

| Event | Topic 1 (`Symbol`) | Topic 2 (`Address`) | Data Payload |
|---|---|---|---|
| Stream Created | `vc_create` | `recipient` | `(sponsor: Address, token: Address, rate_per_ledger: i128, start_ledger: u32, cliff_ledger: u32, end_ledger: u32)` |
| Tokens Claimed | `vc_claim` | `recipient` | `(amount: i128, ledger_claimed_through: u32)` |
| Stream Completed | `vc_done` | `recipient` | `token: Address` |
| Stream Cancelled | `vc_cancel` | `recipient` | `refunded_amount: i128` |
| Emergency Drain | `vc_drain` | `recipient` | `(sponsor: Address, amount: i128)` |
| Stream Clawback | `vc_claw` | `recipient` | `(sponsor: Address, token: Address, amount: i128, reason: String)` |

### Indexing Events via Stellar RPC (`getEvents`)

```typescript
async function fetchStreamEvents(contractId: string, startLedger: number) {
  const response = await server.getEvents({
    startLedger,
    filters: [
      {
        type: "contract",
        contractIds: [contractId],
        topics: [
          // Filter by event symbol (e.g. vc_claim)
          ["*", "*"]
        ],
      },
    ],
    limit: 100,
  });

  for (const event of response.events) {
    console.log("Event Ledger:", event.ledger);
    console.log("Topics:", event.topic.map(scValToNative));
    console.log("Data:", scValToNative(event.value));
  }
}
```

---

## Complete Error Handling Guide

All contract error codes are explicitly pinned `u32` enum values.

| Error Code | Name | Cause | Recommended Client Behavior |
|---|---|---|---|
| **1** | `ScheduleNotFound` | No schedule exists for the specified recipient address. | Verify recipient address; check if stream was already completed or cancelled. |
| **2** | `CliffNotReached` | `claim_vested` called before current ledger reaches `cliff_ledger`. | Call `is_cliff_passed()` before submitting claim transactions. Show time remaining until cliff in UI. |
| **3** | `InvalidDuration` | `total_duration` is less than or equal to `cliff_duration`. | Validate input parameters: ensure `total_duration > cliff_duration`. |
| **4** | `InvalidRate` | `rate_per_ledger` is zero or negative. | Ensure `rate > 0`. |
| **5** | `DepositOverflow` | Total deposit (`rate × total_duration`) exceeds `i128::MAX`. | Clamp rate input: ensure `rate <= i128::MAX / total_duration`. |
| **6** | `ScheduleAlreadyExists` | A schedule is already active for this recipient. | Cancel or wait for existing schedule to finish, or use a distinct recipient sub-account. |
| **7** | `NothingToClaim` | Ledger has not advanced or all vested tokens are already claimed. | Call `claimable_amount()` prior to building claim transactions; skip invocation if claimable amount is 0. |
| **8** | `StreamNotExpired` | `drain_expired_stream` called before `end_ledger` is reached. | Verify that `current_ledger >= end_ledger`. |
| **9** | `TransferFailed` | Underlying token contract transfer rejected (insufficient funds, trustline issue, account frozen). | Ensure sponsor has adequate balance and token approval/trustline before calling stream creation. |
| **10** | `DrainDelayNotExpired` | `drain_expired_stream` called before the 1-year drain delay (`end_ledger + 3_153_600`) has passed. | Check `current_ledger >= end_ledger + 3_153_600` before triggering emergency cleanup. |
| **11** | `InvalidRecipient` | `sponsor` and `recipient` addresses are identical. | Ensure sponsor and recipient are distinct addresses. |
| — | `AlreadyInitialized` | Contract `initialize` called when admin is already set. | Ensure initialization is performed only once during contract deployment setup. |
| — | `Unauthorized` | Admin function called by a non-admin key. | Sign transaction with designated admin key. |
| — | `DepositBelowMinimum` | Computed deposit is less than configured `min_deposit`. | Check total deposit against `get_min_deposit()`. |
| — | `ClawbackNotSupported` | `clawback_stream` called on token without SAC clawback enabled. | Ensure asset issuer has enabled clawback flag on token before calling clawback. |

---

## Common Integration Pitfalls

### 1. Authorization Requirements (`require_auth`)
- `create_vesting_stream`: Requires `sponsor.require_auth()`. The sponsor must sign the transaction and hold sufficient token balance.
- `claim_vested`: Requires `recipient.require_auth()`. Only the designated recipient can pull vested funds.
- `cancel_stream` & `clawback_stream`: Requires `sponsor.require_auth()`.
- `drain_expired_stream`: Permissionless (no auth required), but strictly enforced after expiration + drain delay.

### 2. State Archival & TTL Awareness
- Stream schedules are stored under `DataKey::Schedule(recipient)` as `CONTRACT_DATA` persistent entries.
- Every read (`get_schedule`) or write (`set_schedule`) automatically extends entry TTL to **60 days** (~518,400 ledgers) if it drops below **30 days** (~259,200 ledgers).
- If a stream remains untouched for >60 days, it transitions to archived state.
- **Client Handling**: Use `server.prepareTransaction()` in TypeScript SDK. RPC simulation detects archived entries and appends state restoration preambles automatically.

### 3. Integer Precision & Token Decimals
- Token amounts in Soroban are raw `i128` integer values representing base units (stroops for XLM with 7 decimals).
- `rate_per_ledger` is expressed in raw base units per ledger block.
- Example: For 1.0 token with 7 decimals per ledger: `rate = 10_000_000`.
- To avoid rounding loss when calculating vesting amounts over time, always compute: `amount = ledgers_elapsed * rate_per_ledger`.

---

## Horizon API Rate Limiting & RPC Notes

When scaling your integration, adhere to network endpoint guidelines:

1. **HTTP 429 Too Many Requests**: Public Stellar Horizon/RPC nodes enforce rate limits (typically 3600 requests per hour or per-second caps).
2. **Exponential Backoff**: Implement jittered exponential backoff for all RPC requests:
   ```typescript
   async function callWithRetry<T>(fn: () => Promise<T>, retries = 5, delay = 500): Promise<T> {
     try {
       return await fn();
     } catch (err: any) {
       if (retries > 0 && (err?.status === 429 || err?.code === "ECONNRESET")) {
         await new Promise((r) => setTimeout(r, delay));
         return callWithRetry(fn, retries - 1, delay * 2 + Math.random() * 100);
       }
       throw err;
     }
   }
   ```
3. **Prefer Soroban RPC for Smart Contract State**: Use Stellar RPC (`/soroban/rpc`) for contract simulation, execution, and state queries. Use Horizon for historical account payments and traditional Stellar asset balances.
4. **Self-Hosted Nodes**: For production protocol backends, run dedicated Soroban RPC instances or use paid RPC provider services to avoid public rate limits.
