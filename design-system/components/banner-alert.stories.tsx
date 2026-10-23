import React, { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { within, expect, userEvent } from "@storybook/test";

const meta: Meta = {
  title: "Design System/Components/BannerAlert",
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "Banner alert for global, page-level warnings and informational messages. " +
          "Sits at the top of the viewport (or below a nav bar). " +
          "Three severity variants: warning (amber), info (blue), danger (red). " +
          "Supports an optional action button and dismiss control.",
      },
    },
  },
};
export default meta;

type BannerVariant = "warning" | "info" | "danger";

interface BannerAlertProps {
  variant: BannerVariant;
  icon?: string;
  title?: string;
  message: string;
  action?: { label: string; onClick: () => void; href?: string };
  onDismiss?: () => void;
}

const DEFAULT_ICONS: Record<BannerVariant, string> = {
  warning: "⚠️",
  info: "ℹ️",
  danger: "🚨",
};

function BannerAlert({ variant, icon, title, message, action, onDismiss }: BannerAlertProps) {
  const resolvedIcon = icon ?? DEFAULT_ICONS[variant];
  return (
    <div
      className={`ds-banner ds-banner--${variant}`}
      role={variant === "danger" ? "alert" : "status"}
      aria-live={variant === "danger" ? "assertive" : "polite"}
      aria-atomic="true"
    >
      <span className="ds-banner__icon" aria-hidden="true">{resolvedIcon}</span>

      <div className="ds-banner__content">
        {title && <div className="ds-banner__title">{title}</div>}
        <div className="ds-banner__message">{message}</div>
      </div>

      {action && (
        action.href
          ? <a href={action.href} className="ds-banner__action" rel="noopener noreferrer">{action.label}</a>
          : <button type="button" className="ds-banner__action" onClick={action.onClick}>{action.label}</button>
      )}

      {onDismiss && (
        <button
          type="button"
          className="ds-banner__dismiss"
          onClick={onDismiss}
          aria-label="Dismiss this notification"
        >
          ✕
        </button>
      )}
    </div>
  );
}

// ── Stories ───────────────────────────────────────────────────────────────────

export const AllVariants: StoryObj = {
  name: "All Variants",
  render: () => (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)", padding: "var(--space-6)" }}>
      <BannerAlert
        variant="warning"
        title="Indexer is 5 minutes behind"
        message="Stream activity and claimable amounts may not reflect the latest ledger. Data refreshes automatically."
        action={{ label: "View status", onClick: () => {} }}
        onDismiss={() => {}}
      />
      <BannerAlert
        variant="info"
        title="Scheduled maintenance"
        message="The Horizon RPC endpoint will undergo maintenance on Sunday 02:00–04:00 UTC. Transactions submitted during this window may be delayed."
        onDismiss={() => {}}
      />
      <BannerAlert
        variant="danger"
        title="Cannot connect to Soroban RPC"
        message="Transaction simulation is unavailable. Submissions are disabled until the connection is restored."
      />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    expect(canvas.getByText("Indexer is 5 minutes behind")).toBeInTheDocument();
    expect(canvas.getByRole("alert")).toBeInTheDocument();
  },
};

export const IndexerLag: StoryObj = {
  name: "Indexer lag (warning)",
  render: () => (
    <BannerAlert
      variant="warning"
      title="Indexer is 5 minutes behind"
      message="Stream activity and claimable amounts may not reflect the latest ledger. Data refreshes automatically every 30 seconds."
      action={{ label: "Refresh now", onClick: () => {} }}
      onDismiss={() => {}}
    />
  ),
};

export const MaintenanceInfo: StoryObj = {
  name: "Maintenance notice (info)",
  render: () => (
    <BannerAlert
      variant="info"
      title="Planned maintenance window"
      message="The Horizon RPC endpoint will undergo maintenance on Sunday 02:00–04:00 UTC. Transactions submitted during this window may be delayed."
      action={{ label: "Check status page", href: "#" }}
      onDismiss={() => {}}
    />
  ),
};

export const RpcUnavailable: StoryObj = {
  name: "RPC unavailable (danger)",
  render: () => (
    <BannerAlert
      variant="danger"
      title="Cannot connect to Soroban RPC"
      message="Transaction simulation and submission are disabled until the connection is restored. Your data is safe."
    />
  ),
};

export const InteractiveDismiss: StoryObj = {
  name: "Interactive (dismissable)",
  render: () => {
    const [visible, setVisible] = useState(true);
    return (
      <div style={{ padding: "var(--space-6)" }}>
        {visible ? (
          <BannerAlert
            variant="warning"
            title="Indexer is 2 minutes behind"
            message="Claimable amounts may be slightly understated. They will update automatically."
            onDismiss={() => setVisible(false)}
          />
        ) : (
          <div style={{ display: "flex", gap: "var(--space-3)", alignItems: "center" }}>
            <span style={{ color: "var(--color-text-secondary)", fontSize: "var(--font-size-label)" }}>Banner dismissed.</span>
            <button className="btn btn--secondary btn--sm" onClick={() => setVisible(true)}>Show again</button>
          </div>
        )}
      </div>
    );
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const dismissBtn = canvas.getByLabelText("Dismiss this notification");
    await userEvent.click(dismissBtn);
    expect(canvas.queryByText("Indexer is 2 minutes behind")).not.toBeInTheDocument();
    expect(canvas.getByText("Banner dismissed.")).toBeInTheDocument();
  },
};

export const NoTitleVariant: StoryObj = {
  name: "Without title (inline)",
  render: () => (
    <BannerAlert
      variant="info"
      message="You are viewing testnet data. Switch to mainnet in the network selector."
    />
  ),
};
