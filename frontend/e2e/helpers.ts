/**
 * Shared E2E test helpers and page-object utilities.
 *
 * These helpers wrap common interactions so individual spec files stay
 * focused on the scenario under test.
 */

import type { Page, Locator } from "@playwright/test";
import { expect } from "@playwright/test";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** A valid Stellar address (56 chars, G-prefix, base32). */
export const VALID_RECIPIENT =
  "GDEMO1234ABCDEFGHIJKLMNOPQRSTUVWXYZ012345678901234ABCDEFGH";

/** A valid SAC token contract address (56 chars, C-prefix). */
export const USDC_TOKEN_ADDRESS =
  "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";

/** Default stream parameters that produce a valid form submission. */
export const STREAM_PARAMS = {
  recipient: VALID_RECIPIENT,
  tokenAddress: USDC_TOKEN_ADDRESS,
  tokenSymbol: "USDC",
  /** tokens per ledger */
  rate: "10",
  /** ledgers – small numbers to keep test fast */
  cliffDuration: "100",
  totalDuration: "1000",
};

// ---------------------------------------------------------------------------
// Navigation helpers
// ---------------------------------------------------------------------------

/** Navigate to the dashboard (page.tsx) and wait for the stream list. */
export async function gotoDashboard(page: Page): Promise<void> {
  await page.goto("/");
  // Wait until at least one stream card is rendered (skeletons replaced)
  await page.waitForSelector(".stream-card", { timeout: 10_000 });
}

/** Navigate to the dashboard and wait for the wallet connect button. */
export async function gotoHome(page: Page): Promise<void> {
  await page.goto("/");
}

// ---------------------------------------------------------------------------
// Wallet helpers
// ---------------------------------------------------------------------------

/**
 * Simulate a wallet connection by driving the WalletContext via
 * window.__freighterStub (installed by walletMock fixture).
 *
 * We click the "Connect Wallet" button which triggers context.connect().
 * Since the stub resolves immediately the button text changes to the address.
 */
export async function connectWallet(page: Page): Promise<void> {
  const btn = page.getByTestId("connect-wallet");
  await expect(btn).toBeVisible({ timeout: 5_000 });
  await btn.click();
  // After click the button should transition to showing the address
  await expect(page.getByTestId("wallet-address")).toBeVisible({
    timeout: 8_000,
  });
}

/** Assert wallet is connected and the address element is visible. */
export async function assertWalletConnected(page: Page): Promise<void> {
  await expect(page.getByTestId("wallet-address")).toBeVisible();
  const text = await page.getByTestId("wallet-address").textContent();
  // Truncated address starts with G
  expect(text).toMatch(/G/);
}

/** Disconnect the wallet using the disconnect button. */
export async function disconnectWallet(page: Page): Promise<void> {
  const btn = page.getByTestId("disconnect-wallet");
  await expect(btn).toBeVisible();
  await btn.click();
  await expect(page.getByTestId("connect-wallet")).toBeVisible();
}

// ---------------------------------------------------------------------------
// Wizard helpers
// ---------------------------------------------------------------------------

/** Open the Create Stream wizard from any page that has the trigger button. */
export async function openCreateWizard(page: Page): Promise<void> {
  await page.getByTestId("open-create-wizard").click();
  await expect(page.getByTestId("create-stream-wizard")).toBeVisible();
}

/**
 * Advance the wizard past step 1 (connect wallet) by injecting a wallet
 * address directly into the wizard's form data via page.evaluate.
 *
 * This avoids the need for a real Freighter popup while still exercising the
 * wizard UI from step 2 onwards.
 */
export async function advanceWizardPastWalletStep(
  page: Page,
  address = "GABC1234EFGH5678IJKLMNOPQRSTUVWXYZ0123456789ABCDEFGHIJKL"
): Promise<void> {
  // Inject the wallet address into the wizard via the mock stub, then click
  // the Continue button which reads from WalletContext.address.
  await page.evaluate((addr) => {
    if ((window as unknown as Record<string, unknown>).__freighterStub) {
      (
        window as unknown as Record<
          string,
          { isConnected: () => Promise<{ isConnected: boolean }>; getAddress: () => Promise<{ address: string }>; requestAccess: () => Promise<{ address: string }> }
        >
      ).__freighterStub = {
        isConnected: () => Promise.resolve({ isConnected: true }),
        getAddress: () => Promise.resolve({ address: addr }),
        requestAccess: () => Promise.resolve({ address: addr }),
      };
    }
  }, address);

  // Click "Connect Freighter" in the wizard – this calls context.connect()
  // which calls requestAccess() then getAddress() on the stub.
  const connectBtn = page.getByTestId("wizard-connect-btn");
  if (await connectBtn.isVisible()) {
    await connectBtn.click();
  }

  // Wait for the address to appear in the wizard
  await expect(page.getByTestId("wizard-wallet-address")).toBeVisible({
    timeout: 6_000,
  });

  // Click Continue
  const nextBtn = page.getByTestId("wizard-next-btn");
  await expect(nextBtn).toBeEnabled({ timeout: 5_000 });
  await nextBtn.click();
}

/**
 * Fill all wizard steps 2–4 (token, amounts, preview) and arrive at the
 * Confirm step ready to submit.
 */
export async function fillWizardForm(
  page: Page,
  params = STREAM_PARAMS
): Promise<void> {
  // Step 2: select token
  // Click USDC preset if address matches, otherwise use custom
  const usdcBtn = page.getByTestId("wizard-token-usdc");
  if (await usdcBtn.isVisible()) {
    await usdcBtn.click();
  } else {
    await page.getByTestId("wizard-token-custom").fill(params.tokenAddress);
  }
  await page.getByTestId("wizard-next-btn").click();

  // Step 3: set amounts
  // Each field wrapper is the data-testid; the actual input is inside it
  await page
    .getByTestId("wizard-recipient")
    .locator("input")
    .fill(params.recipient);
  await page.getByTestId("wizard-rate").locator("input").fill(params.rate);
  await page
    .getByTestId("wizard-cliff")
    .locator("input")
    .fill(params.cliffDuration);
  await page
    .getByTestId("wizard-total")
    .locator("input")
    .fill(params.totalDuration);

  // Wait for deposit preview to appear (it renders when form is valid)
  await expect(page.getByTestId("wizard-deposit")).toBeVisible();

  await page.getByTestId("wizard-next-btn").click();

  // Step 4: preview – verify values then continue
  await expect(
    page.getByTestId("preview-recipient")
  ).toBeVisible();
  await page.getByTestId("wizard-next-btn").click();

  // Now on step 5: confirm
  await expect(page.getByTestId("wizard-submit-btn")).toBeVisible();
}

// ---------------------------------------------------------------------------
// Stream card / dashboard helpers
// ---------------------------------------------------------------------------

/** Open the Claim sheet for the given stream id. */
export async function openClaimSheet(
  page: Page,
  streamId: string
): Promise<Locator> {
  await page.getByTestId(`claim-btn-${streamId}`).first().click();
  const sheet = page.getByTestId("claim-bottom-sheet");
  await expect(sheet).toBeVisible({ timeout: 5_000 });
  return sheet;
}

/** Open the Create Stream form on the dashboard. */
export async function openCreateForm(page: Page): Promise<void> {
  await page.getByTestId("toggle-create-form").click();
  await expect(page.getByTestId("stream-create-form")).toBeVisible();
}

/** Fill the StreamCreateForm with the given params and submit. */
export async function fillAndSubmitCreateForm(
  page: Page,
  params: {
    recipient: string;
    token: string;
    rate: string;
    cliffDays: string;
    totalDays: string;
  }
): Promise<void> {
  await page.locator('[name="recipient"]').fill(params.recipient);
  await page.locator('[name="token"]').fill(params.token);
  await page.locator('[name="rate"]').fill(params.rate);
  await page.locator('[name="cliffDays"]').fill(params.cliffDays);
  await page.locator('[name="totalDays"]').fill(params.totalDays);

  // Deposit preview should appear for valid inputs
  await expect(page.getByTestId("deposit-preview")).toBeVisible();

  await page.getByTestId("stream-create-submit").click();
}

// ---------------------------------------------------------------------------
// Contract helpers (for ledger-based scenarios)
// ---------------------------------------------------------------------------

/**
 * Returns the current ledger number exposed by the app's mock data.
 * The dashboard uses BASE_LEDGER = 51_200_000 in page.tsx.
 */
export const BASE_LEDGER = 51_200_000;

/** Cliff ledger for stream id=1 (active, cliff already passed). */
export const STREAM_1_CLIFF_LEDGER = BASE_LEDGER - 86_400;
/** Cliff ledger for stream id=2 (pre-cliff, cliff not yet reached). */
export const STREAM_2_CLIFF_LEDGER = BASE_LEDGER + 259_200;
