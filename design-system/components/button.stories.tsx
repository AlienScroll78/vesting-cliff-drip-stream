import React, { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { within, expect, userEvent } from "@storybook/test";

// ─── Button ──────────────────────────────────────────────────────────────────

const buttonMeta: Meta = {
  title: "Design System/Components/Button",
  parameters: {
    docs: {
      description: {
        component:
          "Button component with primary, secondary, and danger variants. All sizes meet the 44×44px WCAG 2.5.5 minimum touch target.",
      },
    },
  },
};
export default buttonMeta;

export const AllVariants: StoryObj = {
  name: "All Variants",
  render: () => (
    <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
      <button className="btn btn--primary">Primary</button>
      <button className="btn btn--secondary">Secondary</button>
      <button className="btn btn--danger">Danger</button>
      <button className="btn btn--primary" disabled>Disabled</button>
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    expect(canvas.getByText("Primary")).toBeInTheDocument();
    expect(canvas.getByText("Disabled")).toBeDisabled();
  },
};

export const Sizes: StoryObj = {
  name: "Sizes",
  render: () => (
    <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
      <button className="btn btn--primary btn--sm">Small</button>
      <button className="btn btn--primary">Default</button>
      <button className="btn btn--primary btn--lg">Large</button>
    </div>
  ),
};

export const WithIcon: StoryObj = {
  name: "With Icon",
  render: () => (
    <div style={{ display: "flex", gap: 12 }}>
      <button className="btn btn--primary">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
        Create Stream
      </button>
      <button className="btn btn--danger btn--sm">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
          <path d="M2 2l10 10M12 2L2 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
        Cancel
      </button>
    </div>
  ),
};

export const FocusState: StoryObj = {
  name: "Focus State",
  render: () => (
    <button className="btn btn--primary" style={{ outline: "2px solid var(--color-border-focus)", outlineOffset: 2 }}>
      Focused (keyboard)
    </button>
  ),
};
