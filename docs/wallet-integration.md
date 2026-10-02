# Wallet Integration Guide

This guide explains how to integrate the Vesting Cliff Drip Stream contract into wallet UIs using the Stellar JavaScript SDK.

See also: `docs/integration-guide.md` and `docs/architecture.md` for overall project setup.

---

## Prerequisites

```bash
npm install @stellar/stellar-sdk
# For Freighter:
npm install @stellar/freighter-api
# For Lobstr (WalletConnect):
npm install @walletconnect/modal @walletconnect/sign-client
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

## Wallet Selection and Detection

Before performing any wallet-specific operation, detect which wallets are available and let the user choose.

```js
/**
 * Detect installed Stellar wallets.
 * Returns an object indicating which wallets are available.
 */
function detectWallets() {
  return {
    freighter: typeof window !== "undefined" && !!window.freighterApi,
    lobster: true, // Lobstr connects via WalletConnect — always "available" on supported browsers
  };
}
```

### Wallet Priority Order

| Priority | Wallet | Platform | Connection Type |
|----------|--------|----------|-----------------|
| 1 | Freighter | Desktop (browser extension) | Direct API |
| 2 | Lobstr | Mobile / Desktop | WalletConnect |
| 3 | Albedo | Desktop (web fallback) | Redirect |

---

## Freighter Integration

[Freighter](https://www.freighter.app/) is the leading Stellar browser extension wallet.

### Extension Detection

```js
/**
 * Check if the Freighter browser extension is installed and unlocked.
 * Returns the public key if connected, or throws a descriptive error.
 */
async function ensureFreighterConnected() {
  try {
    const { address } = await freighterApi.getAddress();
    return address;
  } catch (err) {
    if (err.message?.includes("not installed") || err.message?.includes("not found")) {
      throw new WalletError("FREIGHTER_NOT_INSTALLED", "Freighter extension is not installed. Please install it from https://www.freighter.app/.");
    }
    if (err.message?.includes("locked")) {
      throw new WalletError("WALLET_LOCKED", "Freighter is locked. Please unlock it and try again.");
    }
    throw new WalletError("FREIGHTER_CONNECT_FAILED", "Could not connect to Freighter: " + err.message);
  }
}
```

### Testnet / Mainnet Toggle

Freighter automatically uses the network selected in the extension settings. Always verify the active network matches your expected passphrase:

```js
import freighterApi from "@stellar/freighter-api";
import { Networks } from "@stellar/stellar-sdk";

/**
 * Verify that Freighter's active network matches the target passphrase.
 */
async function verifyFreighterNetwork(expectedPassphrase) {
  const activeNetwork = await freighterApi.getNetwork();
  const activePassphrase = activeNetwork.networkPassphrase;

  if (activePassphrase !== expectedPassphrase) {
    throw new WalletError(
      "NETWORK_MISMATCH",
      `Freighter is on ${activePassphrase} but this dApp requires ${expectedPassphrase}. ` +
      "Switch the network in Freighter's settings and try again."
    );
  }
}

// Usage — ensure testnet before signing
await verifyFreighterNetwork(Networks.TESTNET);
```

### Signing and Submitting

```js
import freighterApi from "@stellar/freighter-api";
import { TransactionBuilder, Networks, Contract, Address, xdr, scValToNative, rpc } from "@stellar/stellar-sdk";

async function claimWithFreighter(contractId, recipientAddress) {
  // 1. Detect and connect
  const address = await ensureFreighterConnected();

  // 2. Verify network
  await verifyFreighterNetwork(Networks.TESTNET);

  // 3. Build the claim transaction
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

  // 4. Simulate to get footprint
  const simResult = await server.simulateTransaction(tx);
  if (!rpc.Api.isSimulationSuccess(simResult)) {
    throw new Error("Simulation failed: " + simResult.error);
  }
  tx = rpc.assembleTransaction(tx, simResult).build();

  // 5. Sign with Freighter
  const { signedTxXdr } = await freighterApi.signTransaction(tx.toXDR(), {
    networkPassphrase: Networks.TESTNET,
  });

  // 6. Submit
  const result = await server.sendTransaction(
    TransactionBuilder.fromXDR(signedTxXdr, Networks.TESTNET)
  );
  return result;
}
```

### Freighter-Specific Notes

- **Popup blocking**: Freighter opens a popup for signing. Ensure your browser allows popups from your dApp origin.
- **Session persistence**: `getAddress()` returns a cached address if the user previously granted access. Call `disconnect()` to clear the session.
- **Multiple accounts**: Freighter supports multiple accounts. `getAddress()` returns the currently active one. To let users switch, prompt them to change the active account in the extension before calling `getAddress()` again.

---

## Lobstr Integration

[Lobstr](https://lobstr.co/) is a popular Stellar wallet available on iOS, Android, and as a web app. It connects via the [WalletConnect](https://walletconnect.com/) protocol.

### WalletConnect Protocol Overview

WalletConnect establishes an encrypted bridge between your dApp and the Lobstr wallet:

1. **dApp generates a pairing URI** — a `wc:` deep link.
2. **User scans QR code** (desktop) or **is redirected** (mobile).
3. **Session is established** — the dApp can now send signing requests to Lobstr.
4. **Signing requests** are forwarded to the Lobstr app for user approval.

### QR Code Flow (Desktop)

```js
import SignClient from "@walletconnect/sign-client";
import { WalletConnectModal } from "@walletconnect/modal";

const PROJECT_ID = "YOUR_WALLETCONNECT_PROJECT_ID"; // Get from https://cloud.walletconnect.com

let signClient;
let session;

/**
 * Initialise the WalletConnect sign client and open the QR modal.
 * Returns the active session.
 */
async function connectLobstrDesktop() {
  // 1. Create the SignClient
  signClient = await SignClient.init({
    projectId: PROJECT_ID,
    metadata: {
      name: "Vesting Cliff Drip Stream",
      description: "Vesting stream dApp",
      url: window.location.origin,
      icons: ["https://your-app.com/icon.png"],
    },
  });

  // 2. Create a pairing and show the QR code
  const { uri } = await signClient.connect({
    requiredNamespaces: {
      stellar: {
        methods: ["stellar_signAndSubmitXDR", "stellar_signXDR"],
        chains: ["stellar:testnet"],
      },
    },
  });

  // 3. Open WalletConnect modal with QR code
  const modal = new WalletConnectModal({ projectId: PROJECT_ID });
  await modal.openModal({ uri });

  // 4. Wait for the user to scan and approve
  session = await new Promise((resolve) => {
    signClient.on("session_update", (_, updatedSession) => {
      resolve(updatedSession);
    });
  });

  await modal.closeModal();
  return session;
}
```

### Mobile Deep Link Flow

When the dApp is already running on a mobile browser, Lobstr can be opened directly via a deep link instead of scanning a QR code:

```js
async function connectLobstrMobile() {
  const signClient = await SignClient.init({ projectId: PROJECT_ID });

  const { uri } = await signClient.connect({
    requiredNamespaces: {
      stellar: {
        methods: ["stellar_signAndSubmitXDR", "stellar_signXDR"],
        chains: ["stellar:testnet"],
      },
    },
  });

  // On mobile, redirect directly to Lobstr instead of showing QR
  window.location.href = `lobstr://wc?uri=${encodeURIComponent(uri)}`;
}
```

### Signing with Lobstr

```js
/**
 * Sign and submit an XDR transaction via the Lobstr WalletConnect session.
 */
async function signWithLobstr(xdrBase64, networkPassphrase) {
  if (!session) throw new WalletError("WALLET_NOT_CONNECTED", "No Lobstr session. Please connect first.");

  const result = await signClient.request({
    topic: session.topic,
    chainId: "stellar:testnet",
    request: {
      method: "stellar_signAndSubmitXDR",
      params: {
        xdr: xdrBase64,
        networkPassphrase,
      },
    },
  });

  return result;
}

// Full claim flow example
async function claimWithLobstr(contractId, recipientAddress) {
  const address = getLobstrAddress(session); // Extract from session namespaces
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

  const simResult = await server.simulateTransaction(tx);
  if (!rpc.Api.isSimulationSuccess(simResult)) {
    throw new Error("Simulation failed: " + simResult.error);
  }
  tx = rpc.assembleTransaction(tx, simResult).build();

  const result = await signWithLobstr(tx.toXDR(), Networks.TESTNET);
  return result;
}
```

### Mobile vs Desktop Comparison

| Aspect | Desktop | Mobile |
|--------|---------|--------|
| Connection | QR code scan | Deep link redirect |
| Session persistence | Browser tab session | Lobstr app session |
| Signing UX | Popup in browser | Approve in Lobstr app |
| Network switching | Via Lobstr app settings | Via Lobstr app settings |
| Offline support | No (needs extension) | Yes (app can work offline for local ops) |

### Lobstr-Specific Notes

- **WalletConnect project ID**: You must register at [cloud.walletconnect.com](https://cloud.walletconnect.com) and use your own project ID.
- **Session expiry**: WalletConnect sessions expire after a period of inactivity. Detect expired sessions and prompt reconnection.
- **Multiple chains**: Lobstr supports Stellar mainnet and testnet. Ensure the `chainId` matches your target network.

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

### Contract Error Codes

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

### Wallet-Level Error Handling

```js
/**
 * Custom error class for wallet-related failures.
 */
class WalletError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "WalletError";
    this.code = code;
  }
}

/**
 * Wallet error codes and their user-facing messages.
 */
const WALLET_ERRORS = {
  FREIGHTER_NOT_INSTALLED: {
    title: "Freighter Not Installed",
    message: "Please install the Freighter browser extension from https://www.freighter.app/.",
    action: { label: "Install Freighter", url: "https://www.freighter.app/" },
  },
  WALLET_LOCKED: {
    title: "Wallet Locked",
    message: "Your wallet is locked. Please unlock it and try again.",
    action: { label: "Retry", retry: true },
  },
  USER_REJECTED: {
    title: "Transaction Rejected",
    message: "You rejected the transaction. No changes were made to your account.",
    action: { label: "Try Again", retry: true },
  },
  NETWORK_MISMATCH: {
    title: "Network Mismatch",
    message: "Your wallet is connected to the wrong network. Please switch to testnet in your wallet settings.",
    action: { label: "Dismiss" },
  },
  SESSION_EXPIRED: {
    title: "Session Expired",
    message: "Your wallet session has expired. Please reconnect.",
    action: { label: "Reconnect", retry: true },
  },
  INSUFFICIENT_BALANCE: {
    title: "Insufficient Balance",
    message: "Your account does not have enough XLM to cover the transaction fee.",
    action: { label: "Dismiss" },
  },
};
```

### Unified Error Handler

```js
/**
 * Attempt a wallet operation and handle errors gracefully.
 * Shows user-friendly toasts/errors based on the error type.
 */
async function withWalletErrorHandling(walletFn, errorDisplay) {
  try {
    return await walletFn();
  } catch (err) {
    // Handle user rejection (common across all wallets)
    if (err.message?.includes("rejected") || err.message?.includes("declined") || err.code === "USER_REJECTED") {
      errorDisplay.show(WALLET_ERRORS.USER_REJECTED);
      return null;
    }

    // Handle network mismatch
    if (err.code === "NETWORK_MISMATCH" || err.message?.includes("network")) {
      errorDisplay.show(WALLET_ERRORS.NETWORK_MISMATCH);
      return null;
    }

    // Handle wallet locked
    if (err.message?.includes("locked") || err.code === "WALLET_LOCKED") {
      errorDisplay.show(WALLET_ERRORS.WALLET_LOCKED);
      return null;
    }

    // Handle session expiry (WalletConnect)
    if (err.message?.includes("expired") || err.message?.includes("session")) {
      errorDisplay.show(WALLET_ERRORS.SESSION_EXPIRED);
      return null;
    }

    // Handle insufficient balance
    if (err.message?.includes("insufficient") || err.message?.includes("underfunded")) {
      errorDisplay.show(WALLET_ERRORS.INSUFFICIENT_BALANCE);
      return null;
    }

    // Fallback: show contract error or generic message
    const contractMsg = parseVestingError(err);
    errorDisplay.show({ title: "Transaction Failed", message: contractMsg });
    return null;
  }
}

// Usage
const result = await withWalletErrorHandling(
  () => claimWithFreighter(contractId, recipientAddress),
  toastDisplay // your UI error display adapter
);
```

---

## Fallback Wallet Support Checklist

When a user's preferred wallet is unavailable, gracefully fall back to the next option.

```js
/**
 * Attempt to connect using the best available wallet.
 * Falls through to alternatives in priority order.
 */
async function connectBestAvailableWallet() {
  const wallets = detectWallets();

  // 1. Try Freighter (browser extension — best UX)
  if (wallets.freighter) {
    try {
      const address = await ensureFreighterConnected();
      return { type: "freighter", address };
    } catch (err) {
      console.warn("Freighter unavailable, trying fallback:", err.code);
    }
  }

  // 2. Try Lobstr via WalletConnect (works on mobile and desktop)
  if (wallets.lobster) {
    try {
      const session = await connectLobstrDesktop();
      return { type: "lobstr", session };
    } catch (err) {
      console.warn("Lobstr unavailable, trying fallback:", err.code);
    }
  }

  // 3. Fall back to read-only mode (no wallet required)
  return { type: "readonly", address: null };
}
```

### Fallback Support Checklist

| Check | Description |
|-------|-------------|
| ✅ Extension detection | Check `window.freighterApi` before attempting Freighter calls |
| ✅ WalletConnect availability | Verify WalletConnect modal library loads correctly |
| ✅ Read-only mode | Allow schedule/cliff status viewing without a wallet |
| ✅ Graceful degradation | Show clear messages when a wallet is unavailable |
| ✅ Network verification | Always verify network matches before signing |
| ✅ Session expiry handling | Detect and handle expired WalletConnect sessions |
| ✅ User rejection handling | Don't show error toasts for intentional rejections |
| ✅ Retry after lock | Prompt user to unlock and retry on wallet-locked errors |

---

## Mock Wallet Setup for E2E Tests

For E2E tests, mock the wallet APIs to avoid requiring real wallet installations. This is used in `frontend/e2e/lifecycle-wallet.spec.ts`.

### Test Helper Setup

```ts
// frontend/e2e/helpers/mock-wallet.ts

import { Page } from "@playwright/test";

/**
 * Mock wallet addresses for testing.
 */
export const MOCK_ADDRESSES = {
  recipient: "GCFYSH...test_recipient",
  sponsor: "GCFYSH...test_sponsor",
};

/**
 * Inject a mock Freighter API into the page before tests run.
 * This avoids needing the real extension installed in CI.
 */
export async function mockFreighter(page: Page, options?: { address?: string; network?: string }) {
  const address = options?.address ?? MOCK_ADDRESSES.recipient;
  const networkPassphrase = options?.network ?? "Test SDF Network ; September 2015";

  await page.addInitScript(() => {
    // @ts-expect-error — injecting mock wallet API
    window.freighterApi = {
      getAddress: async () => ({
        address: window.__MOCK_FREIGHTER_ADDRESS__ ?? "GCFYSH...test_recipient",
      }),
      getNetwork: async () => ({
        networkPassphrase: window.__MOCK_FREIGHTER_NETWORK__ ?? "Test SDF Network ; September 2015",
      }),
      signTransaction: async (xdr, opts) => ({
        signedTxXdr: xdr, // Return unsigned XDR — tests verify the flow, not the signature
      }),
      disconnect: async () => {},
    };
  });

  // Set mock values accessible from init script
  await page.evaluate(
    ([addr, net]) => {
      // @ts-expect-error — test globals
      window.__MOCK_FREIGHTER_ADDRESS__ = addr;
      // @ts-expect-error — test globals
      window.__MOCK_FREIGHTER_NETWORK__ = net;
    },
    [address, networkPassphrase]
  );
}

/**
 * Mock WalletConnect for Lobstr testing.
 * Simulates a session without requiring a real WalletConnect relay.
 */
export async function mockLobstrWalletConnect(page: Page) {
  await page.addInitScript(() => {
    // @ts-expect-error — injecting mock
    window.__MOCK_WALLETCONNECT__ = {
      connected: true,
      topic: "mock-session-topic",
      accounts: ["GCFYSH...test_recipient"],
      namespaces: {
        stellar: {
          chains: ["stellar:testnet"],
          accounts: ["stellar:testnet:GCFYSH...test_recipient"],
        },
      },
    };
  });
}
```

### Example E2E Test

```ts
// frontend/e2e/lifecycle-wallet.spec.ts (additions)

import { test, expect } from "@playwright/test";
import { mockFreighter, MOCK_ADDRESSES } from "./helpers/mock-wallet";

test.describe("Wallet integration flows", () => {
  test("Freighter: detects extension and connects", async ({ page }) => {
    await mockFreighter(page, { address: MOCK_ADDRESSES.recipient });
    await page.goto("/claim");

    // The dApp should detect Freighter and show the connect button
    await expect(page.getByRole("button", { name: /connect freighter/i })).toBeVisible();

    await page.getByRole("button", { name: /connect freighter/i }).click();

    // After connection, the user's address should be displayed
    await expect(page.getByTestId("wallet-address")).toContainText(MOCK_ADDRESSES.recipient.slice(0, 8));
  });

  test("Freighter: shows install prompt when extension missing", async ({ page }) => {
    // Do NOT inject mock — simulate missing extension
    await page.goto("/claim");

    await expect(page.getByText(/freighter.*not installed/i)).toBeVisible();
  });

  test("Freighter: handles user rejection gracefully", async ({ page }) => {
    await mockFreighter(page);
    // Override signTransaction to simulate rejection
    await page.evaluate(() => {
      // @ts-expect-error — test override
      window.freighterApi.signTransaction = async () => {
        throw new Error("User rejected the transaction");
      };
    });

    await page.goto("/claim");
    await page.getByRole("button", { name: /connect freighter/i }).click();
    await page.getByRole("button", { name: /claim/i }).click();

    await expect(page.getByText(/transaction rejected/i)).toBeVisible();
  });

  test("Lobstr: WalletConnect session flow", async ({ page }) => {
    await mockLobstrWalletConnect(page);
    await page.goto("/claim");

    await expect(page.getByRole("button", { name: /connect lobstr/i })).toBeVisible();
  });

  test("Fallback: read-only mode when no wallet available", async ({ page }) => {
    // No wallet mocks injected
    await page.goto("/schedule/recipient123");

    // Schedule should still be viewable
    await expect(page.getByTestId("schedule-status")).toBeVisible();
    await expect(page.getByText(/connect a wallet to claim/i)).toBeVisible();
  });
});
```

### CI Configuration

For CI, mock the wallet APIs in your test setup:

```ts
// playwright.config.ts or test setup
import { test as base } from "@playwright/test";

export const test = base.extend({
  page: async ({ page }, use) => {
    // Inject mock Freighter before every test
    await page.addInitScript(() => {
      window.freighterApi = {
        getAddress: async () => ({ address: "GCFYSH...test_recipient" }),
        getNetwork: async () => ({ networkPassphrase: "Test SDF Network ; September 2015" }),
        signTransaction: async (xdr) => ({ signedTxXdr: xdr }),
        disconnect: async () => {},
      };
    });
    await use(page);
  },
});
```

**Requirements for CI mock wallet:**
- No real wallet extension installed
- Mock APIs injected via `page.addInitScript()`
- Transactions are not actually signed — XDR is passed through
- Network passphrase matches the test environment
- All signing-related tests use mock XDR and verify flow, not cryptographic correctness

---

## Integration Support

For integration questions, open an issue in the [GitHub repository](https://github.com/your-org/vesting-cliff-drip-stream/issues) with the label **`wallet-integration`**.
