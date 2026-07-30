/**
 * E2E: Freighter wallet connection
 *
 * Prerequisites:
 *  - Freighter unpacked extension at e2e/fixtures/freighter (or FREIGHTER_EXT_PATH)
 *  - FREIGHTER_SEED env var contains a testnet-funded mnemonic
 *
 * Run: make test-e2e-ui  (from repo root)
 */
import { test, expect, BrowserContext, Page } from "@playwright/test";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Find and return the Freighter extension popup page. */
async function getExtensionPage(context: BrowserContext): Promise<Page> {
  // Wait for the service-worker to register and expose the extension id
  const workers = context.serviceWorkers();
  let sw = workers[0];
  if (!sw) sw = await context.waitForEvent("serviceworker", { timeout: 10_000 });
  const extensionId = sw.url().split("/")[2];
  const extPage = await context.newPage();
  await extPage.goto(`chrome-extension://${extensionId}/index.html`);
  return extPage;
}

/** Onboard Freighter with the test seed phrase. */
async function onboardFreighter(extPage: Page) {
  const seed = process.env.FREIGHTER_SEED;
  if (!seed) throw new Error("FREIGHTER_SEED env var is required");

  // Import existing wallet
  await extPage.getByRole("button", { name: /import/i }).click();
  for (const [i, word] of seed.split(" ").entries()) {
    await extPage.getByTestId(`mnemonic-word-${i}`).fill(word);
  }
  await extPage.getByRole("button", { name: /next|import/i }).click();
  // Set password
  await extPage.getByPlaceholder(/password/i).first().fill("TestPass123!");
  await extPage.getByPlaceholder(/confirm/i).fill("TestPass123!");
  await extPage.getByRole("button", { name: /confirm|finish/i }).click();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe("Freighter wallet connection", () => {
  test.skip(
    !process.env.FREIGHTER_SEED,
    "Set FREIGHTER_SEED to run wallet E2E tests"
  );

  test("connect wallet – address shown, then disconnect", async ({ context, page }) => {
    // 1. Onboard extension
    const extPage = await getExtensionPage(context);
    await onboardFreighter(extPage);
    await extPage.close();

    // 2. Load app
    await page.goto("/");
    const connectBtn = page.getByTestId("connect-wallet");
    await expect(connectBtn).toBeVisible();

    // 3. Click Connect – Freighter popup will appear
    const [popup] = await Promise.all([
      context.waitForEvent("page"),
      connectBtn.click(),
    ]);
    await popup.waitForLoadState();
    await popup.getByRole("button", { name: /approve|connect|allow/i }).click();
    await popup.close();

    // 4. Address must be visible on the page
    const addrEl = page.getByTestId("wallet-address");
    await expect(addrEl).toBeVisible();
    const text = await addrEl.textContent();
    // Stellar addresses start with G
    expect(text).toMatch(/^G/);

    // 5. Disconnect
    await page.getByRole("button", { name: /disconnect/i }).click();
    await expect(connectBtn).toBeVisible();
    await expect(addrEl).not.toBeVisible();
  });
});
