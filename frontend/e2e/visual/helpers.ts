/**
 * Shared helpers for visual-regression tests.
 *
 * Import these from individual spec files:
 *   import { enableDarkMode, disableDarkMode, waitForStable } from "./helpers";
 */
import { type Page } from "@playwright/test";

// ---------------------------------------------------------------------------
// Dark mode
// ---------------------------------------------------------------------------

/**
 * Enable dark mode by setting the same localStorage key the useDarkMode hook
 * reads, then adding the `dark` class to <html>.  Reload is not needed
 * because the inline script in index.html applies the class before first
 * paint; for already-loaded pages we apply it directly.
 */
export async function enableDarkMode(page: Page): Promise<void> {
  await page.evaluate(() => {
    localStorage.setItem("vesting-dark-mode", "true");
    document.documentElement.classList.add("dark");
  });
}

/**
 * Disable dark mode (restore light mode).
 */
export async function disableDarkMode(page: Page): Promise<void> {
  await page.evaluate(() => {
    localStorage.setItem("vesting-dark-mode", "false");
    document.documentElement.classList.remove("dark");
  });
}

// ---------------------------------------------------------------------------
// Stability helpers
// ---------------------------------------------------------------------------

/**
 * Wait for all CSS transitions and animations to finish before snapshotting.
 * Playwright's `reducedMotion: "reduce"` disables most animations, but some
 * libraries only honour `prefers-reduced-motion` via media query, so this
 * provides an extra safety net.
 */
export async function waitForStable(page: Page): Promise<void> {
  // Wait for all images to load
  await page.evaluate(() =>
    Promise.all(
      Array.from(document.images)
        .filter((img) => !img.complete)
        .map(
          (img) =>
            new Promise<void>((resolve) => {
              img.onload = img.onerror = () => resolve();
            }),
        ),
    ),
  );

  // Give any remaining transitions a single frame to settle
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
  );
}

/**
 * Wait for the skeleton loading state to disappear from the page.
 * The StreamList uses a setTimeout(800 ms) before showing real content.
 */
export async function waitForStreamList(page: Page): Promise<void> {
  // The skeleton has `data-testid="stream-list-skeleton"` or aria-hidden rows.
  // Once skeletons are gone the real `.stream-card` elements are present.
  await page.waitForSelector(".stream-card", { timeout: 5_000 });
  await waitForStable(page);
}

// ---------------------------------------------------------------------------
// Navigation helpers
// ---------------------------------------------------------------------------

/**
 * Navigate to the dashboard and wait for the stream list to load.
 */
export async function gotoHome(page: Page): Promise<void> {
  await page.goto("/");
  await waitForStreamList(page);
}

/**
 * Navigate to the dashboard and wait for the stream list to load,
 * then enable dark mode.
 */
export async function gotoHomeDark(page: Page): Promise<void> {
  // Set dark mode in localStorage *before* navigating so the inline script
  // in index.html picks it up and adds `.dark` before first paint – this
  // avoids a flash-of-light-mode that could cause screenshot instability.
  await page.goto("/");
  // Set storage, then reload so the inline <script> applies .dark before paint
  await page.evaluate(() =>
    localStorage.setItem("vesting-dark-mode", "true"),
  );
  await page.reload();
  await waitForStreamList(page);
}

// ---------------------------------------------------------------------------
// Snapshot helpers
// ---------------------------------------------------------------------------

/**
 * Hide dynamic / time-sensitive elements before snapshotting to prevent
 * non-deterministic diffs.  Masks are drawn as solid rectangles over the
 * element in the screenshot.
 *
 * Use `page.locator(selector)` to build the locator array.
 */
export const DYNAMIC_SELECTORS = [
  // Timestamps and counters that change between runs
  '[data-testid="fee-value"]',
  '[data-testid="fee-loading"]',
  // SVG-based charts that may differ by sub-pixel due to floating-point maths
  ".recharts-surface",
];
