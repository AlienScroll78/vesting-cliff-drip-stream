/**
 * E2E: Stream creation flow (issue #1055)
 *
 * Covers the complete user journey for creating a vesting stream:
 *  - connect wallet (mocked Freighter) → fill form → submit → verify success
 *  - invalid recipient address → inline validation error
 *  - cliff duration > total duration → inline validation error
 *  - RPC error during simulation → error toast (role=alert)
 *
 * Runs on Chromium (chromium-mock project) and Firefox (firefox-mock project).
 */

import type { Page } from "@playwright/test";
import { test, expect, installWalletMock } from "./fixtures/walletMock";
import { connectWallet, USDC_TOKEN_ADDRESS } from "./helpers";

declare global {
  interface Window {
    __mockCreateStreamError?: number;
  }
}

/**
 * A valid 56-char Stellar address (G + 55 base32 chars, A–Z / 2–7).
 * Note: helpers.VALID_RECIPIENT contains digits outside the base32 alphabet
 * and is rejected by the form's own validation, so this spec defines its own.
 */
const RECIPIENT = "GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVW";
const TOKEN = USDC_TOKEN_ADDRESS;

async function openCreateForm(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByTestId("toggle-create-form").click();
  await expect(page.getByTestId("stream-create-form")).toBeVisible();
}

/** Fill the basic (non-advanced) fields with a valid stream configuration. */
async function fillValidStream(page: Page): Promise<void> {
  await page.locator('[name="recipient"]').fill(RECIPIENT);
  await page.locator('[name="token"]').fill(TOKEN);
  await page.locator('[name="totalAmount"]').fill("3650");
  await page.locator('[name="cliffDays"]').fill("30");
  await page.locator('[name="totalDays"]').fill("365");
  await expect(page.getByTestId("deposit-preview")).toBeVisible();
}

test.describe("Stream creation flow", () => {
  test.beforeEach(async ({ page }) => {
    await installWalletMock(page);
  });

  test("connect wallet → fill form → submit → success message", async ({
    page,
  }) => {
    await openCreateForm(page);
    await connectWallet(page);
    await expect(page.getByTestId("wallet-address")).toBeVisible();

    await fillValidStream(page);
    await page.getByTestId("stream-create-submit").click();

    // Success state: tx hash panel with explorer link
    const success = page.getByTestId("tx-success");
    await expect(success).toBeVisible({ timeout: 10_000 });
    const link = success.getByRole("link");
    await expect(link).toBeVisible();
    expect(await link.getAttribute("href")).toContain("stellar.expert");

    // Screen-reader live region announces the outcome
    await expect(page.getByTestId("form-live-region")).toContainText(
      /created successfully/i
    );
  });

  test("invalid recipient address shows inline error", async ({ page }) => {
    await openCreateForm(page);
    await connectWallet(page);

    await page.locator('[name="recipient"]').fill("not-a-stellar-address");
    await page.locator('[name="token"]').fill(TOKEN);
    await page.locator('[name="totalAmount"]').fill("3650");
    await page.locator('[name="cliffDays"]').fill("30");
    await page.locator('[name="totalDays"]').fill("365");

    await page.getByTestId("stream-create-submit").click();

    const error = page.getByTestId("recipient-error");
    await expect(error).toBeVisible();
    await expect(error).toContainText(/valid Stellar address/i);
  });

  test("cliff duration > total duration shows validation error", async ({
    page,
  }) => {
    await openCreateForm(page);
    await connectWallet(page);

    await page.locator('[name="recipient"]').fill(RECIPIENT);
    await page.locator('[name="token"]').fill(TOKEN);
    await page.locator('[name="totalAmount"]').fill("100");
    await page.locator('[name="cliffDays"]').fill("100");
    await page.locator('[name="totalDays"]').fill("50");

    // Trigger validation on the total-days field
    await page.locator('[name="totalDays"]').blur();

    const error = page.getByTestId("totalDays-error");
    await expect(error).toBeVisible();
    await expect(error).toContainText(/greater than cliff/i);
  });

  test("RPC error during simulation shows error toast", async ({ page }) => {
    // Make the (stubbed) submission reject with contract error code 4
    await page.addInitScript(() => {
      window.__mockCreateStreamError = 4;
    });

    await openCreateForm(page);
    await connectWallet(page);

    await fillValidStream(page);
    await page.getByTestId("stream-create-submit").click();

    // Error toast: role=alert with the user-facing message for code 4
    // ("Invalid token rate" — raw codes are deliberately not shown to users)
    const toast = page.getByTestId("contract-error");
    await expect(toast).toBeVisible({ timeout: 10_000 });
    await expect(toast).toHaveAttribute("role", "alert");
    await expect(toast).toContainText(/invalid token rate/i);

    // Success panel must not appear alongside the error
    await expect(page.getByTestId("tx-success")).not.toBeVisible();
  });
});
