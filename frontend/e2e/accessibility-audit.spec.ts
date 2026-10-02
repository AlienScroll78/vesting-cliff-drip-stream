/**
 * e2e/accessibility-audit.spec.ts
 *
 * WCAG 2.1 AA audit of the page this app actually serves (frontend/index.html).
 * Closes #824.
 *
 * Every test here fails the build on any axe-core violation of impact
 * "critical" or "serious" against the wcag2a / wcag2aa / wcag21a / wcag21aa
 * rule sets. Moderate and minor findings are written to the JSON report but
 * do not fail the run.
 */

import { test, expect } from "@playwright/test";
import { runAxeScan } from "./helpers/axe";

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

function blocking(results: Awaited<ReturnType<typeof runAxeScan>>) {
  return results.violations.filter(
    (v) => v.impact === "critical" || v.impact === "serious",
  );
}

function describeViolations(
  violations: Awaited<ReturnType<typeof runAxeScan>>["violations"],
): string {
  return violations
    .map(
      (v) =>
        `  [${v.impact}] ${v.id} (${v.nodes.length} node(s))\n` +
        v.nodes
          .slice(0, 6)
          .map((n) => `      - ${n.target.join(" ")}: ${n.failureSummary?.split("\n")[1] ?? ""}`)
          .join("\n"),
    )
    .join("\n");
}

test.describe("WCAG 2.1 AA audit @a11y", () => {
  test("landing page has no critical or serious violations", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    const results = await runAxeScan(page, "landing", { tags: WCAG_TAGS });

    expect(blocking(results), describeViolations(results.violations)).toHaveLength(0);
  });

  test("landing page has no critical or serious violations in dark mode", async ({
    page,
  }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await page.emulateMedia({ colorScheme: "dark" });

    const results = await runAxeScan(page, "landing-dark", { tags: WCAG_TAGS });

    expect(blocking(results), describeViolations(results.violations)).toHaveLength(0);
  });

  test("landing page has no critical or serious violations at 375px", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    const results = await runAxeScan(page, "landing-mobile", { tags: WCAG_TAGS });

    expect(blocking(results), describeViolations(results.violations)).toHaveLength(0);
  });

  test("every interactive control is reachable and labelled by keyboard", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    const expected = [
      "dark-toggle",
      "wallet-btn",
      "sponsor",
      "recipient",
      "token",
      "rate",
      "cliff-date",
      "end-date",
    ];

    const reached: string[] = [];
    for (let i = 0; i < 40; i += 1) {
      await page.keyboard.press("Tab");
      const id = await page.evaluate(() => document.activeElement?.id || "");
      if (id && !reached.includes(id)) reached.push(id);
      if (reached.length >= expected.length) break;
    }

    expect(reached).toEqual(expect.arrayContaining(expected));
  });

  test("focus is visible on every interactive control", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    const ids = ["dark-toggle", "wallet-btn", "sponsor", "rate"];
    const withoutIndicator: string[] = [];

    for (const id of ids) {
      await page.locator(`#${id}`).focus();
      const indicator = await page.locator(`#${id}`).evaluate((el) => {
        const style = window.getComputedStyle(el);
        return {
          outlineWidth: style.outlineWidth,
          outlineStyle: style.outlineStyle,
          boxShadow: style.boxShadow,
          borderColor: style.borderColor,
        };
      });
      const hasOutline =
        indicator.outlineStyle !== "none" && parseFloat(indicator.outlineWidth) > 0;
      const hasShadow = indicator.boxShadow !== "none" && indicator.boxShadow !== "";
      if (!hasOutline && !hasShadow) withoutIndicator.push(id);
    }

    expect(withoutIndicator, "controls without a visible focus indicator").toEqual([]);
  });

  test("no horizontal scrolling at 400% zoom (320px viewport)", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 512 });
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    const overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));

    expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);
  });

  test("form validation errors are announced to assistive technology", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    await page.locator("#vesting-form button[type=submit]").click();
    await page.waitForTimeout(300);

    const errorRegion = page.locator("#form-error");
    await expect(errorRegion).toBeVisible();
    await expect(errorRegion).toHaveAttribute("role", "alert");
    await expect(errorRegion).toHaveAttribute("aria-live", "assertive");
    await expect(errorRegion).not.toBeEmpty();
  });

  test("a skip link is the first tab stop and moves focus to main", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    await page.keyboard.press("Tab");
    const first = await page.evaluate(() => ({
      text: document.activeElement?.textContent?.trim() ?? "",
      href: document.activeElement?.getAttribute("href") ?? "",
    }));

    expect(first.text.toLowerCase()).toContain("skip");
    expect(first.href).toBe("#main");

    await page.keyboard.press("Enter");
    const target = await page.evaluate(() => document.activeElement?.id ?? "");
    expect(target).toBe("main");
  });
});
