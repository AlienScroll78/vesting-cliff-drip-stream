"use client";

/** Generic 500 fallback — used as the ErrorBoundary default fallback. */
export function ErrorFallback({ reset }: { reset: () => void }) {
  return (
    <ErrorPage
      code="500"
      heading="Something went wrong"
      body="An unexpected error occurred. Our team has been notified."
      primaryAction={{ label: "Try Again", onClick: reset }}
      secondaryAction={{ label: "Go to home page", href: "/" }}
    />
  );
}

/** 404 page — render in app/not-found.tsx or wherever route is missing. */
export function NotFoundPage() {
  return (
    <ErrorPage
      code="404"
      heading="Page not found"
      body="The page you're looking for doesn't exist or has been moved."
      secondaryAction={{ label: "Go to home page", href: "/" }}
    />
  );
}

/** Wallet error — rendered when WalletProvider throws (e.g. Freighter missing). */
export function WalletErrorPage({ reset }: { reset: () => void }) {
  return (
    <ErrorPage
      code="Wallet Error"
      heading="Wallet connection failed"
      body="Could not connect to your Stellar wallet. Make sure the Freighter extension is installed and unlocked."
      primaryAction={{ label: "Try Again", onClick: reset }}
      secondaryAction={{
        label: "Install Freighter",
        href: "https://www.freighter.app/",
        external: true,
      }}
    />
  );
}

// ---------------------------------------------------------------------------
// Shared layout
// ---------------------------------------------------------------------------

interface PrimaryAction {
  label: string;
  onClick: () => void;
}

interface SecondaryAction {
  label: string;
  href: string;
  external?: boolean;
}

function ErrorPage({
  code,
  heading,
  body,
  primaryAction,
  secondaryAction,
}: {
  code: string;
  heading: string;
  body: string;
  primaryAction?: PrimaryAction;
  secondaryAction?: SecondaryAction;
}) {
  return (
    <main role="alert" style={styles.container}>
      <span style={styles.code} aria-hidden="true">{code}</span>
      <h1 style={styles.heading}>{heading}</h1>
      <p style={styles.body}>{body}</p>
      <div style={styles.actions}>
        {primaryAction && (
          <button type="button" onClick={primaryAction.onClick} style={styles.primaryBtn}>
            {primaryAction.label}
          </button>
        )}
        {secondaryAction && (
          <a
            href={secondaryAction.href}
            style={styles.link}
            {...(secondaryAction.external
              ? { target: "_blank", rel: "noopener noreferrer" }
              : {})}
          >
            {secondaryAction.label}
          </a>
        )}
      </div>
    </main>
  );
}

const styles = {
  container: {
    display: "flex" as const,
    flexDirection: "column" as const,
    alignItems: "center",
    justifyContent: "center",
    minHeight: "60vh",
    gap: "12px",
    padding: "32px",
    textAlign: "center" as const,
  },
  code: {
    fontSize: "4rem",
    fontWeight: 700,
    color: "var(--accent, #7c3aed)",
    lineHeight: 1,
  },
  heading: { fontSize: "1.5rem", margin: 0 },
  body: { color: "var(--text, #666)", margin: 0, maxWidth: "40ch" },
  actions: { display: "flex", gap: "12px", alignItems: "center", flexWrap: "wrap" as const, justifyContent: "center" },
  primaryBtn: {
    padding: "10px 24px",
    background: "var(--accent, #7c3aed)",
    color: "#fff",
    border: "none",
    borderRadius: "8px",
    cursor: "pointer",
    fontSize: "1rem",
  },
  link: { color: "var(--accent, #7c3aed)", fontSize: "0.875rem" },
} as const;
