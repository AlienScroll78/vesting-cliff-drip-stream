import { test, expect } from "@playwright/test";

test.describe("Stream status badges", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("legend is visible with all four statuses", async ({ page }) => {
    const legend = page.getByRole("note", { name: /legend/i });
    await expect(legend).toBeVisible();
    for (const label of ["Active", "Pre-cliff", "Completed", "Cancelled"]) {
      await expect(legend.getByText(label)).toBeVisible();
    }
  });

  test("each badge has an accessible aria-label", async ({ page }) => {
    const badges = page.locator(".badge");
    const count = await badges.count();
    expect(count).toBeGreaterThan(0);
    for (let i = 0; i < count; i++) {
      await expect(badges.nth(i)).toHaveAttribute("aria-label", /Status:/);
    }
  });

  test("badges include a non-colour indicator (symbol)", async ({ page }) => {
    // Each badge must contain a text symbol for colour-blind users
    for (const symbol of ["●", "◐", "✓", "✕"]) {
      await expect(page.locator(".badge").filter({ hasText: symbol }).first()).toBeVisible();
    }
  });
});
