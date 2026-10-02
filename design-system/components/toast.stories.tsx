import React from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { within, expect } from "@storybook/test";

const meta: Meta = {
  title: "Design System/Components/Toast",
  parameters: {
    docs: {
      description: {
        component:
          "Toast notification region. Fixed position in the bottom-right corner. " +
          "Success toasts use role='status' (polite); danger/error toasts use role='alert' (assertive).",
      },
    },
  },
};
export default meta;

export const AllVariants: StoryObj = {
  name: "All Variants",
  render: () => (
    <div className="ds-toast-region" style={{ position: "static" }}>
      <div className="ds-toast ds-toast--success" role="status">
        <span>Claim confirmed on-chain.</span>
      </div>
      <div className="ds-toast ds-toast--warning" role="status">
        <span>Transaction pending. Waiting for network confirmation.</span>
      </div>
      <div className="ds-toast ds-toast--danger" role="alert">
        <span>Transaction failed. Try again.</span>
      </div>
      <div className="ds-toast" role="status">
        <span>Stream #42 created successfully.</span>
      </div>
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    expect(canvas.getByText("Claim confirmed on-chain.")).toBeInTheDocument();
    expect(canvas.getByRole("alert")).toBeInTheDocument();
  },
};

export const SuccessToast: StoryObj = {
  name: "Success",
  render: () => (
    <div className="ds-toast-region" style={{ position: "static" }}>
      <div className="ds-toast ds-toast--success" role="status">
        Claim of 12 450 USDC confirmed on ledger #48 291 774.
      </div>
    </div>
  ),
};

export const ErrorToast: StoryObj = {
  name: "Error",
  render: () => (
    <div className="ds-toast-region" style={{ position: "static" }}>
      <div className="ds-toast ds-toast--danger" role="alert">
        CliffNotReached — cliff_ledger has not been reached yet.
      </div>
    </div>
  ),
};
