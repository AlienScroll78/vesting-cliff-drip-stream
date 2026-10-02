import React from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { within, expect } from "@storybook/test";

const meta: Meta = {
  title: "Design System/Components/Form",
  parameters: {
    docs: {
      description: {
        component:
          "Input and Select form controls. All meet the 44px minimum height touch target and use token-based colours.",
      },
    },
  },
};
export default meta;

// ─── Input ───────────────────────────────────────────────────────────────────

export const InputDefault: StoryObj = {
  name: "Input / Default",
  render: () => (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, width: 280 }}>
      <input className="input" type="text" placeholder="Recipient address" aria-label="Recipient address" />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const input = canvas.getByRole("textbox");
    expect(input).toBeInTheDocument();
  },
};

export const InputVariants: StoryObj = {
  name: "Input / Variants",
  render: () => (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, width: 280 }}>
      <div>
        <label className="label" htmlFor="rate-input" style={{ display: "block", marginBottom: 4 }}>
          Rate (tokens/ledger)
        </label>
        <input id="rate-input" className="input" type="number" defaultValue={10} />
      </div>
      <div>
        <label className="label" htmlFor="error-input" style={{ display: "block", marginBottom: 4 }}>
          Invalid rate
        </label>
        <input id="error-input" className="input input--error" type="number" defaultValue={-1} aria-invalid="true" />
        <span className="text-xs" style={{ color: "var(--color-danger)", marginTop: 4, display: "block" }}>
          Rate must be greater than 0
        </span>
      </div>
      <div>
        <label className="label" htmlFor="disabled-input" style={{ display: "block", marginBottom: 4 }}>
          Disabled
        </label>
        <input id="disabled-input" className="input" type="text" defaultValue="GBMV7NXF..." disabled />
      </div>
    </div>
  ),
};

// ─── Select ──────────────────────────────────────────────────────────────────

export const SelectDefault: StoryObj = {
  name: "Select / Default",
  render: () => (
    <div style={{ width: 280 }}>
      <label className="label" htmlFor="token-select" style={{ display: "block", marginBottom: 4 }}>
        Token
      </label>
      <select id="token-select" className="select" defaultValue="USDC">
        <option value="USDC">USDC</option>
        <option value="XLM">XLM</option>
        <option value="AQUA">AQUA</option>
        <option value="BLND">BLND</option>
      </select>
    </div>
  ),
};

export const SelectVariants: StoryObj = {
  name: "Select / Variants",
  render: () => (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, width: 280 }}>
      <select className="select" aria-label="Token (default)">
        <option>USDC</option>
        <option>XLM</option>
      </select>
      <select className="select select--error" aria-label="Token (error)" aria-invalid="true">
        <option>Select a token…</option>
      </select>
      <select className="select" disabled aria-label="Token (disabled)">
        <option>Disabled</option>
      </select>
    </div>
  ),
};
