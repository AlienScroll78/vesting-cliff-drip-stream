/**
 * E2E: Wallet connection lifecycle
 *
 * Covers:
 *  - Connect Freighter wallet (mocked via walletMock fixture)
 *  - Address shown in header after connect
 *  - Disconnect restores original state
 *  - Connection error displays message
 *
 * All tests run with the walletMock fixture, so no real Freighter extension
 * or testnet account is needed.
 */

import { test, expect, MOCK_ADDRESS } from "./fixtures/walletMock";
import { gotoHome, assertWalletConnected, disconnectWallet } from "./helpers";

test.describe("Wallet connection", () => {
  test("connect wallet – address shown in header", async ({ page }) => {
    await gotoHome(page);

    // Before connecting, the connect button must be visible
    const connectBtn = page.getByTestId("connect-wallet");
    await expect(connectBtn).toBeVisible();
    await expect(page.getByTestId("wallet-address")).not.toBeVisible();

    // Click Connect – the stub resolves immediately
    await connectBtn.click();

    // Address element must appear and contain a G-prefix address (truncated)
    await assertWalletConnected(page);
    const addrText = await page.getByTestId("wallet-address").textContent();
    // Truncated address shows first 6 chars + "…" + last 4 chars
    // MOCK_ADDRESS starts with "GABC12" so the truncated form starts with "G"
    expect(addrText).toMatch(/G/);
  });

  test("connect wallet – full address matches MOCK_ADDRESS", async ({
    page,
  }) => {
    await gotoHome(page);
    await page.getByTestId("connect-wallet").click();

    // The wallet-address element has a title attribute containing the full address
    const addrEl = page.getByTestId("wallet-address");
    await expect(addrEl).toBeVisible();

    // title attribute holds the full address
    const title = await addrEl.getAttribute("title");
    expect(title).toBe(MOCK_ADDRESS);
  });

  test("disconnect – connect button restored, address hidden", async ({
    page,
  }) => {
    await gotoHome(page);
    await page.getByTestId("connect-wallet").click();
    await assertWalletConnected(page);

    await disconnectWallet(page);

    // After disconnect the connect button must re-appear
    await expect(page.getByTestId("connect-wallet")).toBeVisible();
    await expect(page.getByTestId("wallet-address")).not.toBeVisible();
  });

  test("connect → disconnect → reconnect", async ({ page, setWalletState }) => {
    await gotoHome(page);

    // First connection
    await page.getByTestId("connect-wallet").click();
    await assertWalletConnected(page);

    // Disconnect
    await disconnectWallet(page);
    await expect(page.getByTestId("connect-wallet")).toBeVisible();

    // Update stub to still be connected and reconnect
    await setWalletState("connected", MOCK_ADDRESS);
    await page.getByTestId("connect-wallet").click();
    await assertWalletConnected(page);
  });

  test("connection error – error message shown", async ({
    page,
    setWalletState,
  }) => {
    await gotoHome(page);

    // Switch stub to error mode before clicking connect
    await setWalletState("error");

    const connectBtn = page.getByTestId("connect-wallet");
    await expect(connectBtn).toBeVisible();
    await connectBtn.click();

    // The WalletButton component renders a role="alert" on error
    const errorAlert = page.getByRole("alert");
    await expect(errorAlert).toBeVisible({ timeout: 5_000 });
  });

  test("wallet address is accessible – aria-label present", async ({
    page,
  }) => {
    await gotoHome(page);
    await page.getByTestId("connect-wallet").click();

    const addrEl = page.getByTestId("wallet-address");
    await expect(addrEl).toBeVisible();

    // aria-label must include the full address for screen readers
    const ariaLabel = await addrEl.getAttribute("aria-label");
    expect(ariaLabel).toMatch(/connected wallet/i);
  });
});
