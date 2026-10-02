import React from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { within, expect, userEvent } from "@storybook/test";

const meta: Meta = {
  title: "Design System/Components/Tooltip",
  parameters: {
    docs: {
      description: {
        component:
          "Tooltip that appears on hover or focus. Keyboard accessible — focus the trigger element to activate. " +
          "Content appears above the trigger by default.",
      },
    },
  },
};
export default meta;

export const Default: StoryObj = {
  name: "Default",
  render: () => (
    <div style={{ padding: 64, color: "var(--color-text-primary)" }}>
      <span className="ds-tooltip" tabIndex={0}>
        Hover or focus me
        <span className="ds-tooltip__content" role="tooltip">
          Cliff catch-up amount
        </span>
      </span>
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const trigger = canvas.getByText("Hover or focus me");
    await userEvent.tab();
    expect(trigger).toBeInTheDocument();
  },
};

export const OnBadge: StoryObj = {
  name: "Tooltip on Badge",
  render: () => (
    <div style={{ padding: 48, color: "var(--color-text-primary)" }}>
      <span className="ds-tooltip" tabIndex={0}>
        <span className="ds-badge ds-badge--warning">Pre-cliff</span>
        <span className="ds-tooltip__content" role="tooltip">
          Cliff not yet reached. Claims are locked.
        </span>
      </span>
    </div>
  ),
};

export const OnIcon: StoryObj = {
  name: "Tooltip on Icon Button",
  render: () => (
    <div style={{ padding: 48 }}>
      <span className="ds-tooltip" tabIndex={0} aria-label="Information">
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <circle cx="10" cy="10" r="9" stroke="var(--color-brand-primary)" strokeWidth="1.5" />
          <path d="M10 9v5M10 7h.01" stroke="var(--color-brand-primary)" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
        <span className="ds-tooltip__content" role="tooltip">
          Rate × total_duration must exceed the minimum deposit threshold.
        </span>
      </span>
    </div>
  ),
};
