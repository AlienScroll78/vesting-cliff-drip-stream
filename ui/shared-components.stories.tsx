import type { Meta, StoryObj } from "@storybook/react";
import { within } from "@storybook/test";
import React from "react";

const meta: Meta = {
  title: "Shared Components",
  parameters: {
    docs: {
      description: {
        component:
          "Shared frontend components used across the vesting drip-stream app. Each component is shown in its Default, Loading, Error, and Empty states. Dark mode can be toggled from the Storybook toolbar (color scheme), which drives the app's theming via `data-color-scheme`.",
      },
    },
  },
};

export default meta;
type Story = StoryObj;

function LoadingUI() {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 10,
        padding: 24,
        color: "#64748b",
        fontFamily: "sans-serif",
      }}
    >
      <div style={{ width: "45%", height: 10, background: "#e2e8f0", borderRadius: 4, animation: "pulse 1.5s infinite" }} />
      <div style={{ width: "75%", height: 10, background: "#e2e8f0", borderRadius: 4, animation: "pulse 1.5s infinite" }} />
      <div style={{ width: "60%", height: 10, background: "#e2e8f0", borderRadius: 4, animation: "pulse 1.5s infinite" }} />
    </div>
  );
}

function ErrorUI() {
  return (
    <div style={{ padding: 24, color: "#b53030", textAlign: "center", fontFamily: "sans-serif" }}>
      <span style={{ fontSize: 32, display: "block", marginBottom: 8 }} role="img" aria-label="Error">
        ⚠️
      </span>
      <p style={{ margin: 0, fontWeight: 700 }}>Failed to load</p>
    </div>
  );
}

function EmptyUI() {
  return (
    <div style={{ padding: 24, color: "#64748b", textAlign: "center", fontFamily: "sans-serif" }}>
      <p style={{ margin: 0 }}>No data available</p>
    </div>
  );
}

export const StreamCardDefault: Story = {
  name: "Default",
  render: () => (
    <section style={{ border: "1px solid #e2e8f0", borderRadius: 12, padding: 16, fontFamily: "sans-serif", maxWidth: 420 }} aria-label="Stream card">
      <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 8 }}>Core Protocol Grant</div>
      <div style={{ color: "#64748b", fontSize: 14, marginBottom: 10 }}>Contributor stream</div>
      <dl style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, margin: 0, padding: 0 }}>
        <div>
          <dt style={{ fontSize: 12, color: "#94a3b8", margin: 0 }}>Rate</dt>
          <dd style={{ fontSize: 14, margin: 0 }}>10 XLM / ledger</dd>
        </div>
        <div>
          <dt style={{ fontSize: 12, color: "#94a3b8", margin: 0 }}>Cliff</dt>
          <dd style={{ fontSize: 14, margin: 0 }}>Ledger 150</dd>
        </div>
      </dl>
    </section>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    expect(canvas.getByText("Core Protocol Grant")).toBeInTheDocument();
  },
};

export const StreamCardLoading: Story = { name: "Loading", render: LoadingUI };
export const StreamCardError: Story = { name: "Error", render: ErrorUI };
export const StreamCardEmpty: Story = { name: "Empty", render: EmptyUI };

// ── CliffCountdown ─────────────────────────────────────────────────────────────

export const CliffCountdownDefault: Story = {
  name: "Default",
  render: () => (
    <section style={{ border: "1px solid #e2e8f0", borderRadius: 12, padding: 16, fontFamily: "sans-serif", maxWidth: 420 }} aria-label="Cliff countdown">
      <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 8 }}>Time until cliff</div>
      <div style={{ fontSize: 28, fontWeight: 700, letterSpacing: -1, marginBottom: 8 }}>12d 04h</div>
      <div style={{ color: "#64748b", fontSize: 14 }}>Tokens unlock on ledger 150</div>
    </section>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    expect(canvas.getByText("Time until cliff")).toBeInTheDocument();
  },
};

export const CliffCountdownLoading: Story = { name: "Loading", render: LoadingUI };
export const CliffCountdownError: Story = { name: "Error", render: ErrorUI };
export const CliffCountdownEmpty: Story = { name: "Empty", render: EmptyUI };

// ── CopyableAddress ────────────────────────────────────────────────────────────

export const CopyableAddressDefault: Story = {
  name: "Default",
  render: () => (
    <section style={{ border: "1px solid #e2e8f0", borderRadius: 12, padding: 16, fontFamily: "sans-serif", maxWidth: 420, display: "flex", alignItems: "center", gap: 10 }} aria-label="Copyable address">
      <code style={{ flex: 1, fontSize: 13, background: "#f8fafc", padding: 6, borderRadius: 6 }}>GDA…B12C</code>
      <button type="button" style={{ padding: "6px 12px", borderRadius: 6, border: "1px solid #e2e8f0", background: "#fff", cursor: "pointer" }}>Copy</button>
    </section>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    expect(canvas.getByRole("button", { name: /copy/i })).toBeInTheDocument();
  },
};

export const CopyableAddressLoading: Story = { name: "Loading", render: LoadingUI };
export const CopyableAddressError: Story = { name: "Error", render: ErrorUI };
export const CopyableAddressEmpty: Story = { name: "Empty", render: EmptyUI };

// ── TokenSelector ──────────────────────────────────────────────────────────────

export const TokenSelectorDefault: Story = {
  name: "Default",
  render: () => (
    <section style={{ border: "1px solid #e2e8f0", borderRadius: 12, padding: 16, fontFamily: "sans-serif", maxWidth: 420 }} aria-label="Token selector">
      <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 8 }}>Select token</div>
      <select style={{ width: "100%", padding: 8, borderRadius: 6, border: "1px solid #cbd5e1" }}>
        <option>XLM (Stellar)</option>
        <option>USDC</option>
        <option>Custom SAC token</option>
      </select>
    </section>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    expect(canvas.getByRole("combobox")).toBeInTheDocument();
  },
};

export const TokenSelectorLoading: Story = { name: "Loading", render: LoadingUI };
export const TokenSelectorError: Story = { name: "Error", render: ErrorUI };
export const TokenSelectorEmpty: Story = { name: "Empty", render: EmptyUI };

// ── ProgressChart ──────────────────────────────────────────────────────────────

export const ProgressChartDefault: Story = {
  name: "Default",
  render: () => (
    <section style={{ border: "1px solid #e2e8f0", borderRadius: 12, padding: 16, fontFamily: "sans-serif", maxWidth: 480 }} aria-label="Progress chart">
      <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 10 }}>Vesting progress</div>
      <div style={{ height: 10, background: "#e2e8f0", borderRadius: 6, overflow: "hidden" }}>
        <div style={{ width: "35%", height: 10, background: "#156f5a" }} />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#64748b", marginTop: 6 }}>
        <span>0%</span>
        <span>100%</span>
      </div>
    </section>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    expect(canvas.getByText("Vesting progress")).toBeInTheDocument();
  },
};

export const ProgressChartLoading: Story = { name: "Loading", render: LoadingUI };
export const ProgressChartError: Story = { name: "Error", render: ErrorUI };
export const ProgressChartEmpty: Story = { name: "Empty", render: EmptyUI };

// ── LoadingSkeleton variants ───────────────────────────────────────────────────

export const LoadingSkeletonDefault: Story = {
  name: "Default",
  render: () => (
    <section style={{ border: "1px solid #e2e8f0", borderRadius: 12, padding: 16, fontFamily: "sans-serif", maxWidth: 420, display: "flex", flexDirection: "column", gap: 10, color: "#64748b" }} aria-label="Loading skeleton">
      <div style={{ width: "60%", height: 12, background: "#e2e8f0", borderRadius: 4, animation: "pulse 1.5s infinite" }} />
      <div style={{ width: "85%", height: 12, background: "#e2e8f0", borderRadius: 4, animation: "pulse 1.5s infinite" }} />
      <div style={{ width: "40%", height: 12, background: "#e2e8f0", borderRadius: 4, animation: "pulse 1.5s infinite" }} />
    </section>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    expect(canvas.getByRole("generic", { name: /loading skeleton/i })).toBeInTheDocument();
  },
};

export const LoadingSkeletonRect: Story = {
  name: "Rect variant",
  render: () => (<div style={{ width: 200, height: 24, background: "#e2e8f0", borderRadius: 4, animation: "pulse 1.5s infinite" }} />),
};

export const LoadingSkeletonCircle: Story = {
  name: "Circle variant",
  render: () => (<div style={{ width: 32, height: 32, background: "#e2e8f0", borderRadius: 999, animation: "pulse 1.5s infinite" }} />),
};

export const LoadingSkeletonText: Story = {
  name: "Text variant",
  render: () => (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ width: "90%", height: 12, background: "#e2e8f0", borderRadius: 4, animation: "pulse 1.5s infinite" }} />
      <div style={{ width: "70%", height: 12, background: "#e2e8f0", borderRadius: 4, animation: "pulse 1.5s infinite" }} />
    </div>
  ),
};

export const LoadingSkeletonLoading: Story = { name: "Loading", render: LoadingUI };
export const LoadingSkeletonError: Story = { name: "Error", render: ErrorUI };
export const LoadingSkeletonEmpty: Story = { name: "Empty", render: EmptyUI };