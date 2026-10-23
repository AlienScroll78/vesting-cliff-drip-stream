# Wallet Developer Integration Guide

This guide is written for wallet engineers at projects like **Freighter**, **LOBSTR**, **xBull**,
and similar Stellar wallets. It covers everything needed to surface vesting stream information
and claim functionality natively inside your wallet application.

> **Target audience:** Wallet developers who want to display vesting stream state and enable
> one-click claiming inside the wallet UI.
>
> For dApp developers building stand-alone vesting dashboards, see
> [docs/integration-guide.md](integration-guide.md).
> For the full API reference, see [docs/api-reference.md](api-reference.md).

---

## Table of Contents

1. [Contract ABI — XDR Entry Point Signatures](#1-contract-abi--xdr-entry-point-signatures)
2. [View Functions — Simulating Without Submitting a Transaction](#2-view-functions--simulating-without-submitting-a-transaction)
3. [Transaction Construction — Building a Claim](#3-transaction-construction--building-a-claim)
4. [Event Subscription — Listening via Horizon](#4-event-subscription--listening-via-horizon)
5. [Error Codes — Human-Readable Messages](#5-error-codes--human-readable-messages)
6. [Testnet Contract ID](#6-testnet-contract-id)
7. [SDK Examples](#7-sdk-examples)

---

## 1. Contract ABI — XDR Entry Point Signatures

All entry points follow the standard Soroban contract ABI. The function names below correspond
to the symbols exported in the compiled WASM. Parameter and return types use Soroban XDR
encoding.

### `get_schedule(recipient: Address) → Option<VestingSchedule>`

| Parameter | XDR type | Description |
|-----------|----------|-------------|
| `recipient` | `ScVal::Address` | The wallet address to look up |

Return value: `ScVal::Map` (the `VestingSchedule` struct) or `ScVal::Void` if no stream exists.

**`VestingSchedule` map keys** (all `ScVal::Symbol` keys, values as listed):

| Key | XDR value type | Description |
|-----|---------------|-------------|
| `token` | `ScVal::Address` | SAC token contract address |
| `rate_per_ledger` | `ScVal::I128` | Tokens dripped per ledger |
| `start_ledger` | `ScVal::U32` | Ledger at which streaming begins |
| `cliff_ledger` | `ScVal::U32` | Ledger at which cliff unlocks |
| `end_ledger` | `ScVal::U32` | Ledger at which streaming ends |
| `last_claimed_ledger` | `ScVal::U32` | Last ledger at which tokens were claimed |
| `sponsor` | `ScVal::Address` | Address that funded the stream |

### `claimable_amount(recipient: Address) → i128`

Returns the number of tokens claimable right now. Returns `0` before the cliff.

| Parameter | XDR type |
|-----------|----------|
| `recipient` | `ScVal::Address` |

Return: `ScVal::I128`

### `is_cliff_passed(recipient: Address) → bool`

Returns `true` if the current ledger ≥ `cliff_ledger`.

| Parameter | XDR type |
|-----------|----------|
| `recipient` | `ScVal::Address` |

Return: `ScVal::Bool`

### `claim_vested(recipient: Address) → i128`

**State-mutating.** Transfers claimable tokens to the recipient. Requires the recipient to sign.

| Parameter | XDR type |
|-----------|----------|
| `recipient` | `ScVal::Address` |

Return: `ScVal::I128` — amount transferred. Fails with `CliffNotReached` (error code 2) if
called before the cliff.

### `get_min_deposit() → i128`

Returns the current minimum total deposit threshold.

Return: `ScVal::I128`

---

## 2. View Functions — Simulating Without Submitting a Transaction

View functions (`get_schedule`, `claimable_amount`, `is_cliff_passed`, `get_min_deposit`) can be
called using Soroban's `simulateTransaction` RPC method. This does **not** consume fees, does
**not** require the user to sign, and does **not** submit anything to the network.

### JavaScript (Stellar SDK v12+)

```js
import {
  Contract,
  Networks,
  TransactionBuilder,
  Address,
  xdr,
  scValToNative,
  rpc,
} from "@stellar/stellar-sdk";

const RPC_URL = "https://soroban-testnet.stellar.org";
const CONTRACT_ID = "CXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX";

const server = new rpc.Server(RPC_URL);

/**
 * Fetch the vesting schedule for a wallet address.
 * Returns null if no stream exists for this address.
 */
async function getSchedule(recipientAddress) {
  // simulateTransaction needs a source account but it won't be charged
  const sourceAccount = await server.getAccount(recipientAddress);

  const contract = new Contract(CONTRACT_ID);
  const tx = new TransactionBuilder(sourceAccount, {
    fee: "100",
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(
      contract.call(
        "get_schedule",
        xdr.ScVal.scvAddress(
          Address.fromString(recipientAddress).toScAddress()
        )
      )
    )
    .setTimeout(30)
    .build();

  const simulation = await server.simulateTransaction(tx);

  if (!rpc.Api.isSimulationSuccess(simulation)) {
    throw new Error(`Simulation failed: ${JSON.stringify(simulation)}`);
  }

  const result = scValToNative(simulation.result.retval);
  // result is null (Void) if no schedule, or a plain JS object otherwise
  return result ?? null;
}

/**
 * Returns the number of tokens the wallet can claim right now.
 * Returns 0n (BigInt) before the cliff.
 */
async function getClaimableAmount(recipientAddress) {
  const sourceAccount = await server.getAccount(recipientAddress);
  const contract = new Contract(CONTRACT_ID);

  const tx = new TransactionBuilder(sourceAccount, {
    fee: "100",
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(
      contract.call(
        "claimable_amount",
        xdr.ScVal.scvAddress(
          Address.fromString(recipientAddress).toScAddress()
        )
      )
    )
    .setTimeout(30)
    .build();

  const simulation = await server.simulateTransaction(tx);
  if (!rpc.Api.isSimulationSuccess(simulation)) return 0n;

  return scValToNative(simulation.result.retval); // BigInt
}

/**
 * Returns true if the cliff ledger has been reached.
 */
async function isCliffPassed(recipientAddress) {
  const sourceAccount = await server.getAccount(recipientAddress);
  const contract = new Contract(CONTRACT_ID);

  const tx = new TransactionBuilder(sourceAccount, {
    fee: "100",
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(
      contract.call(
        "is_cliff_passed",
        xdr.ScVal.scvAddress(
          Address.fromString(recipientAddress).toScAddress()
        )
      )
    )
    .setTimeout(30)
    .build();

  const simulation = await server.simulateTransaction(tx);
  if (!rpc.Api.isSimulationSuccess(simulation)) return false;

  return scValToNative(simulation.result.retval); // boolean
}
```

### Python (stellar-sdk v9+)

```python
from stellar_sdk import SorobanServer, Keypair, TransactionBuilder, Network
from stellar_sdk.soroban_rpc import SimulateTransactionResponse
from stellar_sdk import xdr as stellar_xdr
from stellar_sdk.type_checked import Address

RPC_URL = "https://soroban-testnet.stellar.org"
CONTRACT_ID = "CXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"

server = SorobanServer(RPC_URL)


def get_claimable_amount(recipient_address: str) -> int:
    """Return the number of tokens claimable right now. Returns 0 before the cliff."""
    source = server.load_account(recipient_address)
    contract = server.get_contract(CONTRACT_ID)

    tx = (
        TransactionBuilder(
            source_account=source,
            network_passphrase=Network.TESTNET_NETWORK_PASSPHRASE,
            base_fee=100,
        )
        .append_invoke_contract_function_op(
            contract_id=CONTRACT_ID,
            function_name="claimable_amount",
            parameters=[Address(recipient_address).to_xdr_sc_val()],
        )
        .set_timeout(30)
        .build()
    )

    response: SimulateTransactionResponse = server.simulate_transaction(tx)
    if response.error:
        return 0

    # The result is an i128 ScVal; convert to Python int
    return int(response.results[0].xdr)
```

---

## 3. Transaction Construction — Building a Claim

`claim_vested` is state-mutating and requires the recipient's signature. The recommended flow is:

1. **Simulate** the transaction to get the resource footprint (Soroban requires this).
2. **Prepare** the transaction using the simulation response.
3. **Sign** using the user's wallet (Freighter, LOBSTR WalletConnect, etc.).
4. **Submit** to the network and wait for the transaction to land.

### Step-by-step JavaScript

```js
import {
  Contract,
  Networks,
  TransactionBuilder,
  Address,
  xdr,
  assembleTransaction,
  rpc,
} from "@stellar/stellar-sdk";

/**
 * Build, sign (via Freighter), and submit a claim_vested transaction.
 *
 * @param {string} recipientAddress - The G... address of the recipient
 * @returns {string} The transaction hash on success
 */
async function claimVested(recipientAddress) {
  const server = new rpc.Server(RPC_URL);
  const contract = new Contract(CONTRACT_ID);

  // 1. Load the recipient's account sequence number
  const sourceAccount = await server.getAccount(recipientAddress);

  // 2. Build the unsigned transaction
  const tx = new TransactionBuilder(sourceAccount, {
    fee: "100",
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(
      contract.call(
        "claim_vested",
        xdr.ScVal.scvAddress(
          Address.fromString(recipientAddress).toScAddress()
        )
      )
    )
    .setTimeout(30)
    .build();

  // 3. Simulate to get the resource footprint — required for Soroban
  const simulation = await server.simulateTransaction(tx);
  if (!rpc.Api.isSimulationSuccess(simulation)) {
    const errCode = extractErrorCode(simulation);
    throw new Error(`Simulation failed: ${VESTING_ERROR_MESSAGES[errCode] ?? simulation.error}`);
  }

  // 4. Assemble the transaction with the simulated resource data
  const preparedTx = assembleTransaction(tx, simulation).build();

  // 5. Sign using Freighter (or any Stellar wallet)
  //    Freighter returns the signed XDR string
  const { signedXDR } = await window.freighter.signTransaction(
    preparedTx.toXDR(),
    { networkPassphrase: Networks.TESTNET }
  );

  // 6. Submit the signed transaction
  const result = await server.sendTransaction(
    TransactionBuilder.fromXDR(signedXDR, Networks.TESTNET)
  );

  if (result.status === "ERROR") {
    throw new Error(`Transaction failed: ${result.errorResult}`);
  }

  // 7. Poll for the final transaction result
  let txResult;
  do {
    await new Promise((r) => setTimeout(r, 1000));
    txResult = await server.getTransaction(result.hash);
  } while (txResult.status === rpc.Api.GetTransactionStatus.NOT_FOUND);

  if (txResult.status !== rpc.Api.GetTransactionStatus.SUCCESS) {
    throw new Error(`Transaction did not succeed: ${JSON.stringify(txResult)}`);
  }

  return result.hash;
}

/** Extract numeric error code from a failed simulation result. */
function extractErrorCode(simulation) {
  try {
    const xdrError = simulation.result?.retval;
    if (!xdrError) return null;
    const val = xdr.ScVal.fromXDR(xdrError, "base64");
    if (val.switch().name === "scvError") {
      return val.error().code().value;
    }
  } catch (_) {}
  return null;
}
```

---

## 4. Event Subscription — Listening via Horizon

The contract emits structured events for every state transition. Use Horizon's
`/contracts/:id/events` endpoint to poll for new events, or use a streaming connection.

### Event types

| Event topic | When emitted | Key fields |
|-------------|-------------|-----------|
| `StreamCreated` | `create_vesting_stream` succeeds | `recipient`, `sponsor`, `token`, `rate`, `cliff_ledger`, `end_ledger` |
| `TokensClaimed` | `claim_vested` succeeds | `recipient`, `amount`, `ledger` |
| `StreamCancelled` | `cancel_stream` succeeds | `recipient`, `sponsor`, `refund_amount` |
| `StreamClawedBack` | `clawback_stream` succeeds | `recipient`, `sponsor`, `reason` |
| `StreamDrained` | `drain_expired_stream` succeeds | `recipient`, `sponsor`, `drained_amount` |
| `UpgradeApplied` | Contract upgrade executed | `new_wasm_hash` |

### Polling with the Horizon REST API

```js
const HORIZON_URL = "https://horizon-testnet.stellar.org";
const CONTRACT_ID = "CXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX";

/**
 * Fetch the most recent events for this contract.
 * @param {string} cursor - Paging token from the last response (or "now" for latest)
 */
async function fetchContractEvents(cursor = "0") {
  const url = new URL(`${HORIZON_URL}/contracts/${CONTRACT_ID}/events`);
  url.searchParams.set("limit", "20");
  url.searchParams.set("order", "asc");
  if (cursor !== "0") url.searchParams.set("cursor", cursor);

  const response = await fetch(url.toString());
  if (!response.ok) throw new Error(`Horizon error: ${response.status}`);

  const data = await response.json();
  const records = data._embedded?.records ?? [];

  for (const record of records) {
    const topics = record.topic ?? [];
    const eventType = topics[0]; // first topic is the event name symbol
    console.log("Event:", eventType, record.value);
  }

  // Return the paging token of the last record for the next poll
  const last = records[records.length - 1];
  return last?.paging_token ?? cursor;
}

// Poll every 5 seconds
async function startEventPolling(onEvent) {
  let cursor = "0";
  while (true) {
    cursor = await fetchContractEvents(cursor);
    await new Promise((r) => setTimeout(r, 5000));
  }
}
```

### Streaming (SSE)

```js
const eventSource = new EventSource(
  `${HORIZON_URL}/contracts/${CONTRACT_ID}/events?cursor=now`
);

eventSource.addEventListener("message", (event) => {
  const record = JSON.parse(event.data);
  const eventType = record.topic?.[0];
  // Handle event by type
  if (eventType === "StreamCreated") { /* show notification */ }
  if (eventType === "TokensClaimed") { /* update balance display */ }
});

eventSource.addEventListener("error", () => {
  // Reconnect logic here
  eventSource.close();
});
```

---

## 5. Error Codes — Human-Readable Messages

When `simulateTransaction` or `sendTransaction` returns an error, extract the numeric code from
the `ScError` value and map it to a user-facing message.

```js
/** Map VestingError codes to wallet-facing strings. */
const VESTING_ERROR_MESSAGES = {
  1:  "No active vesting stream found for this address.",
  2:  "The cliff period has not ended yet — tokens are still locked.",
  3:  "Invalid stream duration.",
  4:  "Invalid token rate.",
  5:  "Deposit amount overflow.",
  6:  "A vesting stream already exists for this address.",
  7:  "No tokens available to claim right now.",
  8:  "The stream has not expired yet.",
  9:  "Token transfer failed — check that the contract holds sufficient balance.",
  10: "The one-year drain delay has not passed yet.",
  11: "The sponsor and recipient cannot be the same address.",
  12: "Cliff duration must be greater than zero.",
  13: "Contract is already initialised.",
  14: "This address is not on the recipient allowlist.",
  15: "This stream is currently paused.",
  16: "Batch size exceeds the maximum of 20.",
  17: "The deposit rate is below the configured minimum.",
  18: "Contract has not been initialised.",
  19: "Variable-rate segment configuration is invalid.",
  20: "Metadata string exceeds 256 bytes.",
  21: "Caller is not authorised to perform this action.",
  22: "Total deposit is below the configured minimum.",
  23: "This stream is already paused.",
  24: "This stream is not paused.",
  25: "Version counter overflow.",
  26: "This token does not support clawback.",
};

/**
 * Returns a user-friendly error message for a failed contract invocation.
 * Falls back to a generic message if the code is unrecognised.
 */
function getErrorMessage(errorCode) {
  return (
    VESTING_ERROR_MESSAGES[errorCode] ??
    "An unexpected error occurred. Please try again or contact support."
  );
}
```

### Python equivalent

```python
VESTING_ERROR_MESSAGES = {
    1:  "No active vesting stream found for this address.",
    2:  "The cliff period has not ended yet — tokens are still locked.",
    3:  "Invalid stream duration.",
    4:  "Invalid token rate.",
    5:  "Deposit amount overflow.",
    6:  "A vesting stream already exists for this address.",
    7:  "No tokens available to claim right now.",
    8:  "The stream has not expired yet.",
    9:  "Token transfer failed.",
    10: "The one-year drain delay has not passed yet.",
    11: "Sponsor and recipient cannot be the same address.",
    12: "Cliff duration must be greater than zero.",
    13: "Contract already initialised.",
    14: "Address not on recipient allowlist.",
    15: "This stream is currently paused.",
    16: "Batch size exceeds the maximum of 20.",
    17: "Deposit rate is below the configured minimum.",
    18: "Contract not yet initialised.",
    19: "Invalid variable-rate segment configuration.",
    20: "Metadata exceeds 256 bytes.",
    21: "Caller is not authorised.",
    22: "Total deposit is below the configured minimum.",
    23: "Stream is already paused.",
    24: "Stream is not paused.",
    25: "Version counter overflow.",
    26: "Token does not support clawback.",
}


def get_error_message(error_code: int) -> str:
    return VESTING_ERROR_MESSAGES.get(
        error_code,
        "An unexpected error occurred. Please try again or contact support.",
    )
```

---

## 6. Testnet Contract ID

Use the following contract ID for development and integration testing against the Stellar testnet.

| Network | Contract ID |
|---------|------------|
| Testnet | `CDRIP5TESTCONTRACTIDPLACEHOLDERXXXXXXXXXXXXXXXXXXXXXXXX` |
| Mainnet | Contact the VestingDrips team for the production contract ID |

> **Note:** Testnet state is periodically reset during Stellar network upgrades.
> Subscribe to the [Stellar Developer Discord](https://discord.gg/stellardev) `#testnet-resets`
> channel for advance notice.

### Verify the contract is live

```bash
stellar contract info \
  --id CDRIP5TESTCONTRACTIDPLACEHOLDERXXXXXXXXXXXXXXXXXXXXXXXX \
  --network testnet
```

---

## 7. SDK Examples

### Displaying vesting state in a wallet UI (JavaScript)

```js
import { formatUnits } from "./utils"; // your token decimal formatter

/**
 * Returns a summary suitable for displaying in a wallet stream tile.
 *
 * @param {string} recipientAddress
 * @param {number} tokenDecimals - e.g. 7 for most Stellar tokens
 */
async function buildStreamTile(recipientAddress, tokenDecimals = 7) {
  const [schedule, claimable, cliffPassed] = await Promise.all([
    getSchedule(recipientAddress),
    getClaimableAmount(recipientAddress),
    isCliffPassed(recipientAddress),
  ]);

  if (!schedule) {
    return null; // no stream for this address
  }

  const ledgersPerSecond = 5;
  const now = Math.floor(Date.now() / 1000);
  const secondsUntilCliff = cliffPassed
    ? 0
    : (Number(schedule.cliff_ledger) - (now / ledgersPerSecond));

  return {
    status: cliffPassed ? "Active" : "Cliff pending",
    claimableDisplay: formatUnits(claimable, tokenDecimals),
    claimableRaw: claimable,
    cliffLedger: schedule.cliff_ledger,
    endLedger: schedule.end_ledger,
    ratePerLedger: schedule.rate_per_ledger,
    secondsUntilCliff: Math.max(0, secondsUntilCliff),
    canClaim: cliffPassed && claimable > 0n,
  };
}
```

### Wallet notification on new stream (JavaScript)

```js
/**
 * Poll for new StreamCreated events and notify the user if the current
 * wallet address is the recipient.
 *
 * @param {string} walletAddress - The currently connected wallet address
 * @param {function} notify - Wallet notification function (title, body)
 */
async function watchForNewStream(walletAddress, notify) {
  let cursor = "0";

  setInterval(async () => {
    try {
      const url = new URL(`${HORIZON_URL}/contracts/${CONTRACT_ID}/events`);
      url.searchParams.set("limit", "20");
      url.searchParams.set("order", "asc");
      if (cursor !== "0") url.searchParams.set("cursor", cursor);

      const res = await fetch(url.toString());
      const data = await res.json();
      const records = data._embedded?.records ?? [];

      for (const record of records) {
        const [eventName, recipient] = record.topic ?? [];
        if (
          eventName === "StreamCreated" &&
          recipient === walletAddress
        ) {
          notify(
            "New vesting stream created",
            "You have a new token vesting stream. Tokens will unlock at the cliff ledger."
          );
        }
        cursor = record.paging_token;
      }
    } catch (err) {
      console.warn("Event polling error:", err);
    }
  }, 10_000); // poll every 10 s
}
```

### Python: check claimable and print summary

```python
from stellar_sdk import SorobanServer, Network
from stellar_sdk.soroban_rpc import SimulateTransactionResponse

RPC_URL = "https://soroban-testnet.stellar.org"
CONTRACT_ID = "CXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"

server = SorobanServer(RPC_URL)


def print_stream_summary(recipient_address: str, token_decimals: int = 7) -> None:
    """Print a vesting stream summary for the given address."""
    schedule = get_schedule(recipient_address)          # from section 2
    claimable = get_claimable_amount(recipient_address) # from section 2

    if schedule is None:
        print(f"No vesting stream found for {recipient_address}")
        return

    human_claimable = claimable / (10 ** token_decimals)
    status = "Active" if claimable > 0 else "Cliff pending"

    print(f"Address:    {recipient_address}")
    print(f"Status:     {status}")
    print(f"Claimable:  {human_claimable:.{token_decimals}f} tokens")
    print(f"Cliff:      ledger {schedule['cliff_ledger']}")
    print(f"End:        ledger {schedule['end_ledger']}")
```

---

## Further Reading

- [Full API Reference](api-reference.md) — Complete entry-point documentation with all parameters
- [Integration Guide for dApp Developers](integration-guide.md) — CLI and backend integration
- [Wallet Integration (JavaScript SDK deep-dive)](wallet-integration.md) — Extended SDK examples
- [Error Handling](error-handling.md) — Full error code reference with recovery guidance
- [Glossary](glossary.md) — Definitions for cliff, ledger, sponsor, and other domain terms
- [flows.md](flows.md) — Full stream lifecycle state diagram
