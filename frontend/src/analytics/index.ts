/**
 * Analytics module – Issue #546
 *
 * Tracks key conversion-funnel events using PostHog.
 *
 * Guards:
 *   - Disabled entirely when VITE_ANALYTICS_ENABLED !== "true"
 *   - Also disabled when the user has opted out (localStorage key "analytics_opt_out")
 *
 * Privacy:
 *   - No wallet addresses or token amounts in event properties (PII-free)
 *   - Autocapture is disabled; only the listed events are sent
 */

import posthog from "posthog-js";

// ---------------------------------------------------------------------------
// Environment guard – VITE_ANALYTICS_ENABLED must be "true" to enable
// ---------------------------------------------------------------------------

function isAnalyticsEnabled(): boolean {
  // In Vite apps env vars are accessed via import.meta.env
  // We guard with a try/catch so this works in SSR / test environments too.
  try {
    // @ts-expect-error — import.meta.env is only present in Vite builds
    const enabled = import.meta.env?.VITE_ANALYTICS_ENABLED;
    return enabled === "true";
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// PostHog configuration
// ---------------------------------------------------------------------------

const POSTHOG_KEY =
  (() => {
    try {
      // @ts-expect-error — import.meta.env is only present in Vite builds
      return import.meta.env?.VITE_POSTHOG_KEY ?? "";
    } catch {
      return "";
    }
  })();

const POSTHOG_HOST =
  (() => {
    try {
      // @ts-expect-error — import.meta.env is only present in Vite builds
      return import.meta.env?.VITE_POSTHOG_HOST ?? "https://app.posthog.com";
    } catch {
      return "https://app.posthog.com";
    }
  })();

const OPT_OUT_KEY = "analytics_opt_out";

// ---------------------------------------------------------------------------
// Opt-out helpers
// ---------------------------------------------------------------------------

export function isOptedOut(): boolean {
  try {
    return typeof window !== "undefined" && localStorage.getItem(OPT_OUT_KEY) === "true";
  } catch {
    return false;
  }
}

export function optOut(): void {
  try {
    localStorage.setItem(OPT_OUT_KEY, "true");
  } catch {
    /* ignore storage errors */
  }
  posthog.opt_out_capturing();
}

export function optIn(): void {
  try {
    localStorage.removeItem(OPT_OUT_KEY);
  } catch {
    /* ignore storage errors */
  }
  posthog.opt_in_capturing();
}

// ---------------------------------------------------------------------------
// Initialisation
// ---------------------------------------------------------------------------

export function initAnalytics(): void {
  if (typeof window === "undefined") return;
  if (!isAnalyticsEnabled()) return;
  if (!POSTHOG_KEY) return;
  if (isOptedOut()) return;

  posthog.init(POSTHOG_KEY, {
    api_host: POSTHOG_HOST,
    autocapture: false,
    capture_pageview: false,
    persistence: "localStorage",
  });
}

// ---------------------------------------------------------------------------
// Internal fire-and-forget helper
// ---------------------------------------------------------------------------

function track(event: string, props?: Record<string, unknown>): void {
  if (!isAnalyticsEnabled()) return;
  if (isOptedOut()) return;
  posthog.capture(event, props);
}

// ---------------------------------------------------------------------------
// Public analytics API  (all events from Issue #546)
// ---------------------------------------------------------------------------

export const analytics = {
  // ── Wallet ────────────────────────────────────────────────────────────────

  /** Fired when the user successfully connects their wallet. No address sent (PII-free). */
  walletConnected(): void {
    track("wallet_connected");
  },

  /** Fired when the user disconnects their wallet. */
  walletDisconnected(): void {
    track("wallet_disconnected");
  },

  // ── Stream lifecycle ──────────────────────────────────────────────────────

  /** Fired when the user opens the create-stream wizard/form. */
  streamCreateStarted(): void {
    track("stream_create_started");
  },

  /**
   * Fired when the stream creation transaction is confirmed on-chain.
   * @param tokenSymbol  The token symbol (e.g. "USDC") — not an address.
   */
  streamCreateCompleted(tokenSymbol: string): void {
    track("stream_create_completed", { token: tokenSymbol });
  },

  /**
   * Fired when the user abandons the create-stream flow without submitting
   * (e.g. closes the wizard or navigates away mid-flow).
   */
  streamCreateAbandoned(): void {
    track("stream_create_abandoned");
  },

  // ── Claim ─────────────────────────────────────────────────────────────────

  /**
   * Fired when the user initiates a claim (opens the claim sheet / clicks
   * "Claim" before signing).  No amount is sent to stay PII-free.
   * @param tokenSymbol  Token symbol for segmentation.
   */
  claimInitiated(tokenSymbol: string): void {
    track("claim_initiated", { token: tokenSymbol });
  },

  /**
   * Fired when the claim transaction is confirmed.
   * @param tokenSymbol  Token symbol for segmentation.
   */
  claimCompleted(tokenSymbol: string): void {
    track("claim_completed", { token: tokenSymbol });
  },

  // ── Cancellation ──────────────────────────────────────────────────────────

  /** Fired when the sponsor confirms stream cancellation. */
  streamCancelled(): void {
    track("stream_cancelled");
  },

  // ── Navigation ────────────────────────────────────────────────────────────

  /** Fired when the history/transactions page is viewed. */
  historyPageViewed(): void {
    track("history_page_viewed");
  },

  // ── Legacy convenience (kept for backwards-compat) ────────────────────────

  /** @deprecated Use walletConnected() instead */
  pageView(page: string): void {
    track("page_view", { page });
  },
};
