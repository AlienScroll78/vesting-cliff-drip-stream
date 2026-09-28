/**
 * Visual regression: stream card
 *
 * Covers:
 *   - Active stream card (light + dark)
 *   - Pre-cliff stream card (light + dark)
 *   - Completed stream card (light + dark)
 *   - Cancelled stream card (light + dark)
 *   - Full stream list (light + dark)
 */
import { test, expect } from "@playwright/test";
import {
  gotoHome,
  gotoHomeDark,
  waitForStable,
  DYNAMIC_SELECTORS,
} from "./helpers";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function dynamicMasks(page: import("@playwright/test").Page) {
  return DYNAMIC_SELECTORS.map((sel) => page.locator(sel));
}

// ---------------------------------------------------------------------------
// Full stream list
// ---------------------------------------------------------------------------

test.describe("stream-card / full list", () => {
  test("light mode – full stream list", async ({ page }) => {
    await gotoHome(page);
    const list = page.locator(".stream-list");
    await expect(list).toBeVisible();
    await waitForStable(page);
    await expect(list).toHaveScreenshot("stream-list-light.png", {
      mask: dynamicMasks(page),
    });
  });

  test("dark mode – full stream list", async ({ page }) => {
    await gotoHomeDark(page);
    const list = page.locator(".stream-list");
    await expect(list).toBeVisible();
    await waitForStable(page);
    await expect(list).toHaveScreenshot("stream-list-dark.png", {
      mask: dynamicMasks(page),
    });
  });
});

// ---------------------------------------------------------------------------
// Individual card states
// ---------------------------------------------------------------------------

test.describe("stream-card / individual states", () => {
  // Each card's position in MOCK_STREAMS (0-indexed):
  //   0 → active, 1 → pre-cliff, 2 → completed, 3 → cancelled
  const CARD_STATUSES = [
    { index: 0, status: "active" },
    { index: 1, status: "pre-cliff" },
    { index: 2, status: "completed" },
    { index: 3, status: "cancelled" },
  ] as const;

  for (const { index, status } of CARD_STATUSES) {
    test(`light mode – ${status} card`, async ({ page }) => {
      await gotoHome(page);
      const cards = page.locator(".stream-card");
      const card = cards.nth(index);
      await expect(card).toBeVisible();
      await waitForStable(page);
      await expect(card).toHaveScreenshot(`stream-card-${status}-light.png`, {
        mask: dynamicMasks(page),
      });
    });

    test(`dark mode – ${status} card`, async ({ page }) => {
      await gotoHomeDark(page);
      const cards = page.locator(".stream-card");
      const card = cards.nth(index);
      await expect(card).toBeVisible();
      await waitForStable(page);
      await expect(card).toHaveScreenshot(`stream-card-${status}-dark.png`, {
        mask: dynamicMasks(page),
      });
    });
  }
});
