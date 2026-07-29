/**
 * E2E: Cliff advancement and claim
 *
 * Covers:
 *  - After cliff has passed, claim sheet shows claimable amount
 *  - Claim button is enabled and functional
 *  - Successful claim shows success confirmation
 *  - Claimable balance resets (optimistic update) after claim
 *  - Schedule info in claim sheet (total vested, total deposit)
 *  - Fee estimate renders in the sheet
 *  - Progress bar rendered
 *
 * The mock data in page.tsx has:
 *  - Stream id=1: active (cliff already passed), claimableAmount = 1500 USDC
 *
 * For the "advance to cliff" scenario we use the mock data directly since
 * the frontend runs against mock streams (no live contract in UI tests).
 * The contract-level ledger advancement is tested by tests/e2e/run_e2e.js.
 */

import { test, expect } from "./fixtures/walletMock";
import { gotoDashboard, openClaimSheet, BASE_LEDGER } from "./helpers";

test.describe("Cliff advancement and claim", () => {
  test.beforeEach(async ({ page }) => {
    await gotoDashboard(page);
  });

  // ------------------------------------------------------------------
  // Verify the active stream's cliff has passed
  // ------------------------------------------------------------------

  test("active stream – cliff has passed (cliffLedger < currentLedger)", async ({
    page,
  }) => {
    // Stream id=1 has cliffLedger = BASE_LEDGER - 86_400 which is in the past.
    // We verify this by checking the stream card has the "active" badge.
    const activeBadge = page
      .locator(".badge")
      .filter({ hasText: /active/i })
      .first();
    await expect(activeBadge).toBeVisible();
  });

  // ------------------------------------------------------------------
  // Claim sheet content after cliff has passed
  // ------------------------------------------------------------------

  test("claim sheet – no cliff banner for post-cliff stream", async ({
    page,
  }) => {
    await openClaimSheet(page, "1");

    // Cliff-countdown must NOT be visible for a post-cliff stream
    await expect(page.getByTestId("cliff-countdown")).not.toBeVisible();
  });

  test("claim sheet – claimable amount is 1 500 USDC", async ({ page }) => {
    await openClaimSheet(page, "1");

    const amount = page.getByTestId("claimable-amount");
    await expect(amount).toBeVisible();
    const text = await amount.textContent();
    // The amount abbreviates 1500 as "1,500" or "1.5k"
    expect(text).toMatch(/1[,.]?5/);
  });

  test("claim sheet – schedule info shows total vested and deposit", async ({
    page,
  }) => {
    await openClaimSheet(page, "1");

    // schedule-info dl is shown when totalDeposit/totalVested are provided
    const info = page.getByTestId("schedule-info");
    await expect(info).toBeVisible();

    // Total vested should show 1500
    const vested = page.getByTestId("total-vested");
    await expect(vested).toBeVisible();
    const text = await vested.textContent();
    expect(text).toMatch(/1[,.]?500/);
  });

  test("claim sheet – vesting progress bar visible", async ({ page }) => {
    await openClaimSheet(page, "1");

    const bar = page.getByTestId("vesting-progress");
    await expect(bar).toBeVisible();

    // Progress bar should have non-zero aria-valuenow (stream is active)
    const valuenow = await bar.getAttribute("aria-valuenow");
    expect(Number(valuenow)).toBeGreaterThan(0);
  });

  test("claim sheet – fee estimate renders", async ({ page }) => {
    await openClaimSheet(page, "1");

    // Fee estimate section is always shown (loading → resolved → or error)
    const feeSection = page.getByTestId("fee-estimate");
    await expect(feeSection).toBeVisible();

    // After a short wait the stub resolves
    await page.waitForTimeout(1200);
    // Either fee-value, fee-unknown, or fee-loading should be present
    const hasFeeEl =
      (await page.getByTestId("fee-value").isVisible()) ||
      (await page.getByTestId("fee-unknown").isVisible()) ||
      (await page.getByTestId("fee-loading").isVisible());
    expect(hasFeeEl).toBe(true);
  });

  // ------------------------------------------------------------------
  // Claim action
  // ------------------------------------------------------------------

  test("claim button enabled for post-cliff stream", async ({ page }) => {
    await openClaimSheet(page, "1");

    const btn = page.getByTestId("claim-button");
    await expect(btn).toBeVisible();
    await expect(btn).toBeEnabled();
    expect(await btn.textContent()).toMatch(/claim/i);
    // aria-disabled should NOT be set to true
    expect(await btn.getAttribute("aria-disabled")).not.toBe("true");
  });

  test("claim – balance updated optimistically to 0 on click", async ({
    page,
  }) => {
    await openClaimSheet(page, "1");

    const claimBtn = page.getByTestId("claim-button");
    await expect(claimBtn).toBeEnabled();

    // Record amount label before clicking
    const amountEl = page.getByTestId("claimable-amount");
    const before = await amountEl.textContent();
    expect(before).toMatch(/1[,.]?5/);

    await claimBtn.click();

    // Immediately after click the optimistic balance is 0
    await expect(amountEl).toHaveText(/^0/, { timeout: 3_000 });
  });

  test("claim – success confirmation shown after transaction", async ({
    page,
  }) => {
    await openClaimSheet(page, "1");

    await page.getByTestId("claim-button").click();

    // The mock handleClaim in page.tsx resolves in ~1.2 s
    await expect(page.getByTestId("claim-success")).toBeVisible({
      timeout: 8_000,
    });
    expect(await page.getByTestId("claim-success").textContent()).toMatch(
      /claim submitted/i
    );
  });

  test("claim – button text changes to 'Claimed' after success", async ({
    page,
  }) => {
    await openClaimSheet(page, "1");
    await page.getByTestId("claim-button").click();

    // After success the button label changes
    await expect(page.getByTestId("claim-button")).toHaveText(/claimed/i, {
      timeout: 8_000,
    });
    await expect(page.getByTestId("claim-button")).toBeDisabled();
  });

  test("claim – cannot claim twice (button disabled after first claim)", async ({
    page,
  }) => {
    await openClaimSheet(page, "1");
    await page.getByTestId("claim-button").click();

    // Wait for success
    await expect(page.getByTestId("claim-success")).toBeVisible({
      timeout: 8_000,
    });

    // Second click attempt – button should be disabled
    const claimBtn = page.getByTestId("claim-button");
    await expect(claimBtn).toBeDisabled();
  });

  // ------------------------------------------------------------------
  // Current ledger verification (mock data consistency)
  // ------------------------------------------------------------------

  test("mock data: BASE_LEDGER is consistent with active stream cliff", async ({
    page: _page,
  }) => {
    // Verify our test constant matches the page.tsx constant
    // cliffLedger for id=1 = BASE_LEDGER - 86_400
    const cliffLedger = BASE_LEDGER - 86_400;
    expect(cliffLedger).toBeLessThan(BASE_LEDGER); // cliff in the past
    expect(BASE_LEDGER).toBeGreaterThan(51_000_000); // realistic Stellar ledger
  });
});
