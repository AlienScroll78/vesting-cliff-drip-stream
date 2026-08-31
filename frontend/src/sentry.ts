import * as Sentry from '@sentry/react';

/**
 * Initialise the Sentry SDK.
 *
 * Reads the DSN from the VITE_SENTRY_DSN environment variable.
 * If the variable is absent (e.g. local development without a Sentry project),
 * this function is a no-op — the app runs normally without error reporting.
 *
 * Call this once at the top of main.tsx / App.tsx before rendering the tree.
 */
export function initSentry(): void {
  const dsn = import.meta.env.VITE_SENTRY_DSN as string | undefined;

  if (!dsn) {
    // No DSN configured — skip initialisation silently
    return;
  }

  Sentry.init({
    dsn,
    environment: import.meta.env.MODE,
    // Capture 20% of transactions for performance monitoring
    tracesSampleRate: 0.2,
    // Attach release info if injected at build time
    release: import.meta.env.VITE_APP_VERSION as string | undefined,
    // Only send errors in non-development environments by default
    enabled: import.meta.env.MODE !== 'development',
    integrations: [
      Sentry.browserTracingIntegration(),
    ],
  });
}
