/**
 * e2e/pages/index.ts
 *
 * Page object models for core dApp views.
 * Used by both accessibility tests (#362) and cross-browser journey tests (#364).
 */

import { Page, Locator } from "@playwright/test";

// ── Dashboard page ────────────────────────────────────────────────────────────

export class DashboardPage {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  async goto() {
    await this.page.goto("/");
  }

  /** Connect wallet button in the top-right nav */
  get connectWalletButton(): Locator {
    return this.page.getByRole("button", { name: /connect wallet/i });
  }

  /** Table or list of active streams */
  get streamList(): Locator {
    return this.page.getByTestId("stream-list");
  }

  /** Link/button to open the create stream form */
  get createStreamButton(): Locator {
    return this.page.getByRole("link", { name: /create stream/i }).or(
      this.page.getByRole("button", { name: /create stream/i })
    );
  }
}

// ── Create stream form ────────────────────────────────────────────────────────

export class CreateStreamPage {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  async goto() {
    await this.page.goto("/create");
  }

  get recipientInput(): Locator {
    return this.page.getByLabel(/recipient/i);
  }

  get tokenInput(): Locator {
    return this.page.getByLabel(/token/i);
  }

  get rateInput(): Locator {
    return this.page.getByLabel(/rate/i);
  }

  get cliffDurationInput(): Locator {
    return this.page.getByLabel(/cliff duration/i);
  }

  get totalDurationInput(): Locator {
    return this.page.getByLabel(/total duration/i);
  }

  get submitButton(): Locator {
    return this.page.getByRole("button", { name: /create/i });
  }
}

// ── Stream detail page ────────────────────────────────────────────────────────

export class StreamDetailPage {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  async goto(recipientAddress: string) {
    await this.page.goto(`/stream/${recipientAddress}`);
  }

  get claimButton(): Locator {
    return this.page.getByRole("button", { name: /claim/i });
  }

  get cancelButton(): Locator {
    return this.page.getByRole("button", { name: /cancel stream/i });
  }

  get cliffStatus(): Locator {
    return this.page.getByTestId("cliff-status");
  }

  get claimableAmount(): Locator {
    return this.page.getByTestId("claimable-amount");
  }
}

// ── Cancel confirmation dialog ────────────────────────────────────────────────

export class CancelDialog {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  get dialog(): Locator {
    return this.page.getByRole("dialog", { name: /cancel stream/i });
  }

  get confirmButton(): Locator {
    return this.dialog.getByRole("button", { name: /confirm/i });
  }

  get cancelButton(): Locator {
    return this.dialog.getByRole("button", { name: /go back/i });
  }
}

// ── Wallet modal ──────────────────────────────────────────────────────────────

export class WalletModal {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  get modal(): Locator {
    return this.page.getByRole("dialog", { name: /connect wallet/i });
  }

  get freighterOption(): Locator {
    return this.modal.getByRole("button", { name: /freighter/i });
  }

  get closeButton(): Locator {
    return this.modal.getByRole("button", { name: /close/i });
  }
}
