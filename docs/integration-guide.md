# VestingDrips Integration Guide

A practical guide for external dApp developers who want to create, query, and react to vesting streams from their own applications.

> **Target audience:** dApp developers building frontends, dashboards, or backend services that interact with the VestingDrips contract on Stellar.
> For protocol developers embedding VestingDrips into another Soroban contract, see the [cross-contract section of the API reference](api-reference.md).

---

## Table of Contents

1. [Contract Overview](#1-contract-overview)
2. [Prerequisites](#2-prerequisites)
3. [Step-by-Step: Setting Up a Stream via Stellar CLI](#3-step-by-step-setting-up-a-stream-via-stellar-cli)
4. [Step-by-Step: Claiming via the JavaScript SDK](#4-step-by-step-claiming-via-the-javascript-sdk)
5. [Error Handling: Mapping Error Codes to UX Messages](#5-error-handling-mapping-error-codes-to-ux-messages)
6. [Webhook Integration: Registering and Verifying Events](#6-webhook-integration-registering-and-verifying-events)
7. [Security Checklist for Integrators](#7-security-checklist-for-integrators)

---

## 1. Contract Overview

VestingDrips combines a **time-locked cliff** with **linear token streaming** for Stellar-based tokens. A [sponsor](glossary.md#sponsor) deposits the full token allocation upfront; a [recipient](glossary.md#recipient) cannot claim anything until a configurable [cliff](glossary.md#cliff) ledger is reached. After the cliff, all tokens accrued since the stream's start are released at once, then the remainder drips linearly per [ledger](glossary.md#ledger) until the stream ends.

```
Ledger:  start_ledger       cliff_ledger                 end_ledger
              │                   │                            │
Tokens:       │    [locked]       │ ← instant catch-up claim  │ ← linear drip ──┤
```

### Key concepts

| Concept | What it means for your dApp |
|---|---|
| **Ledger ≈ 5 s** | All time parameters are in ledgers, not seconds. Multiply by 5 to get approximate seconds. |
| **Amounts in base units** | Token amounts are raw integers (stroops for XLM). Divide by `10^decimals` for display. |
| **Cliff catch-up** | The first claim after the cliff transfers everything accrued from `start_ledger`, not just from the cliff. |
| **No partial streaming before cliff** | `claimable_amount` returns `0` before the cliff — always check this before building claim transactions. |
| **Auth required** | `create_vesting_stream` requires the sponsor to sign; `claim_vested` and `cancel_stream` require their respective callers to sign. |

### Stream lifecycle at a glance

See [docs/flows.md](flows.md) for the full state diagram and transition table. The states your UI should handle:

| State | Meaning | Suggested badge |
|---|---|---|
| `PreCliff` | Stream exists; cliff not yet reached | Amber — "Cliff pending" |
| `Active` | Cliff passed; tokens dripping | Blue — "Active" |
| `Expired` | `end_ledger` reached or final claim done | Green — "Completed" |
| `Cancelled` | Sponsor cancelled early | Red — "Cancelled" |
| `NotFound` | No schedule for this address | Grey — "Not found" |

### Full API reference

For complete function signatures, parameter constraints, and type definitions, see [docs/api-reference.md](api-reference.md).

---

## 2. Prerequisites

### Tools

| Tool | Minimum version | Install |
|---|---|---|
| Stellar CLI (`stellar`) | 21.x | [Installation guide](https://developers.stellar.org/docs/tools/developer-tools/cli/install-cli) |
| Node.js | 18 LTS | [nodejs.org](https://nodejs.org) |
| `@stellar/stellar-sdk` | 12.x | `npm install @stellar/stellar-sdk` |

### Environment variables

The examples in this guide use these shell variables. Set them once before following any section:

```bash
export NETWORK="testnet"
export RPC_URL="https://soroban-testnet.stellar.org"
export NETWORK_PASSPHRASE="Test SDF Network ; September 2015"
export VESTING_CONTRACT="<your-contract-id>"   # C...
export TOKEN="<your-SAC-token-id>"             # C...
export SPONSOR="default"                        # stellar key name
export RECIPIENT="<G...>"                       # recipient Stellar address
```

### Testnet setup

If you do not have testnet keys yet:

```bash
# Create and fund two keys
stellar keys generate sponsor --network testnet --fund
stellar keys generate recipient --network testnet --fund

# Look up the address for the recipient
stellar keys address recipient
```

---

## 3. Step-by-Step: Setting Up a Stream via Stellar CLI

This walkthrough creates a stream where the recipient must wait 1 day (cliff), then receives tokens linearly over 10 days total.

### 3.1 Confirm the contract is deployed

```bash
stellar contract invoke \
  --id "$VESTING_CONTRACT" \
  --network $NETWORK \
  -- \
  get_min_deposit
```

Expected output: a number (e.g. `100`). If the command errors with "contract not found", the contract has not been deployed to testnet yet. See the [deploy script](../scripts/deploy.sh).

### 3.2 Choose stream parameters

| Parameter | Variable | Value | Meaning |
|---|---|---|---|
| `rate` | `RATE` | `1000000` | 1,000,000 base units per ledger |
| `cliff_duration` | `CLIFF_DURATION` | `17280` | ~1 day (17,280 × 5 s) |
| `total_duration` | `TOTAL_DURATION` | `172800` | ~10 days |

The total deposit the sponsor will pay is `rate × total_duration = 1,000,000 × 172,800 = 172,800,000,000` base units. Ensure the sponsor's account holds at least this amount of the chosen token.

```bash
export RATE=1000000
export CLIFF_DURATION=17280
export TOTAL_DURATION=172800
```

### 3.3 Verify the sponsor has sufficient balance

```bash
stellar contract invoke \
  --id "$TOKEN" \
  --network $NETWORK \
  -- \
  balance \
  --id "$(stellar keys address $SPONSOR)"
```

The returned balance must be ≥ `rate × total_duration`.

### 3.4 Create the stream

```bash
stellar contract invoke \
  --id "$VESTING_CONTRACT" \
  --source "$SPONSOR" \
  --network $NETWORK \
  -- \
  create_vesting_stream \
  --sponsor "$(stellar keys address $SPONSOR)" \
  --recipient "$RECIPIENT" \
  --token "$TOKEN" \
  --rate $RATE \
  --cliff_duration $CLIFF_DURATION \
  --total_duration $TOTAL_DURATION
```

A successful call returns an empty `Ok(())`. The contract:
1. Validates all parameters.
2. Computes `total_deposit = rate × total_duration`.
3. Transfers `total_deposit` tokens from the sponsor to the contract vault.
4. Stores the `VestingSchedule` for the recipient.
5. Emits a `StreamCreated` event.

### 3.5 Verify the stream was created

```bash
stellar contract invoke \
  --id "$VESTING_CONTRACT" \
  --network $NETWORK \
  -- \
  get_schedule \
  --recipient "$RECIPIENT"
```

Expected output:

```json
{
  "version": 1,
  "token": "C...",
  "sponsor": "G...",
  "rate_per_ledger": "1000000",
  "start_ledger": 1234567,
  "cliff_ledger": 1251847,
  "end_ledger": 1407367,
  "last_claimed_ledger": 1234567,
  "total_claimed": "0"
}
```

Note `cliff_ledger` and `end_ledger`: these are absolute ledger numbers, not durations.

### 3.6 Check claimable amount and cliff status

Before the cliff, `claimable_amount` always returns `0`:

```bash
# Returns 0 before the cliff
stellar contract invoke \
  --id "$VESTING_CONTRACT" \
  --network $NETWORK \
  -- \
  claimable_amount \
  --recipient "$RECIPIENT"

# Returns false before the cliff
stellar contract invoke \
  --id "$VESTING_CONTRACT" \
  --network $NETWORK \
  -- \
  is_cliff_passed \
  --recipient "$RECIPIENT"
```

### 3.7 Claim tokens (after the cliff)

Once `is_cliff_passed` returns `true`, the recipient can claim:

```bash
stellar contract invoke \
  --id "$VESTING_CONTRACT" \
  --source "$RECIPIENT" \
  --network $NETWORK \
  -- \
  claim_vested \
  --recipient "$RECIPIENT"
```

The return value is the number of tokens transferred. The first claim after the cliff will be a large lump sum covering all ledgers from `start_ledger` to now — this is the [catch-up claim](glossary.md#catch-up-claim).

### 3.8 Cancel a stream (optional)

The sponsor can cancel at any time. Behaviour depends on whether the cliff has passed:

```bash
stellar contract invoke \
  --id "$VESTING_CONTRACT" \
  --source "$SPONSOR" \
  --network $NETWORK \
  -- \
  cancel_stream \
  --sponsor "$(stellar keys address $SPONSOR)" \
  --recipient "$RECIPIENT"
```

| Cancellation timing | Recipient receives | Sponsor receives |
|---|---|---|
| Before cliff | Nothing | Full deposit |
| After cliff | All accrued-but-unclaimed tokens | Remaining unvested tokens |

Or use the provided helper scripts:

```bash
# Create stream
./scripts/invoke_create.sh

# Claim tokens
./scripts/invoke_claim.sh
```

---

## 4. Step-by-Step: Claiming via the JavaScript SDK

This section shows how to build a claim flow in a TypeScript/JavaScript frontend or backend.

### 4.1 Install and import

```bash
npm install @stellar/stellar-sdk
```

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
} from "@stellar/stellar-sdk";
```

### 4.2 Initialize the RPC client

```typescript
const RPC_URL = "https://soroban-testnet.stellar.org";
const NETWORK_PASSPHRASE = Networks.TESTNET;
const server = new rpc.Server(RPC_URL);

const VESTING_CONTRACT_ID = process.env.VESTING_CONTRACT!;
const contract = new Contract(VESTING_CONTRACT_ID);
```

### 4.3 Query stream state before claiming

Always check the cliff and available balance before building a transaction. These are simulation calls (no fees, no signing).

```typescript
async function getStreamStatus(recipientAddress: string) {
  // Reuse the same source account for view simulations
  const account = await server.getAccount(recipientAddress);

  // Build a simulation tx for claimable_amount
  const claimableTx = new TransactionBuilder(account, {
    fee: "100",
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      contract.call(
        "claimable_amount",
        new Address(recipientAddress).toScVal()
      )
    )
    .setTimeout(30)
    .build();

  // Build a simulation tx for is_cliff_passed
  const cliffTx = new TransactionBuilder(account, {
    fee: "100",
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      contract.call(
        "is_cliff_passed",
        new Address(recipientAddress).toScVal()
      )
    )
    .setTimeout(30)
    .build();

  const [claimableSim, cliffSim] = await Promise.all([
    server.simulateTransaction(claimableTx),
    server.simulateTransaction(cliffTx),
  ]);

  if (
    !rpc.Api.isSimulationSuccess(claimableSim) ||
    !rpc.Api.isSimulationSuccess(cliffSim)
  ) {
    throw new Error("Simulation failed — schedule may not exist");
  }

  const claimable = scValToNative(claimableSim.result!.retval) as bigint;
  const cliffPassed = scValToNative(cliffSim.result!.retval) as boolean;

  return { claimable, cliffPassed };
}
```

### 4.4 Build and submit a claim transaction

```typescript
async function claimVested(recipientKeypair: Keypair): Promise<bigint> {
  const recipientAddress = recipientKeypair.publicKey();

  // Step 1: Pre-flight check
  const { claimable, cliffPassed } = await getStreamStatus(recipientAddress);

  if (!cliffPassed) {
    throw new Error("CLIFF_NOT_REACHED");
  }
  if (claimable === 0n) {
    throw new Error("NOTHING_TO_CLAIM");
  }

  // Step 2: Build the transaction
  const account = await server.getAccount(recipientAddress);
  const tx = new TransactionBuilder(account, {
    fee: "100000", // fee in stroops; bump for congested network
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      contract.call("claim_vested", new Address(recipientAddress).toScVal())
    )
    .setTimeout(30)
    .build();

  // Step 3: Simulate — this resolves the storage footprint and TTL bump
  const preparedTx = await server.prepareTransaction(tx);

  // Step 4: Sign
  preparedTx.sign(recipientKeypair);

  // Step 5: Submit
  const response = await server.sendTransaction(preparedTx);

  if (response.status === "ERROR") {
    throw new Error(`Transaction failed: ${JSON.stringify(response.errorResult)}`);
  }

  // Step 6: Wait for confirmation
  let result = await server.getTransaction(response.hash);
  while (result.status === "NOT_FOUND") {
    await new Promise((r) => setTimeout(r, 1000));
    result = await server.getTransaction(response.hash);
  }

  if (result.status !== "SUCCESS") {
    throw new Error(`Transaction did not succeed: ${result.status}`);
  }

  // Return the claimed amount from the result XDR
  const claimed = scValToNative(result.returnValue!) as bigint;
  return claimed;
}
```

### 4.5 Create a stream programmatically

```typescript
async function createVestingStream(
  sponsorKeypair: Keypair,
  recipientAddress: string,
  tokenAddress: string,
  ratePerLedger: bigint,
  cliffDurationLedgers: number,
  totalDurationLedgers: number
): Promise<string> {
  // Validate locally before submitting to save fees
  if (ratePerLedger <= 0n) throw new Error("Rate must be positive");
  if (totalDurationLedgers <= cliffDurationLedgers) {
    throw new Error("total_duration must exceed cliff_duration");
  }
  if (sponsorKeypair.publicKey() === recipientAddress) {
    throw new Error("Sponsor and recipient must be different addresses");
  }

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

  const preparedTx = await server.prepareTransaction(tx);
  preparedTx.sign(sponsorKeypair);

  const response = await server.sendTransaction(preparedTx);
  if (response.status === "ERROR") {
    throw new Error(`Create stream failed: ${JSON.stringify(response.errorResult)}`);
  }

  return response.hash;
}
```

### 4.6 Display a countdown to the cliff

```typescript
async function getCliffCountdown(
  recipientAddress: string
): Promise<{ ledgersRemaining: number; secondsRemaining: number } | null> {
  const account = await server.getAccount(recipientAddress);
  const scheduleTx = new TransactionBuilder(account, {
    fee: "100",
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      contract.call("get_schedule", new Address(recipientAddress).toScVal())
    )
    .setTimeout(30)
    .build();

  const sim = await server.simulateTransaction(scheduleTx);
  if (!rpc.Api.isSimulationSuccess(sim)) return null;

  const schedule = scValToNative(sim.result!.retval);
  if (!schedule) return null; // no stream

  const latestLedger = await server.getLatestLedger();
  const currentLedger = latestLedger.sequence;

  const cliffLedger = Number(schedule.cliff_ledger);
  const ledgersRemaining = Math.max(0, cliffLedger - currentLedger);
  const secondsRemaining = ledgersRemaining * 5; // ~5 s per ledger

  return { ledgersRemaining, secondsRemaining };
}
```

### 4.7 Display progress in a UI component

```typescript
interface StreamProgress {
  totalDeposit: bigint;
  claimed: bigint;
  claimableNow: bigint;
  percentVested: number; // 0–100
  statusLabel: string;
  statusColor: string;
}

async function getStreamProgress(
  recipientAddress: string
): Promise<StreamProgress | null> {
  const account = await server.getAccount(recipientAddress);

  const statsTx = new TransactionBuilder(account, {
    fee: "100",
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      contract.call("get_stats", new Address(recipientAddress).toScVal())
    )
    .setTimeout(30)
    .build();

  const statusTx = new TransactionBuilder(account, {
    fee: "100",
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      contract.call("get_status", new Address(recipientAddress).toScVal())
    )
    .setTimeout(30)
    .build();

  const [statsSim, statusSim] = await Promise.all([
    server.simulateTransaction(statsTx),
    server.simulateTransaction(statusTx),
  ]);

  if (
    !rpc.Api.isSimulationSuccess(statsSim) ||
    !rpc.Api.isSimulationSuccess(statusSim)
  ) {
    return null;
  }

  const stats = scValToNative(statsSim.result!.retval);
  const status = scValToNative(statusSim.result!.retval);

  if (!stats) return null;

  const STATUS_LABELS: Record<string, { label: string; color: string }> = {
    PreCliff: { label: "Cliff pending",  color: "#F59E0B" },
    Active:   { label: "Active",         color: "#3B82F6" },
    Expired:  { label: "Completed",      color: "#22C55E" },
    Cancelled:{ label: "Cancelled",      color: "#EF4444" },
    NotFound: { label: "Not found",      color: "#6B7280" },
  };

  const { label, color } = STATUS_LABELS[status] ?? STATUS_LABELS.NotFound;

  const totalDeposit = BigInt(stats.total_deposited);
  const claimed = BigInt(stats.total_claimed);
  const percentVested =
    totalDeposit > 0n
      ? Number((claimed * 10000n) / totalDeposit) / 100
      : 0;

  return {
    totalDeposit,
    claimed,
    claimableNow: BigInt(stats.claimable_now),
    percentVested,
    statusLabel: label,
    statusColor: color,
  };
}
```

---

## 5. Error Handling: Mapping Error Codes to UX Messages

Contract errors are returned as `u32` codes inside the Soroban XDR error envelope. The table below maps each code to a user-facing message and the recommended action for your dApp.

### Error code reference

| Code | Name | When it occurs | User-facing message | Recommended dApp action |
|---|---|---|---|---|
| **1** | `ScheduleNotFound` | Calling `claim_vested`, `cancel_stream`, or view functions when no stream exists for the address | "No vesting stream found for this address." | Check the address; the stream may have already been cancelled or completed. |
| **2** | `CliffNotReached` | Calling `claim_vested` before `cliff_ledger` | "Tokens are still locked. Your cliff has not been reached yet." | Show time remaining using `cliff_ledger − current_ledger × 5 s`. Disable the claim button. |
| **3** | `InvalidDuration` | Creating a stream where `total_duration ≤ cliff_duration` | "Stream duration is invalid: the cliff must be shorter than the total vesting period." | Validate inputs before submitting: `total_duration > cliff_duration`. |
| **4** | `InvalidRate` | Creating a stream with `rate ≤ 0` | "Streaming rate must be greater than zero." | Validate that rate is a positive integer before submitting. |
| **5** | `DepositOverflow` | `rate × total_duration` exceeds `i128::MAX` | "The rate or duration is too large. Please use smaller values." | Cap rate at `i128::MAX / total_duration` (≈ `170_141_183_460_469_231_731n / BigInt(totalDuration)` in JS). |
| **6** | `ScheduleAlreadyExists` | Creating a stream for a recipient who already has one | "This address already has an active vesting stream." | Offer to view or cancel the existing stream first. |
| **7** | `NothingToClaim` | Calling `claim_vested` when the claimable amount is zero | "No tokens are available to claim right now." | Call `claimable_amount` before building the transaction; hide or disable the claim button when it returns `0`. |
| **8** | `StreamNotExpired` | Calling `drain_expired_stream` before `end_ledger` | "The stream has not yet expired." | Check `end_ledger < current_ledger` before offering a drain action. |
| **9** | `TransferFailed` | Token transfer rejected by the SAC token contract | "Token transfer failed. Please check the token account is not frozen and the contract vault has sufficient balance." | Verify the token is not frozen or restricted. If this occurs on creation, ensure the sponsor's balance and trustlines are valid. |
| **10** | `DrainDelayNotExpired` | Calling `drain_expired_stream` before 1 year after `end_ledger` | "The drain safety period has not elapsed yet. Please wait approximately 1 year after the stream ended." | Check `current_ledger ≥ end_ledger + 3_153_600` before offering a drain action. |
| **11** | `InvalidRecipient` | Sponsor and recipient are the same address | "The sponsor and recipient must be different addresses." | Validate that sponsor `!== recipient` in your form before submitting. |
| **14** | `DepositBelowMinimum` | Total deposit is below the contract's configured minimum | "The total deposit is below the minimum required. Increase the rate or duration." | Call `get_min_deposit` and validate `rate × total_duration ≥ min_deposit`. |
| **15** | `ClawbackNotSupported` | Calling `clawback_stream` on a token without the SAC clawback flag | "This token does not support compliance clawback." | Only offer clawback UI for tokens you know have the clawback flag enabled. |
| **20** | `MetadataTooLong` | Metadata string exceeds 256 UTF-8 bytes | "The stream description is too long (maximum 256 bytes)." | Measure `new TextEncoder().encode(metadata).length` in JS before submitting. |

### JavaScript error handler

```typescript
function parseVestingError(error: unknown): {
  code: number | null;
  message: string;
} {
  // Soroban SDK wraps contract errors as an object with a `code` property
  const code =
    typeof error === "object" &&
    error !== null &&
    "code" in error
      ? Number((error as { code: unknown }).code)
      : null;

  const UX_MESSAGES: Record<number, string> = {
    1:  "No vesting stream found for this address.",
    2:  "Tokens are still locked — the cliff has not been reached yet.",
    3:  "Invalid stream duration: cliff must be shorter than the total period.",
    4:  "Streaming rate must be greater than zero.",
    5:  "Rate or duration is too large. Please use smaller values.",
    6:  "This address already has an active vesting stream.",
    7:  "No tokens are available to claim right now.",
    8:  "The stream has not yet expired.",
    9:  "Token transfer failed. The token account may be frozen or have insufficient balance.",
    10: "The drain safety period (1 year after stream end) has not elapsed yet.",
    11: "Sponsor and recipient must be different addresses.",
    14: "Total deposit is below the contract minimum. Increase the rate or duration.",
    15: "This token does not support compliance clawback.",
    20: "Stream description is too long (maximum 256 bytes).",
  };

  const message =
    code !== null
      ? UX_MESSAGES[code] ?? `Unexpected contract error (code ${code}).`
      : "An unexpected error occurred. Please try again.";

  return { code, message };
}

// Usage example
async function handleClaim(recipientKeypair: Keypair) {
  try {
    const claimed = await claimVested(recipientKeypair);
    showSuccess(`Claimed ${formatTokens(claimed)} tokens.`);
  } catch (err) {
    const { code, message } = parseVestingError(err);
    showError(message);
    if (code === 2) {
      showCliffCountdown(recipientKeypair.publicKey());
    }
  }
}
```

### Pre-flight validation checklist

Run these checks in your UI before submitting any transaction to avoid paying fees on predictable failures:

```typescript
async function preflightCreateStream(params: {
  sponsorAddress: string;
  recipientAddress: string;
  ratePerLedger: bigint;
  cliffDuration: number;
  totalDuration: number;
  metadata?: string;
}): Promise<string[]> {
  const errors: string[] = [];

  if (params.sponsorAddress === params.recipientAddress) {
    errors.push("Sponsor and recipient must be different addresses.");
  }
  if (params.ratePerLedger <= 0n) {
    errors.push("Rate must be greater than zero.");
  }
  if (params.totalDuration <= params.cliffDuration) {
    errors.push("Total duration must exceed cliff duration.");
  }

  const I128_MAX = 170_141_183_460_469_231_731n;
  const totalDeposit = params.ratePerLedger * BigInt(params.totalDuration);
  if (totalDeposit > I128_MAX) {
    errors.push("Rate × duration overflows i128. Use smaller values.");
  }

  if (params.metadata) {
    const byteLength = new TextEncoder().encode(params.metadata).length;
    if (byteLength > 256) {
      errors.push(`Metadata too long: ${byteLength} bytes (max 256).`);
    }
  }

  // Fetch on-chain minimum deposit
  const account = await server.getAccount(params.sponsorAddress);
  const minDepositTx = new TransactionBuilder(account, {
    fee: "100",
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(contract.call("get_min_deposit"))
    .setTimeout(30)
    .build();

  const sim = await server.simulateTransaction(minDepositTx);
  if (rpc.Api.isSimulationSuccess(sim)) {
    const minDeposit = scValToNative(sim.result!.retval) as bigint;
    if (totalDeposit < minDeposit) {
      errors.push(
        `Total deposit (${totalDeposit}) is below the contract minimum (${minDeposit}).`
      );
    }
  }

  return errors;
}
```

---

## 6. Webhook Integration: Registering and Verifying Events

VestingDrips emits structured events on every state change. You can index them by polling the Stellar RPC `getEvents` endpoint, or by running a backend event listener.

### 6.1 Event overview

All events are published as contract events with two filter-friendly topics: the event type symbol and the recipient address.

| Event symbol | Emitted by | What it means |
|---|---|---|
| `StreamCreated` | `create_vesting_stream` | New stream created |
| `vc_claim` | `claim_vested` | Tokens claimed by recipient |
| `vc_done` | `claim_vested` (final) | Stream fully drained |
| `vc_cancel` | `cancel_stream` | Stream cancelled by sponsor |
| `vc_clawback` | `clawback_stream` | Compliance clawback executed |
| `vc_drain` | `drain_expired_stream` | Expired stream cleaned up |

For the full event structure and XDR field types, see the [Events section of the API reference](api-reference.md#events).

### 6.2 Polling events with the RPC SDK

Use `server.getEvents` to poll for all events on the contract since a given ledger:

```typescript
import { scValToNative } from "@stellar/stellar-sdk";

interface ParsedEvent {
  type: string;
  recipient: string;
  ledger: number;
  data: unknown;
}

async function fetchContractEvents(
  contractId: string,
  startLedger: number,
  limit = 100
): Promise<ParsedEvent[]> {
  const response = await server.getEvents({
    startLedger,
    filters: [
      {
        type: "contract",
        contractIds: [contractId],
        // No topic filter: receive all event types
      },
    ],
    limit,
  });

  return response.events.map((event) => {
    const [typeTopic, recipientTopic] = event.topic;
    return {
      type: String(scValToNative(typeTopic)),
      recipient: String(scValToNative(recipientTopic)),
      ledger: event.ledger,
      data: scValToNative(event.value),
    };
  });
}
```

### 6.3 Filtering events by type

To subscribe to only claim events for a specific recipient:

```typescript
async function fetchClaimEvents(
  contractId: string,
  recipientAddress: string,
  startLedger: number
): Promise<ParsedEvent[]> {
  const response = await server.getEvents({
    startLedger,
    filters: [
      {
        type: "contract",
        contractIds: [contractId],
        topics: [
          // Topic 0: match the "vc_claim" symbol
          ["vc_claim"],
          // Topic 1: match the specific recipient address (as string for filter)
          [new Address(recipientAddress).toString()],
        ],
      },
    ],
    limit: 100,
  });

  return response.events.map((event) => ({
    type: "vc_claim",
    recipient: recipientAddress,
    ledger: event.ledger,
    data: scValToNative(event.value),
  }));
}
```

### 6.4 Building a background event indexer

For a production dApp you will want a persistent indexer that stores events and exposes them via your own HTTP API. A minimal Node.js implementation:

```typescript
import { rpc, scValToNative } from "@stellar/stellar-sdk";

const POLL_INTERVAL_MS = 6000; // slightly above ~5 s ledger time
const CONTRACT_ID = process.env.VESTING_CONTRACT!;

interface EventRecord {
  ledger: number;
  txHash: string;
  eventType: string;
  recipient: string;
  data: unknown;
  indexedAt: string;
}

class VestingEventIndexer {
  private server: rpc.Server;
  private lastIndexedLedger: number;
  private db: EventRecord[] = []; // replace with your actual DB

  constructor(rpcUrl: string, startLedger: number) {
    this.server = new rpc.Server(rpcUrl);
    this.lastIndexedLedger = startLedger;
  }

  async start() {
    console.log(
      `Starting event indexer from ledger ${this.lastIndexedLedger}`
    );
    await this.poll();
  }

  private async poll() {
    try {
      await this.indexNewEvents();
    } catch (err) {
      console.error("Polling error:", err);
    } finally {
      setTimeout(() => this.poll(), POLL_INTERVAL_MS);
    }
  }

  private async indexNewEvents() {
    const latestLedger = await this.server.getLatestLedger();
    if (latestLedger.sequence <= this.lastIndexedLedger) return;

    const response = await this.server.getEvents({
      startLedger: this.lastIndexedLedger + 1,
      filters: [
        {
          type: "contract",
          contractIds: [CONTRACT_ID],
        },
      ],
      limit: 200,
    });

    for (const event of response.events) {
      const [typeTopic, recipientTopic] = event.topic;
      const record: EventRecord = {
        ledger: event.ledger,
        txHash: event.txHash,
        eventType: String(scValToNative(typeTopic)),
        recipient: String(scValToNative(recipientTopic)),
        data: scValToNative(event.value),
        indexedAt: new Date().toISOString(),
      };

      this.db.push(record);
      await this.handleEvent(record);
    }

    // Advance cursor even if no events (avoids re-scanning same ledger range)
    this.lastIndexedLedger = latestLedger.sequence;
    console.log(`Indexed up to ledger ${this.lastIndexedLedger}`);
  }

  private async handleEvent(event: EventRecord) {
    switch (event.eventType) {
      case "StreamCreated":
        console.log(`New stream for ${event.recipient} at ledger ${event.ledger}`);
        await this.notifyWebhooks("stream.created", event);
        break;
      case "vc_claim":
        console.log(`Claim by ${event.recipient}`);
        await this.notifyWebhooks("stream.claimed", event);
        break;
      case "vc_done":
        console.log(`Stream completed for ${event.recipient}`);
        await this.notifyWebhooks("stream.completed", event);
        break;
      case "vc_cancel":
        console.log(`Stream cancelled for ${event.recipient}`);
        await this.notifyWebhooks("stream.cancelled", event);
        break;
      case "vc_clawback":
        console.log(`Clawback on ${event.recipient}`);
        await this.notifyWebhooks("stream.clawed_back", event);
        break;
      case "vc_drain":
        console.log(`Drain on ${event.recipient}`);
        await this.notifyWebhooks("stream.drained", event);
        break;
    }
  }

  private async notifyWebhooks(eventType: string, data: EventRecord) {
    // Dispatch to your registered webhook endpoints
    // See section 6.5 for webhook delivery and verification
  }
}

// Start the indexer
const indexer = new VestingEventIndexer(
  "https://soroban-testnet.stellar.org",
  /* startLedger */ 1234567
);
indexer.start();
```

### 6.5 Delivering and verifying webhook payloads

When delivering events to external webhook consumers, sign the payload so recipients can verify authenticity:

```typescript
import crypto from "crypto";

interface WebhookRegistration {
  url: string;
  secret: string;       // shared secret for HMAC verification
  events: string[];     // e.g. ["stream.created", "stream.claimed"]
}

function signWebhookPayload(payload: string, secret: string): string {
  return crypto
    .createHmac("sha256", secret)
    .update(payload)
    .digest("hex");
}

async function deliverWebhook(
  registration: WebhookRegistration,
  eventType: string,
  data: EventRecord
) {
  if (!registration.events.includes(eventType)) return;

  const payload = JSON.stringify({
    event: eventType,
    contractId: CONTRACT_ID,
    ledger: data.ledger,
    txHash: data.txHash,
    recipient: data.recipient,
    data: data.data,
    timestamp: data.indexedAt,
  });

  const signature = signWebhookPayload(payload, registration.secret);

  const response = await fetch(registration.url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-VestingDrips-Signature": `sha256=${signature}`,
    },
    body: payload,
  });

  if (!response.ok) {
    console.error(
      `Webhook delivery failed to ${registration.url}: ${response.status}`
    );
    // implement retry with exponential backoff
  }
}
```

**On the webhook consumer side**, verify the signature before processing:

```typescript
function verifyWebhookSignature(
  payload: string,
  signatureHeader: string,
  secret: string
): boolean {
  const expected = `sha256=${signWebhookPayload(payload, secret)}`;
  // Use timingSafeEqual to prevent timing attacks
  const a = Buffer.from(signatureHeader);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// Express.js example
app.post("/webhooks/vesting", express.raw({ type: "application/json" }), (req, res) => {
  const signature = req.headers["x-vestingdrips-signature"] as string;
  const isValid = verifyWebhookSignature(
    req.body.toString(),
    signature,
    process.env.WEBHOOK_SECRET!
  );

  if (!isValid) {
    return res.status(401).json({ error: "Invalid signature" });
  }

  const event = JSON.parse(req.body.toString());
  console.log("Verified event:", event.event, "for", event.recipient);

  // Process the event
  res.status(200).json({ ok: true });
});
```

### 6.6 Handling RPC rate limits

The public Stellar RPC endpoints enforce rate limits. For production systems:

```typescript
async function callWithRetry<T>(
  fn: () => Promise<T>,
  maxRetries = 5,
  baseDelayMs = 500
): Promise<T> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err: unknown) {
      const isRateLimit =
        typeof err === "object" &&
        err !== null &&
        "status" in err &&
        (err as { status: number }).status === 429;

      if (isRateLimit && attempt < maxRetries) {
        // Exponential backoff with jitter
        const delay = baseDelayMs * Math.pow(2, attempt) + Math.random() * 100;
        await new Promise((r) => setTimeout(r, delay));
      } else {
        throw err;
      }
    }
  }
  throw new Error("Max retries exceeded");
}

// Example usage
const events = await callWithRetry(() =>
  fetchContractEvents(CONTRACT_ID, startLedger)
);
```

For high-volume production systems, run a dedicated Soroban RPC node or use a paid RPC provider.

---

## 7. Security Checklist for Integrators

Work through this checklist before going live. Each item maps to a real attack vector or failure mode observed in token streaming integrations.

### Authorization

- [ ] **Sponsor signature required for `create_vesting_stream` and `cancel_stream`.** Never submit these transactions without the sponsor keypair; they will fail on-chain.
- [ ] **Recipient signature required for `claim_vested`.** Only the designated recipient can pull funds. Do not attempt to claim on behalf of a user without their explicit authorization via wallet signing.
- [ ] **`drain_expired_stream` is permissionless.** Any account can trigger it after the drain delay. Your backend may run cleanup jobs, but so can others — this is intentional.
- [ ] **Never expose private keys.** All transaction signing should occur in the user's wallet (Freighter, WalletConnect, etc.) or a secured backend KMS, never in browser-side JavaScript.

### Input validation

- [ ] **Validate `total_duration > cliff_duration` before submitting.** Error code 3 will be returned otherwise, wasting transaction fees.
- [ ] **Validate `rate > 0`.** Error code 4.
- [ ] **Validate `sponsor !== recipient`.** Error code 11.
- [ ] **Check `rate × total_duration ≤ i128::MAX`.** Error code 5. In JavaScript: `rate * BigInt(totalDuration) <= 170_141_183_460_469_231_731n`.
- [ ] **Validate against `get_min_deposit()`.** Error code 14. Fetch the minimum once at app startup and cache it.
- [ ] **Metadata is max 256 UTF-8 bytes, not characters.** Measure with `new TextEncoder().encode(metadata).length`.
- [ ] **Metadata is permanently public.** It is stored on-chain and visible to anyone. Never put PII, passwords, private keys, or sensitive compliance information in the metadata field.

### Token handling

- [ ] **All amounts are in base units (stroops for XLM).** Display `amount / 10^decimals` to users. A `rate` of `10_000_000` is 1.0 XLM per ledger, not 10 million XLM.
- [ ] **Verify token is a SAC contract.** The `token` address must be a valid Stellar Asset Contract (`C…` address). Passing a non-SAC address will result in `TransferFailed` (error 9).
- [ ] **Clawback requires SAC clawback flag.** Only attempt `clawback_stream` on tokens whose issuer has enabled the clawback flag. Error code 15 otherwise.
- [ ] **Check sponsor balance before creating stream.** The full deposit (`rate × total_duration`) is transferred immediately on creation. Insufficient balance → `TransferFailed`.
- [ ] **Frozen accounts cause `TransferFailed`.** If the sponsor or recipient account has a freeze flag on the token, transfers will fail silently with error code 9. Handle this gracefully in your UI.

### Stream lifecycle

- [ ] **Call `claimable_amount` or `is_cliff_passed` before building claim transactions.** Submitting a claim before the cliff wastes fees and always fails (error code 2). Gate the claim button behind these view calls.
- [ ] **Handle the cliff catch-up claim.** The first claim after the cliff releases all accrued tokens from `start_ledger`, which may be a large amount. Do not assume the first claim amount equals one ledger's worth of tokens.
- [ ] **Cancellation before cliff means zero for the recipient.** If your UI lets sponsors cancel, clearly warn that pre-cliff cancellation returns the entire deposit to the sponsor.
- [ ] **A completed stream (`vc_done` event) removes the schedule.** After a stream is fully claimed, `get_schedule` returns `None`. Do not error on this — it is the happy path.

### Storage and TTL

- [ ] **Always use `server.prepareTransaction()`.** This simulation step resolves the storage footprint and automatically appends ledger entry TTL extension operations. Skipping it can cause transactions to fail on archived entries.
- [ ] **Active streams bump their own TTL on each claim.** A stream that has been completely unclaimed for more than ~60 days (without any read or write) could have its storage entry archived. Encourage recipients to claim periodically, or build a heartbeat service that calls a view function to bump TTL.
- [ ] **Archived entry errors look like simulation failures.** If `server.prepareTransaction()` succeeds, the SDK has already handled state restoration for you. If simulation fails unexpectedly, check for storage archival before assuming a logic error.

### RPC and network

- [ ] **Use `server.prepareTransaction()` for all state-changing calls.** Raw transactions without simulation will fail to compute fees, resource limits, and footprints.
- [ ] **Implement exponential backoff for RPC calls.** Public RPC endpoints enforce rate limits. See section 6.6 for a reference implementation.
- [ ] **Cache view results with a short TTL (≤ one ledger ≈ 5 s).** `claimable_amount` and `get_schedule` are cheap to call but should not be called on every render cycle.
- [ ] **For production, use a dedicated RPC endpoint.** Public testnet/mainnet RPC nodes are rate-limited and occasionally unavailable. Run your own or use a paid provider for production workloads.
- [ ] **Verify `response.hash` after `sendTransaction`.** The `sendTransaction` call is fire-and-forget on submission. Always poll `server.getTransaction(hash)` until you get a `SUCCESS` or `FAILED` status before updating your UI.

### Event indexing

- [ ] **Store the last indexed ledger in persistent storage.** If your indexer restarts, replay from the last known good ledger to avoid missing events.
- [ ] **Verify webhook signatures with `timingSafeEqual`.** Plain string comparison is vulnerable to timing attacks. Use `crypto.timingSafeEqual` (Node.js) or an equivalent in your language.
- [ ] **Do not trust event data for financial logic.** Events are informational. For any action involving token amounts (e.g. displaying balances, computing claimable), always verify on-chain state via `get_stats` or `claimable_amount` rather than relying solely on event payloads.
- [ ] **The `vc_drain` event can be emitted by anyone.** `drain_expired_stream` is permissionless; monitor for unexpected drain events in your compliance tooling.

---

## Further reading

- [API Reference](api-reference.md) — Complete function signatures, types, and event structures
- [Stream lifecycle and state machine](flows.md) — State diagram, transition table, and error-to-state mapping
- [Glossary](glossary.md) — Definitions for cliff, ledger, SAC, sponsor, catch-up claim, drain delay, and more
- [FAQ](faq.md) — Common questions about stream lifecycle, claiming, fees, and token support
- [Architecture](architecture.md) — Full-stack system design and data flow diagrams

---

**Last updated:** 2026-08-29
