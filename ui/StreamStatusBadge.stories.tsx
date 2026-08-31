/**
 * Storybook stories for StreamStatusBadge — Issue #543
 *
 * Covers all six lifecycle states defined in docs/stream-status-badges.md:
 *   Pre-cliff  → Yellow  — "Locked"
 *   Active     → Green   — "Streaming"   (pulse)
 *   Claimable  → Blue    — "Claim Available"
 *   Cancelled  → Grey    — "Cancelled"
 *   Expired    → Red     — "Expired"
 *   Drained    → Purple  — "Drained"
 */

import type { Meta, StoryObj } from "@storybook/react";
import {
  StreamStatusBadge,
  StreamStatusLegend,
  type StreamBadgeStatus,
  type BadgeSize,
} from "../frontend/src/components/StreamStatusBadge";

// ─── Meta ─────────────────────────────────────────────────────────────────────

const meta: Meta<typeof StreamStatusBadge> = {
  title: "Components/StreamStatusBadge",
  component: StreamStatusBadge,
  tags: ["autodocs"],
  argTypes: {
    status: {
      control: "select",
      options: [
        "pre-cliff",
        "active",
        "claimable",
        "cancelled",
        "expired",
        "drained",
      ] satisfies StreamBadgeStatus[],
      description: "The current stream lifecycle status",
    },
    size: {
      control: "select",
      options: ["sm", "md", "lg"] satisfies BadgeSize[],
      description: "Size variant: sm for tables, md for cards, lg for detail views",
    },
    showTooltip: {
      control: "boolean",
      description: "Whether to show a tooltip on hover",
    },
  },
  parameters: {
    layout: "centered",
  },
};

export default meta;
type Story = StoryObj<typeof StreamStatusBadge>;

// ─── Individual status stories ────────────────────────────────────────────────

/**
 * Pre-Cliff / Locked — tokens are locked until the cliff date is reached.
 * Badge colour: Yellow / Amber.
 */
export const PreCliff: Story = {
  name: "Pre-Cliff (Locked)",
  args: { status: "pre-cliff", size: "md" },
};

/**
 * Active / Streaming — tokens are dripping each ledger; animated green pulse ring.
 * Badge colour: Green.
 */
export const Active: Story = {
  name: "Active (Streaming)",
  args: { status: "active", size: "md" },
};

/**
 * Claimable / Claim Available — accumulated tokens are ready to be claimed.
 * Badge colour: Blue.
 */
export const Claimable: Story = {
  name: "Claimable (Claim Available)",
  args: { status: "claimable", size: "md" },
};

/**
 * Cancelled — sponsor terminated the stream; no further accrual.
 * Badge colour: Grey.
 */
export const Cancelled: Story = {
  name: "Cancelled",
  args: { status: "cancelled", size: "md" },
};

/**
 * Expired — stream period ended; unclaimed tokens may still be available.
 * Badge colour: Red.
 */
export const Expired: Story = {
  name: "Expired",
  args: { status: "expired", size: "md" },
};

/**
 * Drained — all tokens claimed or recovered; stream fully settled.
 * Badge colour: Purple.
 */
export const Drained: Story = {
  name: "Drained",
  args: { status: "drained", size: "md" },
};

// ─── Size variants ────────────────────────────────────────────────────────────

/** Small (sm) — used in dense tables */
export const SizeSmall: Story = {
  name: "Size / Small (sm)",
  args: { status: "active", size: "sm" },
};

/** Medium (md) — used in stream cards (default) */
export const SizeMedium: Story = {
  name: "Size / Medium (md)",
  args: { status: "active", size: "md" },
};

/** Large (lg) — used in stream detail views */
export const SizeLarge: Story = {
  name: "Size / Large (lg)",
  args: { status: "active", size: "lg" },
};

// ─── All statuses ─────────────────────────────────────────────────────────────

const ALL_STATUSES: StreamBadgeStatus[] = [
  "pre-cliff",
  "active",
  "claimable",
  "cancelled",
  "expired",
  "drained",
];

/** All six statuses at small size */
export const AllStatusesSmall: Story = {
  name: "All Statuses / Small",
  render: () => (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", alignItems: "center" }}>
      {ALL_STATUSES.map((s) => (
        <StreamStatusBadge key={s} status={s} size="sm" />
      ))}
    </div>
  ),
};

/** All six statuses at medium size */
export const AllStatusesMedium: Story = {
  name: "All Statuses / Medium",
  render: () => (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", alignItems: "center" }}>
      {ALL_STATUSES.map((s) => (
        <StreamStatusBadge key={s} status={s} size="md" />
      ))}
    </div>
  ),
};

/** All six statuses at large size */
export const AllStatusesLarge: Story = {
  name: "All Statuses / Large",
  render: () => (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", alignItems: "center" }}>
      {ALL_STATUSES.map((s) => (
        <StreamStatusBadge key={s} status={s} size="lg" />
      ))}
    </div>
  ),
};

// ─── Tooltip variants ─────────────────────────────────────────────────────────

/** With tooltip enabled — hover to see the description */
export const WithTooltip: Story = {
  name: "With Tooltip (hover me)",
  args: { status: "claimable", size: "md", showTooltip: true },
};

/** With tooltip disabled */
export const NoTooltip: Story = {
  name: "Without Tooltip",
  args: { status: "claimable", size: "md", showTooltip: false },
};

// ─── Legend ───────────────────────────────────────────────────────────────────

/** StreamStatusLegend — renders all six statuses as a horizontal strip */
export const Legend: StoryObj<typeof StreamStatusLegend> = {
  name: "Legend / All Statuses (sm)",
  render: () => <StreamStatusLegend size="sm" />,
};

export const LegendMedium: StoryObj<typeof StreamStatusLegend> = {
  name: "Legend / All Statuses (md)",
  render: () => <StreamStatusLegend size="md" />,
};

// ─── In context: table row ────────────────────────────────────────────────────

/** Shows how the sm badge looks inside a typical stream list table */
export const InTableRow: Story = {
  name: "In Context / Table Row",
  render: () => (
    <table
      style={{ borderCollapse: "collapse", fontFamily: "sans-serif", fontSize: "0.875rem" }}
    >
      <thead>
        <tr style={{ background: "#F9FAFB" }}>
          <th style={{ padding: "0.5rem 1rem", textAlign: "left", borderBottom: "1px solid #E5E7EB" }}>
            Recipient
          </th>
          <th style={{ padding: "0.5rem 1rem", textAlign: "left", borderBottom: "1px solid #E5E7EB" }}>
            Token
          </th>
          <th style={{ padding: "0.5rem 1rem", textAlign: "left", borderBottom: "1px solid #E5E7EB" }}>
            Status
          </th>
        </tr>
      </thead>
      <tbody>
        {ALL_STATUSES.map((s) => (
          <tr key={s} style={{ borderTop: "1px solid #E5E7EB" }}>
            <td style={{ padding: "0.5rem 1rem", color: "#374151" }}>
              GABC…{s.slice(0, 4).toUpperCase()}
            </td>
            <td style={{ padding: "0.5rem 1rem" }}>USDC</td>
            <td style={{ padding: "0.5rem 1rem" }}>
              <StreamStatusBadge status={s} size="sm" />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  ),
};
