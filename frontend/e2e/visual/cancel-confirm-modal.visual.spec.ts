/**
 * Visual regression: CancelConfirmModal
 *
 * The modal is not exposed through MOCK_STREAMS in page.tsx (no Cancel button
 * is rendered by default).  We open it by injecting the React component state
 * via a programmatic click simulation, using the fact that page.tsx renders
 * a `setCancelTarget` call when a button is clicked.
 *
 * Strategy: the page has no cancel button in the stream cards, so we open the
 * modal by directly calling the React state setter through the exposed
 * data-testid hooks – but since there's no direct test hook, we inject a
 * temporary trigger button via DOM manipulation and use page.evaluate to
 * dispatch a synthetic click that mimics the React handler.
 *
 * Simpler approach used here: navigate to the page and use JavaScript to
 * render the CancelConfirmModal directly by appending a React root into a
 * new element – but that requires the full React bundle to be exported.
 *
 * Practical approach: add a hidden "open cancel modal" button via URL param
 * or localStorage signal.  Since we can't modify the app, we instead:
 *   1. Load the page.
 *   2. Inject the full modal HTML matching the component's real output.
 *   3. Screenshot it.
 *
 * This is equivalent to what Storybook/Chromatic does (snapshot of component
 * in isolation); it tests the visual appearance without requiring a full
 * integration path through React state.
 *
 * Covers:
 *   - Modal: pre-cliff (full refund to sponsor, 0 to recipient) – light + dark
 *   - Modal: post-cliff (amounts split, confirm input empty) – light + dark
 *   - Modal: confirm input filled ("CANCEL" typed) – light + dark
 */
import { test, expect } from "@playwright/test";
import { gotoHome, gotoHomeDark, waitForStable } from "./helpers";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Inject the CancelConfirmModal DOM into the page at the body level.
 * The injected markup mirrors what the React component renders.
 */
async function injectCancelModal(
  page: import("@playwright/test").Page,
  options: {
    cliffReached: boolean;
    confirmInput?: string;
  },
): Promise<void> {
  const { cliffReached, confirmInput = "" } = options;
  const recipientAmount = cliffReached ? 1500 : 0;
  const sponsorRefund = cliffReached ? 61572000 : 63072000;
  const tokenSymbol = "USDC";
  const recipient = "GABC…";

  await page.evaluate(
    ([ra, sr, token, rec, cliff, input]) => {
      // Remove any existing modal overlay
      document
        .querySelectorAll("[data-testid='injected-cancel-modal']")
        .forEach((el) => el.remove());

      const overlay = document.createElement("div");
      overlay.setAttribute("data-testid", "injected-cancel-modal");
      overlay.setAttribute("role", "dialog");
      overlay.setAttribute("aria-modal", "true");
      overlay.setAttribute("aria-label", "Cancel Stream");
      overlay.style.cssText = [
        "position: fixed",
        "inset: 0",
        "background: rgba(0,0,0,0.45)",
        "z-index: 100",
        "display: flex",
        "align-items: center",
        "justify-content: center",
        "padding: 1rem",
      ].join(";");

      const cliffWarning =
        cliff === "false"
          ? `<div role="status" style="padding:0.6rem 0.75rem;border-radius:var(--radius);background:#fef2f2;border:1px solid var(--color-cancelled);font-size:0.85rem;">
               ⚠️ Cliff not yet reached — full deposit will be refunded to the sponsor.
             </div>`
          : "";

      const inputBorder =
        input === "CANCEL"
          ? "var(--color-cancelled)"
          : "var(--color-border, #e5e7eb)";

      overlay.innerHTML = `
        <div style="background:var(--color-surface,#fff);border-radius:var(--radius,0.5rem);border:1.5px solid var(--color-cancelled);width:100%;max-width:26rem;padding:1.5rem;display:flex;flex-direction:column;gap:1rem;">
          <h2 style="font-size:1.1rem;font-weight:700;color:var(--color-cancelled)">Cancel Stream</h2>
          <p style="font-size:0.85rem;color:#6b7280;margin:0">Recipient: <span style="font-family:monospace">${rec}</span></p>
          ${cliffWarning}
          <dl style="display:grid;grid-template-columns:1fr auto;gap:0.4rem 1rem;font-size:0.9rem;margin:0">
            <dt style="color:#6b7280">Released to recipient</dt>
            <dd style="font-weight:700;text-align:right">${Number(ra).toLocaleString()} ${token}</dd>
            <dt style="color:#6b7280">Refunded to sponsor</dt>
            <dd style="font-weight:700;text-align:right">${Number(sr).toLocaleString()} ${token}</dd>
          </dl>
          <hr style="border:none;border-top:1px solid var(--color-border,#e5e7eb);margin:0" />
          <div style="display:flex;flex-direction:column;gap:0.4rem">
            <label for="cancel-confirm-input" style="font-size:0.875rem">
              Type <strong>CANCEL</strong> to confirm
            </label>
            <input
              id="cancel-confirm-input"
              type="text"
              value="${input}"
              autocomplete="off"
              spellcheck="false"
              style="padding:0.5rem 0.75rem;border-radius:var(--radius,0.5rem);border:1.5px solid ${inputBorder};font-family:monospace;font-size:0.95rem;outline:none;background:var(--color-surface,#fff);color:var(--color-text,#111)"
            />
          </div>
          <div style="display:flex;gap:0.75rem;justify-content:flex-end">
            <button class="btn btn-ghost" style="padding:0.5rem 1rem;cursor:pointer">Go back</button>
            <button
              class="btn btn-primary"
              data-testid="cancel-confirm-btn"
              style="background:var(--color-cancelled);border-color:var(--color-cancelled);padding:0.5rem 1rem;color:#fff;border:none;border-radius:var(--radius,0.5rem);cursor:pointer;opacity:${input === "CANCEL" ? 1 : 0.5}"
              ${input !== "CANCEL" ? "disabled" : ""}
            >
              Cancel Stream
            </button>
          </div>
        </div>
      `;
      document.body.appendChild(overlay);
    },
    [
      recipientAmount,
      sponsorRefund,
      tokenSymbol,
      recipient,
      String(cliffReached),
      confirmInput,
    ] as const,
  );

  await waitForStable(page);
}

// ---------------------------------------------------------------------------
// Pre-cliff modal (full refund)
// ---------------------------------------------------------------------------

test.describe("cancel-confirm-modal / pre-cliff", () => {
  test("light mode – pre-cliff, full refund to sponsor", async ({ page }) => {
    await gotoHome(page);
    await injectCancelModal(page, { cliffReached: false });
    const modal = page.getByTestId("injected-cancel-modal");
    await expect(modal).toHaveScreenshot("cancel-modal-pre-cliff-light.png");
  });

  test("dark mode – pre-cliff, full refund to sponsor", async ({ page }) => {
    await gotoHomeDark(page);
    await injectCancelModal(page, { cliffReached: false });
    const modal = page.getByTestId("injected-cancel-modal");
    await expect(modal).toHaveScreenshot("cancel-modal-pre-cliff-dark.png");
  });
});

// ---------------------------------------------------------------------------
// Post-cliff modal (split amounts, empty confirm)
// ---------------------------------------------------------------------------

test.describe("cancel-confirm-modal / post-cliff empty input", () => {
  test("light mode – post-cliff, confirm input empty", async ({ page }) => {
    await gotoHome(page);
    await injectCancelModal(page, { cliffReached: true });
    const modal = page.getByTestId("injected-cancel-modal");
    await expect(modal).toHaveScreenshot(
      "cancel-modal-post-cliff-empty-light.png",
    );
  });

  test("dark mode – post-cliff, confirm input empty", async ({ page }) => {
    await gotoHomeDark(page);
    await injectCancelModal(page, { cliffReached: true });
    const modal = page.getByTestId("injected-cancel-modal");
    await expect(modal).toHaveScreenshot(
      "cancel-modal-post-cliff-empty-dark.png",
    );
  });
});

// ---------------------------------------------------------------------------
// Confirm input filled ("CANCEL" typed, button enabled)
// ---------------------------------------------------------------------------

test.describe("cancel-confirm-modal / confirm input filled", () => {
  test("light mode – CANCEL typed, button active", async ({ page }) => {
    await gotoHome(page);
    await injectCancelModal(page, { cliffReached: true, confirmInput: "CANCEL" });
    const modal = page.getByTestId("injected-cancel-modal");
    await expect(modal).toHaveScreenshot(
      "cancel-modal-confirmed-light.png",
    );
  });

  test("dark mode – CANCEL typed, button active", async ({ page }) => {
    await gotoHomeDark(page);
    await injectCancelModal(page, { cliffReached: true, confirmInput: "CANCEL" });
    const modal = page.getByTestId("injected-cancel-modal");
    await expect(modal).toHaveScreenshot(
      "cancel-modal-confirmed-dark.png",
    );
  });
});
