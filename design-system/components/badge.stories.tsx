import React from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { within, expect } from "@storybook/test";

const meta: Meta = {
  title: "Design System/Components/Badge",
  parameters: {
    docs: {
      description: {
        component:
          "Status badge component. Adapts colours for dark (default) and light themes automatically. " +
          "Used for stream status (Active, Pre-cliff, Cancelled, Completed).",
      },
    },
  },
};
export default meta;

export const AllVariants: StoryObj = {
  name: "All Variants",
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
    expect(canvas.getByText("Cancelled")).toBeInTheDocument();
  },
};

export const StreamStatuses: StoryObj = {
  name: "Stream Status Badges",
  render: () => (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, color: "var(--color-text-primary)" }}>
      {[
        { label: "active",     cls: "ds-badge--success", text: "Active — cliff passed, dripping" },
        { label: "pre-cliff",  cls: "ds-badge--warning", text: "Pre-cliff — waiting for cliff" },
        { label: "cancelled",  cls: "ds-badge--danger",  text: "Cancelled by sponsor" },
        { label: "completed",  cls: "ds-badge--neutral", text: "Completed — fully vested" },
        { label: "new",        cls: "ds-badge--primary", text: "Newly created stream" },
      ].map(({ label, cls, text }) => (
        <div key={label} style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span className={`ds-badge ${cls}`} style={{ width: 90, justifyContent: "center" }}>{label}</span>
          <span className="text-sm" style={{ color: "var(--color-text-secondary)" }}>{text}</span>
        </div>
      ))}
    </div>
  ),
};

export const InlineWithText: StoryObj = {
  name: "Inline with Text",
  render: () => (
    <p style={{ color: "var(--color-text-primary)", display: "flex", gap: 8, alignItems: "center" }}>
      Stream #42{" "}
      <span className="ds-badge ds-badge--success">Active</span>
      {" "}is currently dripping 10 tokens/ledger.
    </p>
  ),
};
