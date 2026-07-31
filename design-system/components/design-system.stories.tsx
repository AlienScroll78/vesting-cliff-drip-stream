import type { Meta, StoryObj } from "@storybook/react";
import { within, expect } from "@storybook/test";

const meta: Meta = {
  title: "Design System/Overview",
  parameters: {
    docs: {
      description: {
        component:
          "Primitive components and token reference for the design-system/ contract. " +
          "Use the Color scheme toolbar control to preview the light/dark theme (data-theme).",
      },
    },
  },
};
export default meta;

type Story = StoryObj;

// ─── Tokens ─────────────────────────────────────────────────────────────────

function Swatch({ name, varName }: { name: string; varName: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, fontFamily: "monospace" }}>
      <span
        style={{
          width: 28,
          height: 28,
          borderRadius: "var(--radius-sm)",
          background: `var(${varName})`,
          border: "1px solid var(--color-border)",
          flexShrink: 0,
        }}
      />
      <span>{name}</span>
    </div>
  );
}

const SCALES: Array<[string, string]> = [
  ["primary", "--color-primary"],
  ["secondary", "--color-secondary"],
  ["success", "--color-success"],
  ["warning", "--color-warning"],
  ["error", "--color-error"],
  ["neutral", "--color-neutral"],
];
const SHADES = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900];

export const ColorScales: Story = {
  name: "Tokens / Colors",
  render: () => (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, color: "var(--color-text-primary)" }}>
      {SCALES.map(([label, varPrefix]) => (
        <div key={label}>
          <div style={{ fontWeight: 600, marginBottom: 6, textTransform: "capitalize" }}>{label}</div>
          <div style={{ display: "flex", gap: 6 }}>
            {SHADES.map((shade) => (
              <Swatch key={shade} name={String(shade)} varName={`${varPrefix}-${shade}`} />
            ))}
          </div>
        </div>
      ))}
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    expect(canvas.getAllByText("500").length).toBeGreaterThan(0);
  },
};

export const RadiusAndShadow: Story = {
  name: "Tokens / Radius & Shadow",
  render: () => (
    <div style={{ display: "flex", gap: 24, color: "var(--color-text-primary)" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {["none", "sm", "base", "lg", "full"].map((r) => (
          <div
            key={r}
            style={{
              width: 80,
              height: 40,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "var(--color-bg-elevated)",
              borderRadius: `var(--radius-${r})`,
              fontSize: 11,
            }}
          >
            {r}
          </div>
        ))}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {["sm", "md", "lg", "xl"].map((s) => (
          <div
            key={s}
            style={{
              width: 100,
              height: 40,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "var(--color-bg-surface)",
              boxShadow: `var(--shadow-${s})`,
              borderRadius: "var(--radius-base)",
              fontSize: 11,
            }}
          >
            shadow-{s}
          </div>
        ))}
      </div>
    </div>
  ),
};

// ─── Button (existing) ───────────────────────────────────────────────────────

export const Buttons: Story = {
  name: "Components / Button",
  render: () => (
    <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
      <button className="btn btn--primary">Create Stream</button>
      <button className="btn btn--secondary">View Schedule</button>
      <button className="btn btn--danger btn--sm">Cancel</button>
      <button className="btn btn--primary btn--lg">Claim Vested</button>
      <button className="btn btn--primary" disabled>
        Disabled
      </button>
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    expect(canvas.getByText("Create Stream")).toBeInTheDocument();
  },
};

// ─── Input / Select ───────────────────────────────────────────────────────────

export const InputAndSelect: Story = {
  name: "Components / Input & Select",
  render: () => (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, width: 260 }}>
      <input className="input" type="text" placeholder="Recipient address" />
      <input className="input input--error" type="number" defaultValue={-1} />
      <select className="select" defaultValue="USDC">
        <option>USDC</option>
        <option>XLM</option>
      </select>
    </div>
  ),
};

// ─── Card ───────────────────────────────────────────────────────────────────

export const Card: Story = {
  name: "Components / Card",
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
};

// ─── Badge ────────────────────────────────────────────────────────────────────

export const Badges: Story = {
  name: "Components / Badge",
  render: () => (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      <span className="ds-badge ds-badge--success">Active</span>
      <span className="ds-badge ds-badge--warning">Pre-cliff</span>
      <span className="ds-badge ds-badge--danger">Cancelled</span>
      <span className="ds-badge ds-badge--neutral">Completed</span>
      <span className="ds-badge ds-badge--primary">New</span>
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    expect(canvas.getByText("Active")).toBeInTheDocument();
  },
};

// ─── Tooltip ──────────────────────────────────────────────────────────────────

export const TooltipStory: Story = {
  name: "Components / Tooltip",
  render: () => (
    <span className="ds-tooltip" tabIndex={0} style={{ color: "var(--color-text-primary)" }}>
      Hover or focus me
      <span className="ds-tooltip__content" role="tooltip">
        Cliff catch-up amount
      </span>
    </span>
  ),
};

// ─── Modal ────────────────────────────────────────────────────────────────────

export const Modal: Story = {
  name: "Components / Modal",
  parameters: { layout: "fullscreen" },
  render: () => (
    <div className="ds-modal-backdrop">
      <div className="ds-modal" role="dialog" aria-modal="true" aria-labelledby="ds-modal-title">
        <div className="ds-modal__header" id="ds-modal-title">
          Cancel stream?
        </div>
        <div className="ds-modal__body">Accrued tokens remain claimable by the recipient.</div>
        <div className="ds-modal__footer">
          <button className="btn btn--secondary btn--sm">Keep stream</button>
          <button className="btn btn--danger btn--sm">Cancel stream</button>
        </div>
      </div>
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    expect(canvas.getByRole("dialog")).toBeInTheDocument();
  },
};

// ─── Toast ────────────────────────────────────────────────────────────────────

export const Toast: Story = {
  name: "Components / Toast",
  render: () => (
    <div className="ds-toast-region" style={{ position: "static" }}>
      <div className="ds-toast ds-toast--success" role="status">
        Claim confirmed on-chain.
      </div>
      <div className="ds-toast ds-toast--danger" role="alert">
        Transaction failed. Try again.
      </div>
    </div>
  ),
};
