# Wallet Integration Guide

This guide explains how to integrate the Vesting Cliff Drip Stream contract into wallet UIs using the Stellar JavaScript SDK.

---

## Prerequisites

```bash
npm install @stellar/stellar-sdk
```

---

## Reading a Vesting Schedule

Use `get_schedule` to fetch a recipient's full schedule and derive cliff/stream status.

```js
import { Contract, Networks, rpc } from "@stellar/stellar-sdk";

const server = new rpc.Server("https://soroban-testnet.stellar.org");
const contractId = "C..."; // deployed contract address

async function getSchedule(recipientAddress) {
  const contract = new Contract(contractId);

  const tx = await server.simulateTransaction(
    new TransactionBuilder(/* sourceAccount */, { fee: "100", networkPassphrase: Networks.TESTNET })
      .addOperation(contract.call("get_schedule", ...[xdr.ScVal.scvAddress(Address.fromString(recipientAddress).toScAddress())]))
      .setTimeout(30)
      .build()
  );

  if (rpc.Api.isSimulationSuccess(tx)) {
    const result = scValToNative(tx.result.retval);
    return result; // null if no schedule, otherwise the VestingSchedule object
  }
  return null;
}
```

The returned object has this shape:

```js
{
  token: "C...",           // SAC token address
  rate_per_ledger: 10n,    // BigInt — tokens per ledger
  start_ledger: 1234567,
  cliff_ledger: 1251847,   // start_ledger + cliff_duration
  end_ledger:  1406567,    // start_ledger + total_duration
  last_claimed_ledger: 1234567
}
```

---

## Displaying Cliff Status

```js
async function getCliffStatus(recipientAddress) {
  const contract = new Contract(contractId);

  const tx = await server.simulateTransaction(
    new TransactionBuilder(/* sourceAccount */, { fee: "100", networkPassphrase: Networks.TESTNET })
      .addOperation(contract.call("is_cliff_passed", ...[xdr.ScVal.scvAddress(Address.fromString(recipientAddress).toScAddress())]))
      .setTimeout(30)
      .build()
  );

  if (rpc.Api.isSimulationSuccess(tx)) {
    return scValToNative(tx.result.retval); // true / false
  }
  return false;
}

// Example UI usage
const cliffPassed = await getCliffStatus(recipientAddress);
if (!cliffPassed) {
  // Show countdown using schedule.cliff_ledger vs current ledger
  // Stellar averages ~5 seconds per ledger
  const ledgersRemaining = schedule.cliff_ledger - currentLedger;
  const secondsRemaining = ledgersRemaining * 5;
  displayCountdown(secondsRemaining);
} else {
  displayClaimButton();
}
```

---

## Displaying Claimable Balance

```js
async function getClaimableAmount(recipientAddress) {
  const contract = new Contract(contractId);

  const tx = await server.simulateTransaction(
    new TransactionBuilder(/* sourceAccount */, { fee: "100", networkPassphrase: Networks.TESTNET })
      .addOperation(contract.call("claimable_amount", ...[xdr.ScVal.scvAddress(Address.fromString(recipientAddress).toScAddress())]))
      .setTimeout(30)
      .build()
  );

  if (rpc.Api.isSimulationSuccess(tx)) {
    return scValToNative(tx.result.retval); // i128 as BigInt, 0 before cliff
  }
  return 0n;
}
```

Returns `0n` if the cliff has not been reached. Display this value in your token's decimal units.

---

## Freighter Integration

[Freighter](https://www.freighter.app/) is the leading Stellar browser extension wallet.

```js
import freighterApi from "@stellar/freighter-api";
import { TransactionBuilder, Networks, Contract, Address, xdr, scValToNative, rpc } from "@stellar/stellar-sdk";

async function claimWithFreighter(contractId, recipientAddress) {
  // 1. Request user's public key
  const { address } = await freighterApi.getAddress();

  // 2. Build the claim transaction
  const server = new rpc.Server("https://soroban-testnet.stellar.org");
  const sourceAccount = await server.getAccount(address);
  const contract = new Contract(contractId);

  let tx = new TransactionBuilder(sourceAccount, {
    fee: "100",
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(
      contract.call(
        "claim_vested",
        xdr.ScVal.scvAddress(Address.fromString(recipientAddress).toScAddress())
      )
    )
    .setTimeout(30)
    .build();

  // 3. Simulate to get footprint
  const simResult = await server.simulateTransaction(tx);
  if (!rpc.Api.isSimulationSuccess(simResult)) {
    throw new Error("Simulation failed: " + simResult.error);
  }
  tx = rpc.assembleTransaction(tx, simResult).build();

  // 4. Sign with Freighter
  const { signedTxXdr } = await freighterApi.signTransaction(tx.toXDR(), {
    networkPassphrase: Networks.TESTNET,
  });

  // 5. Submit
  const result = await server.sendTransaction(
    TransactionBuilder.fromXDR(signedTxXdr, Networks.TESTNET)
  );
  return result;
}
```

---

## Albedo Integration

[Albedo](https://albedo.link/) provides web-based transaction signing without a browser extension.

```js
import albedo from "@albedo-link/intent";
import { TransactionBuilder, Networks, Contract, Address, xdr, rpc } from "@stellar/stellar-sdk";

async function claimWithAlbedo(contractId, recipientAddress, userPublicKey) {
  const server = new rpc.Server("https://soroban-testnet.stellar.org");
  const sourceAccount = await server.getAccount(userPublicKey);
  const contract = new Contract(contractId);

  // 1. Build transaction
  let tx = new TransactionBuilder(sourceAccount, {
    fee: "100",
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(
      contract.call(
        "claim_vested",
        xdr.ScVal.scvAddress(Address.fromString(recipientAddress).toScAddress())
      )
    )
    .setTimeout(30)
    .build();

  // 2. Simulate
  const simResult = await server.simulateTransaction(tx);
  if (!rpc.Api.isSimulationSuccess(simResult)) {
    throw new Error("Simulation failed: " + simResult.error);
  }
  tx = rpc.assembleTransaction(tx, simResult).build();

  // 3. Sign with Albedo
  const { signed_envelope_xdr } = await albedo.tx({
    xdr: tx.toXDR(),
    network: "testnet",
    submit: false,
  });

  // 4. Submit
  const result = await server.sendTransaction(
    TransactionBuilder.fromXDR(signed_envelope_xdr, Networks.TESTNET)
  );
  return result;
}
```

---

## Error Handling

Map contract error codes to user-friendly messages:

```js
const VESTING_ERRORS = {
  1: "No vesting schedule found for this address.",
  2: "Cliff period has not been reached yet.",
  3: "Invalid stream duration.",
  4: "Invalid token rate.",
  5: "Deposit amount overflow.",
  6: "A vesting stream already exists for this recipient.",
  7: "No tokens available to claim right now.",
};

function parseVestingError(error) {
  const match = error?.message?.match(/Error\(Contract, #(\d+)\)/);
  if (match) return VESTING_ERRORS[match[1]] ?? "Unknown contract error.";
  return error?.message ?? "Transaction failed.";
}
```

---

## Integration Support

For integration questions, open an issue in the [GitHub repository](https://github.com/your-org/vesting-cliff-drip-stream/issues) with the label **`wallet-integration`**.
