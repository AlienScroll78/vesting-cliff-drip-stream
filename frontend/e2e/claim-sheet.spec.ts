import { test, expect } from "@playwright/test";

test.describe("Claim bottom sheet", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("opens with claimable amount prominent", async ({ page }) => {
    await page.getByTestId("claim-btn-1").click();
    const sheet = page.getByTestId("claim-bottom-sheet");
    await expect(sheet).toBeVisible();
    await expect(page.getByTestId("claimable-amount")).toBeVisible();
    // Amount should be non-zero for our stub active stream
    const text = await page.getByTestId("claimable-amount").textContent();
    expect(text).toMatch(/1[,.]?500/);
  });

  test("dismiss via Cancel button", async ({ page }) => {
    await page.getByTestId("claim-btn-1").click();
    await expect(page.getByTestId("claim-bottom-sheet")).toBeVisible();
    await page.getByRole("button", { name: /cancel/i }).click();
    await expect(page.getByTestId("claim-bottom-sheet")).not.toBeVisible();
  });

  test("dismiss via Escape key", async ({ page }) => {
    await page.getByTestId("claim-btn-1").click();
    await expect(page.getByTestId("claim-bottom-sheet")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("claim-bottom-sheet")).not.toBeVisible();
  });

  test("dismiss via backdrop click", async ({ page }) => {
    await page.getByTestId("claim-btn-1").click();
    await expect(page.getByTestId("claim-bottom-sheet")).toBeVisible();
    // Click on the backdrop (outside the sheet)
    await page.locator(".bottom-sheet-backdrop").click({ position: { x: 10, y: 10 } });
    await expect(page.getByTestId("claim-bottom-sheet")).not.toBeVisible();
  });

  test("swipe down dismisses sheet on mobile", async ({ page }) => {
    // Only meaningful on touch projects; simulate touch events
    await page.getByTestId("claim-btn-1").click();
    const sheet = page.getByTestId("claim-bottom-sheet");
    await expect(sheet).toBeVisible();

    const box = await sheet.boundingBox();
    if (!box) throw new Error("Sheet not found");

    const cx = box.x + box.width / 2;
    const cy = box.y + 20;

    await page.touchscreen.tap(cx, cy);
    // Simulate swipe down by dispatching touch events
    await page.evaluate(([x, y]) => {
      const el = document.querySelector("[data-testid='claim-bottom-sheet']")!;
      el.dispatchEvent(new TouchEvent("touchstart", { touches: [new Touch({ identifier: 1, target: el, clientX: x, clientY: y })] }));
      el.dispatchEvent(new TouchEvent("touchend", { changedTouches: [new Touch({ identifier: 1, target: el, clientX: x, clientY: y + 80 })] }));
    }, [cx, cy]);

    await expect(sheet).not.toBeVisible();
  });
});
