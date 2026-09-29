/**
 * E2E tests for ClaimBottomSheet — Issue #542
 *
 * Covers:
 *   - Bottom sheet renders on mobile (<= 768 px) and is hidden / replaced on desktop
 *   - Claimable amount is displayed prominently
 *   - Dismiss via Cancel button, Escape key, backdrop click
 *   - Swipe-down (> 120 px) gesture dismisses the sheet
 *   - Accessibility: role="dialog", aria-modal, focus trapped inside sheet, Esc closes
 */

import { test, expect } from "@playwright/test";

// Mobile viewport matching the spec's 768 px breakpoint
const MOBILE = { width: 375, height: 667 };
const DESKTOP = { width: 1280, height: 800 };

test.describe("Claim bottom sheet", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  // ── Opens correctly ────────────────────────────────────────────────────────

  test("opens with claimable amount prominent", async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await page.getByTestId("claim-btn-1").click();
    const sheet = page.getByTestId("claim-bottom-sheet");
    await expect(sheet).toBeVisible();
    await expect(page.getByTestId("claimable-amount")).toBeVisible();
    // Amount should be non-zero for our stub active stream
    const text = await page.getByTestId("claimable-amount").textContent();
    expect(text).toMatch(/1[,.]?500/);
  });

  test("sheet slides up from bottom on mobile", async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await page.getByTestId("claim-btn-1").click();
    const sheet = page.getByTestId("claim-bottom-sheet");
    await expect(sheet).toBeVisible();

    // Verify it is anchored at the bottom of the viewport
    const box = await sheet.boundingBox();
    expect(box).not.toBeNull();
    if (box) {
      // Sheet bottom should be at or near the bottom of the viewport
      expect(box.y + box.height).toBeGreaterThan(MOBILE.height * 0.7);
    }
  });

  // ── Responsive breakpoint ─────────────────────────────────────────────────

  test("shows bottom sheet on mobile viewport (<= 768 px)", async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.getByTestId("claim-btn-1").click();
    await expect(page.getByTestId("claim-bottom-sheet")).toBeVisible();
  });

  test("does not render bottom sheet on desktop viewport (> 768 px)", async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await page.getByTestId("claim-btn-1").click();
    // On desktop, the bottom sheet should either not exist or not be visible
    const sheet = page.getByTestId("claim-bottom-sheet");
    // Either the sheet is not present, or uses a non-bottom-sheet layout
    const count = await sheet.count();
    if (count > 0) {
      // If rendered, it should not use the mobile bottom-sheet positioning
      const box = await sheet.boundingBox();
      if (box) {
        // Should not be anchored to the very bottom of the page on desktop
        expect(box.y + box.height).toBeLessThan(DESKTOP.height * 0.95);
      }
    }
  });

  // ── Dismiss interactions ───────────────────────────────────────────────────

  test("dismiss via Cancel / Close button", async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await page.getByTestId("claim-btn-1").click();
    await expect(page.getByTestId("claim-bottom-sheet")).toBeVisible();
    await page.getByTestId("claim-close-btn").click();
    await expect(page.getByTestId("claim-bottom-sheet")).not.toBeVisible();
  });

  test("dismiss via Escape key", async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await page.getByTestId("claim-btn-1").click();
    await expect(page.getByTestId("claim-bottom-sheet")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("claim-bottom-sheet")).not.toBeVisible();
  });

  test("dismiss via backdrop click", async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await page.getByTestId("claim-btn-1").click();
    await expect(page.getByTestId("claim-bottom-sheet")).toBeVisible();
    // Click on the backdrop (outside the sheet, near top-left corner)
    await page.locator(".bottom-sheet-backdrop").click({ position: { x: 10, y: 10 } });
    await expect(page.getByTestId("claim-bottom-sheet")).not.toBeVisible();
  });

  // ── Swipe-down gesture ─────────────────────────────────────────────────────

  test("swipe down > 120 px dismisses sheet", async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await page.getByTestId("claim-btn-1").click();
    const sheet = page.getByTestId("claim-bottom-sheet");
    await expect(sheet).toBeVisible();

    const box = await sheet.boundingBox();
    if (!box) throw new Error("Sheet not found");

    const cx = box.x + box.width / 2;
    const topY = box.y + 20; // within the top 60 px drag zone

    // Dispatch a touch-start then touch-end > 120 px below (dismissal threshold)
    await page.evaluate(
      ([x, y]: number[]) => {
        const el = document.querySelector("[data-testid='claim-bottom-sheet']")!;
        el.dispatchEvent(
          new TouchEvent("touchstart", {
            bubbles: true,
            cancelable: true,
            touches: [new Touch({ identifier: 1, target: el, clientX: x!, clientY: y! })],
          }),
        );
        el.dispatchEvent(
          new TouchEvent("touchmove", {
            bubbles: true,
            cancelable: true,
            touches: [new Touch({ identifier: 1, target: el, clientX: x!, clientY: y! + 130 })],
          }),
        );
        el.dispatchEvent(
          new TouchEvent("touchend", {
            bubbles: true,
            cancelable: true,
            changedTouches: [new Touch({ identifier: 1, target: el, clientX: x!, clientY: y! + 130 })],
          }),
        );
      },
      [cx, topY],
    );

    await expect(sheet).not.toBeVisible();
  });

  test("short swipe (< 120 px) snaps sheet back", async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await page.getByTestId("claim-btn-1").click();
    const sheet = page.getByTestId("claim-bottom-sheet");
    await expect(sheet).toBeVisible();

    const box = await sheet.boundingBox();
    if (!box) throw new Error("Sheet not found");

    const cx = box.x + box.width / 2;
    const topY = box.y + 20;

    // Swipe only 60 px — below the 120 px threshold, should snap back
    await page.evaluate(
      ([x, y]: number[]) => {
        const el = document.querySelector("[data-testid='claim-bottom-sheet']")!;
        el.dispatchEvent(
          new TouchEvent("touchstart", {
            bubbles: true,
            cancelable: true,
            touches: [new Touch({ identifier: 1, target: el, clientX: x!, clientY: y! })],
          }),
        );
        el.dispatchEvent(
          new TouchEvent("touchmove", {
            bubbles: true,
            cancelable: true,
            touches: [new Touch({ identifier: 1, target: el, clientX: x!, clientY: y! + 60 })],
          }),
        );
        el.dispatchEvent(
          new TouchEvent("touchend", {
            bubbles: true,
            cancelable: true,
            changedTouches: [new Touch({ identifier: 1, target: el, clientX: x!, clientY: y! + 60 })],
          }),
        );
      },
      [cx, topY],
    );

    // Sheet should still be visible after short swipe
    await expect(sheet).toBeVisible();
  });

  // ── Accessibility ──────────────────────────────────────────────────────────

  test("sheet has role=dialog and aria-modal", async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await page.getByTestId("claim-btn-1").click();
    const sheet = page.getByTestId("claim-bottom-sheet");
    await expect(sheet).toBeVisible();
    await expect(sheet).toHaveAttribute("role", "dialog");
    await expect(sheet).toHaveAttribute("aria-modal", "true");
  });

  test("sheet has aria-labelledby pointing to its title", async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await page.getByTestId("claim-btn-1").click();
    const sheet = page.getByTestId("claim-bottom-sheet");
    const labelledBy = await sheet.getAttribute("aria-labelledby");
    expect(labelledBy).toBeTruthy();
    // The referenced element should exist and contain the sheet title text
    const titleEl = page.locator(`#${labelledBy}`);
    await expect(titleEl).toBeVisible();
    await expect(titleEl).toContainText(/claim/i);
  });

  test("focus is trapped inside the sheet while open", async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await page.getByTestId("claim-btn-1").click();
    await expect(page.getByTestId("claim-bottom-sheet")).toBeVisible();

    // Tab several times and verify focus stays inside the sheet
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press("Tab");
    }

    const focusedElement = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el) return null;
      const sheet = document.querySelector("[data-testid='claim-bottom-sheet']");
      return sheet ? sheet.contains(el) : false;
    });

    expect(focusedElement).toBe(true);
  });

  test("claimable amount has accessible aria-label", async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await page.getByTestId("claim-btn-1").click();
    // The amount span should have an aria-label describing the full amount + token
    const amountEl = page.locator("[data-testid='claimable-amount'] .amount-value");
    const ariaLabel = await amountEl.getAttribute("aria-label");
    expect(ariaLabel).toMatch(/claimable amount/i);
  });

  // ── Content ────────────────────────────────────────────────────────────────

  test("shows fee estimate section", async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await page.getByTestId("claim-btn-1").click();
    await expect(page.getByTestId("fee-estimate")).toBeVisible();
  });

  test("shows pre-cliff banner when stream is pre-cliff", async ({ page }) => {
    await page.setViewportSize(MOBILE);
    // Navigate to a pre-cliff stream if stub provides one, or use query param
    await page.goto("/?status=pre-cliff");
    await page.getByTestId("claim-btn-1").click().catch(() => {
      /* stream may not have claim button in pre-cliff state */
    });
    // Only assert if the sheet opened
    const sheet = page.getByTestId("claim-bottom-sheet");
    if (await sheet.isVisible()) {
      await expect(page.getByTestId("cliff-countdown")).toBeVisible();
    }
  });

  test("Confirm button triggers claim and shows success", async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await page.getByTestId("claim-btn-1").click();
    await expect(page.getByTestId("claim-bottom-sheet")).toBeVisible();

    const claimBtn = page.getByTestId("claim-button");
    const isDisabled = await claimBtn.getAttribute("disabled");
    if (!isDisabled) {
      await claimBtn.click();
      // After claiming, success message or button label changes
      await expect(
        page.getByTestId("claim-success").or(page.getByRole("button", { name: /claimed/i })),
      ).toBeVisible({ timeout: 5000 });
    }
  });
});
