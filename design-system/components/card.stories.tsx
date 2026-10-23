import React from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { within, expect } from "@storybook/test";

const meta: Meta = {
  title: "Design System/Components/Card",
  parameters: {
    docs: {
      description: {
        component: "Card surface for grouping related content. Uses token-based background, border, padding, and shadow.",
      },
    },
  },
};
export default meta;

export const Default: StoryObj = {
  name: "Default",
  render: () => (
    <div className="card" style={{ width: 320 }}>
      <div className="card__header">Stream #1</div>
      <div className="card__body">Rate: 10 tokens/ledger · Cliff: 17 280 ledgers</div>
      <div className="card__footer">
        <button className="btn btn--secondary btn--sm">Details</button>
        <button className="btn btn--primary btn--sm">Claim</button>
      </div>
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    expect(canvas.getByText("Stream #1")).toBeInTheDocument();
  },
};

export const VestingStreamCard: StoryObj = {
  name: "Vesting Stream Card",
  render: () => (
    <div className="card" style={{ width: 360 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "var(--space-4)" }}>
        <div className="card__header" style={{ margin: 0 }}>Alice's Grant</div>
        <span className="ds-badge ds-badge--success">Active</span>
      </div>
      <div className="card__body">
        <dl style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-3)", margin: 0 }}>
          <div>
            <dt className="label-caps">Rate</dt>
            <dd className="ds-amount-inline" style={{ margin: 0, color: "var(--color-text-primary)", fontWeight: "var(--font-weight-semibold)" }}>10 / ledger</dd>
          </div>
          <div>
            <dt className="label-caps">Cliff</dt>
            <dd style={{ margin: 0, color: "var(--color-text-primary)", fontWeight: "var(--font-weight-semibold)" }}>17 280 ledgers</dd>
          </div>
          <div>
            <dt className="label-caps">Total</dt>
            <dd className="ds-amount-inline" style={{ margin: 0, color: "var(--color-text-primary)", fontWeight: "var(--font-weight-semibold)" }}>1 728 000 USDC</dd>
          </div>
          <div>
            <dt className="label-caps">Claimable</dt>
            <dd className="ds-amount-inline" style={{ margin: 0, color: "var(--color-success)", fontWeight: "var(--font-weight-bold)" }}>12 450 USDC</dd>
          </div>
        </dl>
      </div>
      <div className="card__footer">
        <button className="btn btn--secondary btn--sm">Cancel stream</button>
        <button className="btn btn--primary btn--sm">Claim vested</button>
      </div>
    </div>
  ),
};

export const LoadingCard: StoryObj = {
  name: "Loading (Skeleton)",
  render: () => (
    <div className="card" style={{ width: 320 }}>
      <div className="card__header">
        <div className="skeleton" style={{ height: "1.25rem", width: "60%", borderRadius: "var(--radius-sm)", background: "var(--color-bg-elevated)" }} />
      </div>
      <div className="card__body" style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
        {[80, 60, 70].map((w, i) => (
          <div key={i} className="skeleton" style={{ height: "0.875rem", width: `${w}%`, borderRadius: "var(--radius-sm)", background: "var(--color-bg-elevated)" }} />
        ))}
      </div>
    </div>
  ),
};
