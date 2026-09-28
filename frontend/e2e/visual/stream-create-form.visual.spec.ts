/**
 * Visual regression: StreamCreateForm
 *
 * Covers:
 *   - Empty / pristine form (light + dark)
 *   - Form with validation errors shown (light + dark)
 *   - Form with valid values and deposit preview (light + dark)
 */
import { test, expect } from "@playwright/test";
import {
  gotoHome,
  gotoHomeDark,
  waitForStable,
} from "./helpers";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Open the "New Stream" panel so the StreamCreateForm is visible.
 */
async function openCreateForm(page: import("@playwright/test").Page) {
  const toggle = page.getByTestId("toggle-create-form");
  await expect(toggle).toBeVisible();
  await toggle.click();
  await expect(page.getByTestId("stream-create-form")).toBeVisible();
  await waitForStable(page);
}

/**
 * Fill form with valid values so the deposit preview appears.
 * Uses a deterministic address to avoid dynamic content.
 */
async function fillValidForm(page: import("@playwright/test").Page) {
  const VALID_RECIPIENT =
    "GABC2YMXJTHKFYXQJJYGV4SVRLMVN5NDKFAMX3KBQBMHK6R2STVJHMFE".padEnd(56, "A");
  const VALID_TOKEN =
    "CBVD2YMXJTHKFYXQJJYGV4SVRLMVN5NDKFAMX3KBQBMHK6R2STVJHMFE".padEnd(56, "A");

  // Real Stellar-format addresses (G… 56 chars, C… 56 chars)
  const recipient = "GABC2YMXJTHKFYXQJJYGV4SVRLMVN5NDKFAMX3KBQBMHK6R2STVJHMFE";
  const token = "CBVD2YMXJTHKFYXQJJYGV4SVRLMVN5NDKFAMX3KBQBMHK6R2STVJHMFE";

  // Ignore unused constants created above
  void VALID_RECIPIENT;
  void VALID_TOKEN;

  await page.getByLabel("Recipient address").fill(recipient);
  await page.getByLabel("Token contract (SAC)").fill(token);
  await page.getByLabel("Rate (tokens per ledger)").fill("10");
  await page.getByLabel("Cliff duration (days)").fill("30");
  await page.getByLabel("Total duration (days)").fill("365");
}

/**
 * Trigger all validation errors by submitting the empty form.
 */
async function triggerValidationErrors(page: import("@playwright/test").Page) {
  const submit = page.getByTestId("stream-create-submit");
  await submit.click();
  // Wait for at least one error to appear
  await page.waitForSelector('[role="alert"]', { timeout: 3_000 });
  await waitForStable(page);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe("stream-create-form / empty / pristine", () => {
  test("light mode – empty form", async ({ page }) => {
    await gotoHome(page);
    await openCreateForm(page);
    const form = page.getByTestId("stream-create-form");
    await expect(form).toHaveScreenshot("create-form-empty-light.png");
  });

  test("dark mode – empty form", async ({ page }) => {
    await gotoHomeDark(page);
    await openCreateForm(page);
    const form = page.getByTestId("stream-create-form");
    await expect(form).toHaveScreenshot("create-form-empty-dark.png");
  });
});

test.describe("stream-create-form / validation errors", () => {
  test("light mode – validation errors", async ({ page }) => {
    await gotoHome(page);
    await openCreateForm(page);
    await triggerValidationErrors(page);
    const form = page.getByTestId("stream-create-form");
    await expect(form).toHaveScreenshot("create-form-errors-light.png");
  });

  test("dark mode – validation errors", async ({ page }) => {
    await gotoHomeDark(page);
    await openCreateForm(page);
    await triggerValidationErrors(page);
    const form = page.getByTestId("stream-create-form");
    await expect(form).toHaveScreenshot("create-form-errors-dark.png");
  });
});

test.describe("stream-create-form / deposit preview", () => {
  test("light mode – valid values with deposit preview", async ({ page }) => {
    await gotoHome(page);
    await openCreateForm(page);
    await fillValidForm(page);
    // Wait for deposit preview to appear
    await expect(page.getByTestId("deposit-preview")).toBeVisible();
    await waitForStable(page);
    const form = page.getByTestId("stream-create-form");
    await expect(form).toHaveScreenshot("create-form-preview-light.png");
  });

  test("dark mode – valid values with deposit preview", async ({ page }) => {
    await gotoHomeDark(page);
    await openCreateForm(page);
    await fillValidForm(page);
    await expect(page.getByTestId("deposit-preview")).toBeVisible();
    await waitForStable(page);
    const form = page.getByTestId("stream-create-form");
    await expect(form).toHaveScreenshot("create-form-preview-dark.png");
  });
});
