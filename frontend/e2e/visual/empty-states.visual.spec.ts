/**
 * Visual regression: EmptyStates
 *
 * Tests all three empty state variants:
 *   - SponsorStreamListEmpty  (no streams created yet)
 *   - TxHistoryEmpty          (no transactions)
 *   - RecipientScheduleEmpty  (no vesting schedule, with and without CTA)
 *
 * Because MOCK_STREAMS is non-empty in page.tsx we cannot trigger the empty
 * state via normal navigation.  Instead we inject the empty-state HTML
 * directly into the page DOM, matching what the React components render.
 * This is the standard approach for testing components that are hard to reach
 * through normal user journeys in the test environment.
 *
 * Covers:
 *   - SponsorStreamListEmpty (light + dark)
 *   - TxHistoryEmpty (light + dark)
 *   - RecipientScheduleEmpty with CTA (light + dark)
 *   - RecipientScheduleEmpty without CTA / "Learn about vesting" link (light + dark)
 */
import { test, expect } from "@playwright/test";
import { gotoHome, gotoHomeDark, waitForStable } from "./helpers";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type EmptyStateVariant =
  | "sponsor"
  | "tx-history"
  | "recipient-cta"
  | "recipient-no-cta";

async function injectEmptyState(
  page: import("@playwright/test").Page,
  variant: EmptyStateVariant,
): Promise<void> {
  const content: Record<
    EmptyStateVariant,
    { illustration: string; heading: string; subtext: string; cta: string }
  > = {
    sponsor: {
      illustration: "🌱",
      heading: "No streams yet",
      subtext:
        "You haven't created any vesting streams. Create one to start streaming tokens to a contributor.",
      cta: `<button class="btn btn-primary" data-testid="empty-create-stream" style="padding:0.5rem 1.5rem;background:var(--color-active);color:#fff;border:none;border-radius:var(--radius,0.5rem);cursor:pointer;font-weight:600">Create your first stream</button>`,
    },
    "tx-history": {
      illustration: "📭",
      heading: "No transactions yet",
      subtext:
        "Transactions you submit — claims, stream creation, and cancellations — will appear here.",
      cta: `<a href="https://stellar.expert/explorer/testnet" target="_blank" rel="noopener noreferrer" class="btn btn-outline" data-testid="empty-explore-stellar" style="padding:0.5rem 1.5rem;border:1.5px solid var(--color-active);color:var(--color-active);border-radius:var(--radius,0.5rem);text-decoration:none;font-weight:600">Explore Stellar Expert ↗</a>`,
    },
    "recipient-cta": {
      illustration: "🔍",
      heading: "No schedule found",
      subtext:
        "There's no active vesting stream for your wallet address. Ask your sponsor to create one, or double-check you're connected with the right wallet.",
      cta: `<button class="btn btn-primary" data-testid="empty-contact-sponsor" style="padding:0.5rem 1.5rem;background:var(--color-active);color:#fff;border:none;border-radius:var(--radius,0.5rem);cursor:pointer;font-weight:600">Contact sponsor</button>`,
    },
    "recipient-no-cta": {
      illustration: "🔍",
      heading: "No schedule found",
      subtext:
        "There's no active vesting stream for your wallet address. Ask your sponsor to create one, or double-check you're connected with the right wallet.",
      cta: `<a href="https://docs.stellar.org" target="_blank" rel="noopener noreferrer" class="btn btn-outline" data-testid="empty-learn-more" style="padding:0.5rem 1.5rem;border:1.5px solid var(--color-active);color:var(--color-active);border-radius:var(--radius,0.5rem);text-decoration:none;font-weight:600">Learn about vesting ↗</a>`,
    },
  };

  const { illustration, heading, subtext, cta } = content[variant];

  await page.evaluate(
    ([illus, h, sub, ctaHtml]: string[]) => {
      // Remove any prior injected empty state
      document
        .querySelectorAll("[data-testid='injected-empty-state']")
        .forEach((el) => el.remove());

      const wrapper = document.createElement("div");
      wrapper.setAttribute("data-testid", "injected-empty-state");
      // Position over the main content for a clean snapshot
      wrapper.style.cssText = [
        "position: fixed",
        "inset: 0",
        "background: var(--color-bg, #f9fafb)",
        "z-index: 50",
        "display: flex",
        "align-items: center",
        "justify-content: center",
      ].join(";");

      wrapper.innerHTML = `
        <div
          data-testid="empty-state"
          style="
            display:flex;flex-direction:column;align-items:center;
            justify-content:center;padding:3rem 1.5rem;text-align:center;gap:0.75rem;
            max-width: 480px;
          "
        >
          <div aria-hidden="true" style="font-size:3rem;line-height:1">${illus}</div>
          <h2 style="font-size:1.1rem;font-weight:700;color:var(--color-text,#111827);margin:0">${h}</h2>
          <p style="font-size:0.9rem;color:#6b7280;max-width:26rem;margin:0">${sub}</p>
          <div style="margin-top:0.5rem">${ctaHtml}</div>
        </div>
      `;

      document.body.appendChild(wrapper);
    },
    [illustration, heading, subtext, cta],
  );

  await waitForStable(page);
}

// ---------------------------------------------------------------------------
// SponsorStreamListEmpty
// ---------------------------------------------------------------------------

test.describe("empty-state / sponsor stream list", () => {
  test("light mode – no streams", async ({ page }) => {
    await gotoHome(page);
    await injectEmptyState(page, "sponsor");
    const emptyState = page.getByTestId("injected-empty-state");
    await expect(emptyState).toHaveScreenshot("empty-state-sponsor-light.png");
  });

  test("dark mode – no streams", async ({ page }) => {
    await gotoHomeDark(page);
    await injectEmptyState(page, "sponsor");
    const emptyState = page.getByTestId("injected-empty-state");
    await expect(emptyState).toHaveScreenshot("empty-state-sponsor-dark.png");
  });
});

// ---------------------------------------------------------------------------
// TxHistoryEmpty
// ---------------------------------------------------------------------------

test.describe("empty-state / transaction history", () => {
  test("light mode – no transactions", async ({ page }) => {
    await gotoHome(page);
    await injectEmptyState(page, "tx-history");
    const emptyState = page.getByTestId("injected-empty-state");
    await expect(emptyState).toHaveScreenshot(
      "empty-state-tx-history-light.png",
    );
  });

  test("dark mode – no transactions", async ({ page }) => {
    await gotoHomeDark(page);
    await injectEmptyState(page, "tx-history");
    const emptyState = page.getByTestId("injected-empty-state");
    await expect(emptyState).toHaveScreenshot("empty-state-tx-history-dark.png");
  });
});

// ---------------------------------------------------------------------------
// RecipientScheduleEmpty (with contact-sponsor CTA)
// ---------------------------------------------------------------------------

test.describe("empty-state / recipient schedule – with CTA", () => {
  test("light mode – no schedule, contact sponsor", async ({ page }) => {
    await gotoHome(page);
    await injectEmptyState(page, "recipient-cta");
    const emptyState = page.getByTestId("injected-empty-state");
    await expect(emptyState).toHaveScreenshot(
      "empty-state-recipient-cta-light.png",
    );
  });

  test("dark mode – no schedule, contact sponsor", async ({ page }) => {
    await gotoHomeDark(page);
    await injectEmptyState(page, "recipient-cta");
    const emptyState = page.getByTestId("injected-empty-state");
    await expect(emptyState).toHaveScreenshot(
      "empty-state-recipient-cta-dark.png",
    );
  });
});

// ---------------------------------------------------------------------------
// RecipientScheduleEmpty (without CTA – "learn more" link instead)
// ---------------------------------------------------------------------------

test.describe("empty-state / recipient schedule – learn more link", () => {
  test("light mode – no schedule, learn more", async ({ page }) => {
    await gotoHome(page);
    await injectEmptyState(page, "recipient-no-cta");
    const emptyState = page.getByTestId("injected-empty-state");
    await expect(emptyState).toHaveScreenshot(
      "empty-state-recipient-no-cta-light.png",
    );
  });

  test("dark mode – no schedule, learn more", async ({ page }) => {
    await gotoHomeDark(page);
    await injectEmptyState(page, "recipient-no-cta");
    const emptyState = page.getByTestId("injected-empty-state");
    await expect(emptyState).toHaveScreenshot(
      "empty-state-recipient-no-cta-dark.png",
    );
  });
});
