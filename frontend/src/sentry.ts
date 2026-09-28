/**
 * Sentry frontend integration — #773
 *
 * Initialises the Sentry SDK with:
 *   - Error tracking
 *   - Performance tracing (10% sample rate in production)
 *   - Session replay (1% normal / 100% on error)
 *   - Hashed user context (wallet address — never raw PII)
 *   - Custom tags: network (testnet/mainnet), wallet_type
 *   - PII filter: strips raw Stellar addresses from breadcrumbs
 *
 * Configuration via environment variables:
 *   VITE_SENTRY_DSN       — required in production; omit to disable
 *   VITE_APP_VERSION      — optional release identifier
 *   VITE_SENTRY_TRACES_SR — override traces sample rate (float 0–1, default 0.1)
 *
 * Call initSentry() once at the very top of main.tsx before rendering.
 *
 * After the wallet connects, call setSentryUser(walletAddress, walletType)
 * to attach hashed user context and custom tags.
 */

import * as Sentry from "@sentry/react";

// ── Stellar address pattern ───────────────────────────────────────────────────
// Matches G…, S…, M…, and P… addresses (56 chars, base32 subset)
const STELLAR_ADDRESS_RE = /\b[GSMP][A-Z2-7]{55}\b/g;

// ── PII scrubbing ─────────────────────────────────────────────────────────────

/** Replace raw Stellar addresses with a redacted placeholder. */
function redactStellarAddresses(text: string): string {
  return text.replace(STELLAR_ADDRESS_RE, "[STELLAR_ADDRESS]");
}

/** Hash a wallet address for Sentry user context — never send the raw address. */
async function hashAddress(address: string): Promise<string> {
  if (!address) return "anonymous";
  try {
    const buf = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(address)
    );
    const hex = Array.from(new Uint8Array(buf))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    // Use only the first 16 chars for brevity
    return `addr:${hex.slice(0, 16)}`;
  } catch {
    return "addr:unknown";
  }
}

// ── Sentry event processor ────────────────────────────────────────────────────

/** Custom event processor that strips PII from breadcrumb messages and URLs. */
function createPiiFilter(): Sentry.EventProcessor {
  return (event) => {
    // Scrub breadcrumb messages
    if (event.breadcrumbs?.values) {
      event.breadcrumbs.values = event.breadcrumbs.values.map((crumb) => ({
        ...crumb,
        message: crumb.message ? redactStellarAddresses(crumb.message) : crumb.message,
        data: crumb.data
          ? Object.fromEntries(
              Object.entries(crumb.data).map(([k, v]) => [
                k,
                typeof v === "string" ? redactStellarAddresses(v) : v,
              ])
            )
          : crumb.data,
      }));
    }

    // Scrub request URLs
    if (event.request?.url) {
      event.request.url = redactStellarAddresses(event.request.url);
    }

    // Scrub stack trace abs_paths
    if (event.exception?.values) {
      event.exception.values.forEach((ex) => {
        ex.stacktrace?.frames?.forEach((frame) => {
          if (frame.abs_path) {
            frame.abs_path = redactStellarAddresses(frame.abs_path);
          }
        });
      });
    }

    return event;
  };
}

// ── Public API ────────────────────────────────────────────────────────────────

let _sentryInitialised = false;

/**
 * Initialise the Sentry SDK.
 *
 * Safe to call multiple times — subsequent calls after the first are no-ops.
 * If VITE_SENTRY_DSN is absent, this function is a complete no-op.
 */
export function initSentry(): void {
  if (_sentryInitialised) return;

  const dsn = import.meta.env.VITE_SENTRY_DSN as string | undefined;
  if (!dsn) return; // No DSN → skip initialisation silently

  const tracesSampleRate = parseFloat(
    (import.meta.env.VITE_SENTRY_TRACES_SR as string | undefined) ?? "0.1"
  );

  Sentry.init({
    dsn,
    release: import.meta.env.VITE_APP_VERSION as string | undefined,
    environment: import.meta.env.MODE,

    // Error tracking — always enabled when DSN is present
    enabled: true,

    // Performance tracing — 10% of transactions in production
    tracesSampleRate: Number.isFinite(tracesSampleRate) ? tracesSampleRate : 0.1,

    // Session replay — 1% normal sampling, 100% on error
    replaysSessionSampleRate: 0.01,
    replaysOnErrorSampleRate: 1.0,

    integrations: [
      // Browser tracing for page load / navigation performance
      Sentry.browserTracingIntegration(),
      // Session replay for debugging real-user sessions
      Sentry.replayIntegration({
        // Mask all text and inputs by default to prevent PII capture
        maskAllText: true,
        blockAllMedia: false,
      }),
    ],

    // PII scrubbing: strip Stellar addresses from all captured events
    beforeSend(event) {
      return createPiiFilter()(event, {} as Sentry.EventHint) as Sentry.ErrorEvent | null;
    },

    // Additional breadcrumb scrubbing
    beforeBreadcrumb(breadcrumb) {
      if (breadcrumb.message) {
        breadcrumb.message = redactStellarAddresses(breadcrumb.message);
      }
      if (breadcrumb.data) {
        for (const key of Object.keys(breadcrumb.data)) {
          const val = breadcrumb.data[key];
          if (typeof val === "string") {
            breadcrumb.data[key] = redactStellarAddresses(val);
          }
        }
      }
      return breadcrumb;
    },

    // Ignore common noise
    ignoreErrors: [
      // Browser extension noise
      "TypeError: Cannot read properties of undefined (reading 'freighter')",
      // Network errors outside our control
      "NetworkError",
      "Failed to fetch",
      // ResizeObserver loop — benign browser quirk
      "ResizeObserver loop limit exceeded",
    ],
  });

  _sentryInitialised = true;
}

/**
 * Attach hashed wallet context and custom tags after wallet connection.
 *
 * The raw wallet address is NEVER sent to Sentry.
 * Instead we send a truncated SHA-256 hash for cross-session correlation.
 *
 * @param walletAddress  Connected Stellar wallet address (G…)
 * @param walletType     e.g. "freighter", "walletconnect", "albedo"
 * @param network        "testnet" | "mainnet"
 */
export async function setSentryUser(
  walletAddress: string,
  walletType: string,
  network: "testnet" | "mainnet" = "testnet"
): Promise<void> {
  if (!_sentryInitialised) return;

  const hashedId = await hashAddress(walletAddress);

  Sentry.setUser({ id: hashedId });
  Sentry.setTag("wallet_type", walletType);
  Sentry.setTag("network", network);
}

/**
 * Clear Sentry user context on wallet disconnect.
 */
export function clearSentryUser(): void {
  if (!_sentryInitialised) return;
  Sentry.setUser(null);
  Sentry.setTag("wallet_type", null);
}

/**
 * Manually capture an exception with optional contextual data.
 * Safe to call even when Sentry is not initialised.
 */
export function captureError(
  error: unknown,
  context?: Record<string, unknown>
): void {
  if (!_sentryInitialised) {
    // Fallback: log to console in development
    if (import.meta.env.MODE === "development") {
      console.error("[Sentry not initialised]", error, context);
    }
    return;
  }

  Sentry.withScope((scope) => {
    if (context) {
      scope.setContext("extra", context);
    }
    Sentry.captureException(error);
  });
}

/**
 * Re-export the Sentry React error boundary for use in the component tree.
 */
export { Sentry };
