/**
 * Storybook stories for StreamStatusBadge — Issue #378
 *
 * Stories directory: ui/ (per .storybook/main.ts config)
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
      options: ["pre-cliff", "active", "expired", "cancelled", "drained", "paused"] satisfies StreamBadgeStatus[],
      description: "The current stream status",
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

/** Pre-Cliff: tokens are locked until the cliff ledger is reached */
export const PreCliff: Story = {
  args: { status: "pre-cliff", size: "md" },
};

/** Active: tokens are dripping — animated green pulse ring */
export const Active: Story = {
  args: { status: "active", size: "md" },
};

/** Expired: stream period ended; unclaimed tokens may still be present */
export const Expired: Story = {
  args: { status: "expired", size: "md" },
};

/** Cancelled: sponsor terminated the stream */
export const Cancelled: Story = {
  args: { status: "cancelled", size: "md" },
};

/** Drained: all tokens have been claimed */
export const Drained: Story = {
  args: { status: "drained", size: "md" },
};

/** Paused: stream temporarily paused, no pulse shown */
export const Paused: Story = {
  args: { status: "paused", size: "md" },
};

// ─── Size variant stories ─────────────────────────────────────────────────────

/** Small — used in dense tables */
export const SizeSmall: Story = {
  name: "Size / Small (sm)",
  args: { status: "active", size: "sm" },
};

/** Medium — used in stream cards (default) */
export const SizeMedium: Story = {
  name: "Size / Medium (md)",
  args: { status: "active", size: "md" },
};

/** Large — used in stream detail views */
export const SizeLarge: Story = {
  name: "Size / Large (lg)",
  args: { status: "active", size: "lg" },
};

// ─── All statuses at each size ────────────────────────────────────────────────

const ALL_STATUSES: StreamBadgeStatus[] = [
  "pre-cliff",
  "active",
  "expired",
  "cancelled",
  "drained",
  "paused",
];

/** All six statuses rendered side-by-side at sm size */
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

/** All six statuses rendered side-by-side at md size */
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

/** All six statuses rendered side-by-side at lg size */
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

// ─── Tooltip ─────────────────────────────────────────────────────────────────

/** Tooltip enabled — hover to see the description */
export const WithTooltip: Story = {
  name: "With Tooltip (hover me)",
  args: { status: "active", size: "md", showTooltip: true },
};

/** Tooltip disabled */
export const NoTooltip: Story = {
  name: "Without Tooltip",
  args: { status: "active", size: "md", showTooltip: false },
};

// ─── Legend component ────────────────────────────────────────────────────────

/** StreamStatusLegend — renders all statuses as a horizontal strip */
export const Legend: StoryObj<typeof StreamStatusLegend> = {
  name: "Legend / All Statuses",
  render: () => <StreamStatusLegend size="sm" />,
};

/** Legend at medium size */
export const LegendMedium: StoryObj<typeof StreamStatusLegend> = {
  name: "Legend / Medium",
  render: () => <StreamStatusLegend size="md" />,
};

// ─── In context: simulated table row ─────────────────────────────────────────

/** Shows how the sm badge looks inside a table cell */
export const InTableRow: Story = {
  name: "In Context / Table Row",
  render: () => (
    <table style={{ borderCollapse: "collapse", fontFamily: "sans-serif", fontSize: "0.875rem" }}>
      <thead>
        <tr style={{ background: "#F9FAFB" }}>
          <th style={{ padding: "0.5rem 1rem", textAlign: "left" }}>Recipient</th>
          <th style={{ padding: "0.5rem 1rem", textAlign: "left" }}>Token</th>
          <th style={{ padding: "0.5rem 1rem", textAlign: "left" }}>Status</th>
        </tr>
      </thead>
      <tbody>
        {ALL_STATUSES.map((s) => (
          <tr key={s} style={{ borderTop: "1px solid #E5E7EB" }}>
            <td style={{ padding: "0.5rem 1rem", color: "#374151" }}>GABC…{s.slice(0, 4).toUpperCase()}</td>
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
