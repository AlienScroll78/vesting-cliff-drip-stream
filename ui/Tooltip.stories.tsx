import type { Meta, StoryObj } from "@storybook/react";
import { expect, userEvent, within } from "@storybook/test";
import React from "react";
import {
  GlossaryInfoTooltip,
  GlossaryTooltip,
  InfoTooltip,
  TermWithTooltip,
  Tooltip,
} from "../frontend/src/Tooltip";

const meta = {
  title: "Components/Tooltip",
  parameters: {
    layout: "centered",
    docs: {
      description: {
        component:
          "Tooltip system built on @floating-ui/react. Provides contextual help for technical terms (cliff, ledger, rate, SAC) throughout the UI. Supports hover (desktop) and tap (mobile), keyboard dismiss, and auto-positioning.",
      },
    },
  },
} satisfies Meta;

export default meta;
type Story = StoryObj;

// ─── Generic Tooltip ──────────────────────────────────────────────────────────

export const Default: Story = {
  name: "Default (hover)",
  parameters: {
    docs: { description: { story: "Hover or tap the button to reveal the tooltip." } },
  },
  render: () => (
    <Tooltip content="This is a helpful contextual tooltip.">
      <button type="button" style={{ padding: "8px 16px", borderRadius: 6, border: "1px solid #334155", background: "#1e293b", color: "#f8fafc", cursor: "pointer" }}>
        Hover me
      </button>
    </Tooltip>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const trigger = canvas.getByRole("button", { name: "Hover me" });
    await userEvent.hover(trigger);
    const tooltip = await canvas.findByRole("tooltip");
    expect(tooltip).toBeInTheDocument();
    expect(tooltip).toHaveTextContent("This is a helpful contextual tooltip.");
    await userEvent.unhover(trigger);
  },
};

export const TopPlacement: Story = {
  name: "Top placement",
  render: () => (
    <Tooltip content="Positioned above the trigger." side="top">
      <button type="button" style={{ padding: "8px 16px", borderRadius: 6, border: "1px solid #334155", background: "#1e293b", color: "#f8fafc", cursor: "pointer" }}>
        Top
      </button>
    </Tooltip>
  ),
};

export const BottomPlacement: Story = {
  name: "Bottom placement",
  render: () => (
    <Tooltip content="Positioned below the trigger." side="bottom">
      <button type="button" style={{ padding: "8px 16px", borderRadius: 6, border: "1px solid #334155", background: "#1e293b", color: "#f8fafc", cursor: "pointer" }}>
        Bottom
      </button>
    </Tooltip>
  ),
};

export const LongContent: Story = {
  name: "Long content",
  parameters: {
    docs: { description: { story: "Tooltip with longer text wraps properly and stays within the viewport." } },
  },
  render: () => (
    <Tooltip content="A ledger closes approximately every 5 seconds on Stellar. All durations in this contract are expressed in ledgers. 1 day ≈ 17,280 ledgers, 1 week ≈ 120,960 ledgers, 1 year ≈ 6,307,200 ledgers.">
      <button type="button" style={{ padding: "8px 16px", borderRadius: 6, border: "1px solid #334155", background: "#1e293b", color: "#f8fafc", cursor: "pointer" }}>
        Long tooltip
      </button>
    </Tooltip>
  ),
};

// ─── GlossaryInfoTooltip ──────────────────────────────────────────────────────

export const CliffGlossary: Story = {
  name: "Glossary: cliff",
  parameters: {
    docs: { description: { story: "InfoTooltip pre-populated with the cliff definition from the canonical glossary." } },
  },
  render: () => (
    <label style={{ display: "flex", alignItems: "center", gap: 4, fontFamily: "sans-serif", color: "#1e293b" }}>
      Cliff duration
      <GlossaryInfoTooltip term="cliff" />
    </label>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const btn = canvas.getByRole("button", { name: /what is cliff/i });
    await userEvent.hover(btn);
    const tooltip = await canvas.findByRole("tooltip");
    expect(tooltip).toBeInTheDocument();
    expect(tooltip).toHaveTextContent("Cliff");
    expect(tooltip).toHaveTextContent("mandatory waiting period");
    await userEvent.unhover(btn);
  },
};

export const LedgerGlossary: Story = {
  name: "Glossary: ledger",
  render: () => (
    <label style={{ display: "flex", alignItems: "center", gap: 4, fontFamily: "sans-serif", color: "#1e293b" }}>
      Ledger number
      <GlossaryInfoTooltip term="ledger" />
    </label>
  ),
};

export const RateGlossary: Story = {
  name: "Glossary: rate",
  render: () => (
    <label style={{ display: "flex", alignItems: "center", gap: 4, fontFamily: "sans-serif", color: "#1e293b" }}>
      Rate (tokens/ledger)
      <GlossaryInfoTooltip term="rate" />
    </label>
  ),
};

export const SACGlossary: Story = {
  name: "Glossary: SAC",
  render: () => (
    <label style={{ display: "flex", alignItems: "center", gap: 4, fontFamily: "sans-serif", color: "#1e293b" }}>
      Token contract (SAC)
      <GlossaryInfoTooltip term="sac" />
    </label>
  ),
};

// ─── TermWithTooltip ──────────────────────────────────────────────────────────

export const InlineTerm: Story = {
  name: "TermWithTooltip (inline)",
  parameters: {
    docs: { description: { story: "Inline glossary term with dotted underline. Hover or tap to see the definition." } },
  },
  render: () => (
    <p style={{ fontFamily: "sans-serif", color: "#1e293b", maxWidth: 420, lineHeight: 1.6 }}>
      This stream has a <TermWithTooltip term="cliff">cliff</TermWithTooltip> period
      before any tokens can be claimed. After the cliff, all accrued tokens are
      released in a <TermWithTooltip term="catch_up_claim">catch-up claim</TermWithTooltip>.
    </p>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const cliffBtn = canvas.getByRole("button", { name: "" });
    await userEvent.hover(cliffBtn);
    const tooltip = await canvas.findByRole("tooltip");
    expect(tooltip).toBeInTheDocument();
    await userEvent.unhover(cliffBtn);
  },
};

// ─── AllGlossaryTerms ─────────────────────────────────────────────────────────

export const AllGlossaryTerms: Story = {
  name: "All glossary terms",
  parameters: {
    docs: { description: { story: "All available glossary tooltip terms shown as info buttons." } },
  },
  render: () => (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, fontFamily: "sans-serif", color: "#1e293b" }}>
      {(["cliff", "cliff_duration", "ledger", "rate", "sac", "sponsor", "recipient", "deposit", "total_duration", "catch_up_claim"] as const).map((key) => (
        <div key={key} style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <code style={{ fontFamily: "monospace", fontSize: 13, background: "#f1f5f9", padding: "2px 6px", borderRadius: 4 }}>{key}</code>
          <GlossaryInfoTooltip term={key} />
        </div>
      ))}
    </div>
  ),
};

// ─── FormLabel integration ────────────────────────────────────────────────────

export const FormLabels: Story = {
  name: "Form label integration",
  parameters: {
    docs: { description: { story: "Demonstrates tooltip placement on all form field labels in the create stream form." } },
  },
  render: () => (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, fontFamily: "sans-serif", color: "#1e293b", width: 340 }}>
      {[
        { label: "Recipient address", term: "recipient" },
        { label: "Token contract (SAC)", term: "sac" },
        { label: "Rate (tokens / ledger)", term: "rate" },
        { label: "Cliff duration (days)", term: "cliff" },
        { label: "Total duration (days)", term: "total_duration" },
      ].map(({ label, term }) => (
        <div key={term}>
          <label style={{ display: "flex", alignItems: "center", gap: 4, fontWeight: 600, fontSize: 14, marginBottom: 4 }}>
            {label}
            <GlossaryInfoTooltip term={term as Parameters<typeof GlossaryInfoTooltip>[0]["term"]} />
          </label>
          <input
            type="text"
            placeholder={`Enter ${label.toLowerCase()}`}
            style={{ width: "100%", padding: "8px 10px", border: "1px solid #cbd5e1", borderRadius: 6, fontSize: 14, boxSizing: "border-box" }}
          />
        </div>
      ))}
    </div>
  ),
};

// ─── Accessibility ────────────────────────────────────────────────────────────

export const KeyboardDismiss: Story = {
  name: "Keyboard: Escape to close",
  parameters: {
    docs: { description: { story: "Tooltip opens on focus and closes on Escape key." } },
  },
  render: () => (
    <InfoTooltip content="Press Escape to close this tooltip." label="Help" />
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const btn = canvas.getByRole("button", { name: "Help" });
    btn.focus();
    await userEvent.keyboard("{Tab}"); // focus in
    await userEvent.hover(btn);
    const tooltip = await canvas.findByRole("tooltip");
    expect(tooltip).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    expect(canvas.queryByRole("tooltip")).not.toBeInTheDocument();
  },
};
