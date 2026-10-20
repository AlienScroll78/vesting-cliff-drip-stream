import type { Meta, StoryObj } from "@storybook/react";
import { expect, within } from "@storybook/test";
import React from "react";
import {
  AnalyticsSummarySkeleton,
  DashboardSkeleton,
  FormSkeleton,
  NotificationListSkeleton,
  Skeleton,
  SponsorStreamListSkeleton,
  StreamCardSkeleton,
  StreamDetailSkeleton,
  StreamExplorerSkeleton,
  StreamListSkeleton,
  StatsRowSkeleton,
  TransactionHistorySkeleton,
} from "../frontend/src/components/Skeletons";

const meta: Meta = {
  title: "Components/Skeletons",
  parameters: {
    docs: {
      description: {
        component:
          "Skeleton loading screens with shimmer animation. Replace spinner-based loading states to reduce perceived load time and prevent layout shift. All skeleton containers have aria-busy='true' and aria-label='Loading' for accessibility.",
      },
    },
  },
};

export default meta;
type Story = StoryObj;

// ─── Base Skeleton primitive ──────────────────────────────────────────────────

export const AllVariants: Story = {
  name: "Base Skeleton variants",
  parameters: {
    docs: { description: { story: "The three skeleton shapes: rect, circle, and text." } },
  },
  render: () => (
    <div style={{ display: "flex", flexDirection: "column", gap: 20, width: 320 }}>
      <div>
        <p style={{ fontFamily: "sans-serif", fontSize: 12, color: "#666", marginBottom: 8 }}>Rect (default)</p>
        <Skeleton width="100%" height="2rem" shape="rect" />
      </div>
      <div>
        <p style={{ fontFamily: "sans-serif", fontSize: 12, color: "#666", marginBottom: 8 }}>Circle (avatar)</p>
        <Skeleton width="3rem" height="3rem" shape="circle" />
      </div>
      <div>
        <p style={{ fontFamily: "sans-serif", fontSize: 12, color: "#666", marginBottom: 8 }}>Text (multiple lines)</p>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <Skeleton width="95%" shape="text" />
          <Skeleton width="80%" shape="text" />
          <Skeleton width="60%" shape="text" />
        </div>
      </div>
    </div>
  ),
};

// ─── StreamCard ───────────────────────────────────────────────────────────────

export const StreamCard: Story = {
  name: "StreamCard skeleton",
  parameters: {
    docs: { description: { story: "Matches the StreamCard layout exactly to prevent layout shift on load." } },
  },
  render: () => (
    <ul style={{ padding: 0, maxWidth: 480, margin: "0 auto" }}>
      <StreamCardSkeleton />
    </ul>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // The li is aria-hidden because it's decorative, so verify the DOM structure
    const card = canvasElement.querySelector(".skeleton-stream-card");
    expect(card).toBeInTheDocument();
    expect(card).toHaveAttribute("aria-hidden", "true");
  },
};

// ─── StreamList (multiple cards) ──────────────────────────────────────────────

export const StreamList: Story = {
  name: "StreamList skeleton (3 cards, capped)",
  parameters: {
    docs: { description: { story: "Always shows at most 3 skeleton rows regardless of the count prop." } },
  },
  render: () => (
    <div style={{ maxWidth: 480, margin: "0 auto" }}>
      <StreamListSkeleton count={3} />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const list = canvas.getByRole("list", { name: /loading streams/i });
    expect(list).toBeInTheDocument();
    expect(list).toHaveAttribute("aria-busy", "true");
    // Should render exactly 3 cards
    const cards = list.querySelectorAll(".skeleton-stream-card");
    expect(cards.length).toBe(3);
  },
};

export const StreamListCapped: Story = {
  name: "StreamList skeleton (count=10, still shows 3)",
  parameters: {
    docs: { description: { story: "Demonstrates the 3-row cap: passing count=10 still renders only 3 skeletons." } },
  },
  render: () => (
    <div style={{ maxWidth: 480, margin: "0 auto" }}>
      <StreamListSkeleton count={10} />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const list = canvasElement.querySelector("[aria-label='Loading streams']");
    expect(list).toBeInTheDocument();
    const cards = list!.querySelectorAll(".skeleton-stream-card");
    expect(cards.length).toBe(3);
  },
};

// ─── StreamDetail ─────────────────────────────────────────────────────────────

export const StreamDetail: Story = {
  name: "StreamDetail skeleton",
  parameters: {
    docs: { description: { story: "Matches the stream detail panel with stats grid and timeline row." } },
  },
  render: () => <StreamDetailSkeleton />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const detail = canvas.getByRole("generic", { name: /loading stream details/i });
    expect(detail).toHaveAttribute("aria-busy", "true");
  },
};

// ─── TransactionHistory ───────────────────────────────────────────────────────

export const TransactionHistory: Story = {
  name: "TransactionHistory skeleton",
  parameters: {
    docs: { description: { story: "Table skeleton matching the tx history: hash, amount, and date columns." } },
  },
  render: () => (
    <div style={{ maxWidth: 600, margin: "0 auto" }}>
      <TransactionHistorySkeleton rows={3} />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const table = canvas.getByRole("generic", { name: /loading transaction history/i });
    expect(table).toHaveAttribute("aria-busy", "true");
    const rows = table.querySelectorAll(".skeleton-table-row");
    expect(rows.length).toBe(3);
  },
};

// ─── StatsRow ─────────────────────────────────────────────────────────────────

export const StatsRow: Story = {
  name: "StatsRow skeleton",
  render: () => (
    <div style={{ maxWidth: 600, margin: "0 auto" }}>
      <StatsRowSkeleton />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const row = canvas.getByRole("generic", { name: /loading stats/i });
    expect(row).toHaveAttribute("aria-busy", "true");
  },
};

// ─── Dashboard ────────────────────────────────────────────────────────────────

export const Dashboard: Story = {
  name: "Dashboard skeleton (full page)",
  parameters: {
    layout: "padded",
    docs: { description: { story: "Full dashboard layout: stats row above stream list." } },
  },
  render: () => (
    <div style={{ maxWidth: 600, margin: "0 auto" }}>
      <DashboardSkeleton />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const dashboard = canvasElement.querySelector("[aria-label='Loading dashboard']");
    expect(dashboard).toBeInTheDocument();
    expect(dashboard).toHaveAttribute("aria-busy", "true");
  },
};

// ─── Form ─────────────────────────────────────────────────────────────────────

export const Form: Story = {
  name: "Form skeleton",
  parameters: {
    docs: { description: { story: "Generic form skeleton with label + input field rows and a submit button." } },
  },
  render: () => <FormSkeleton fields={5} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const form = canvas.getByRole("generic", { name: /loading form/i });
    expect(form).toHaveAttribute("aria-busy", "true");
  },
};

// ─── Reduced motion ───────────────────────────────────────────────────────────

export const ReducedMotion: Story = {
  name: "Reduced motion (static fallback)",
  parameters: {
    docs: {
      description: {
        story:
          "When `prefers-reduced-motion: reduce` is set, the shimmer animation is disabled entirely and the placeholder becomes a static block. This story shows the skeleton structure; the motion behaviour follows the system setting.",
      },
    },
  },
  render: () => (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 400 }}>
      <p style={{ fontFamily: "sans-serif", fontSize: 13, color: "#666", margin: 0 }}>
        Skeleton structure (motion behaviour follows system prefers-reduced-motion):
      </p>
      <StreamCardSkeleton />
    </div>
  ),
};

// ─── SponsorStreamList (#823) ─────────────────────────────────────────────────

export const SponsorStreamList: Story = {
  name: "SponsorStreamList skeleton",
  parameters: {
    docs: {
      description: {
        story:
          "Sponsor stream list rows. Text widths vary row to row so the placeholder reads as a list of records rather than a uniform grid.",
      },
    },
  },
  render: () => (
    <div style={{ maxWidth: 480, margin: "0 auto" }}>
      <SponsorStreamListSkeleton rows={5} />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const list = canvas.getByRole("list", { name: /loading sponsor streams/i });
    expect(list).toHaveAttribute("aria-busy", "true");
    expect(list.querySelectorAll("[data-testid='sponsor-stream-skeleton-row']").length).toBe(5);
  },
};

// ─── StreamExplorer (#823) ────────────────────────────────────────────────────

export const StreamExplorer: Story = {
  name: "StreamExplorer skeleton",
  parameters: {
    docs: {
      description: {
        story:
          "Explorer table rows. Column widths are locked in while loading so the table doesn't reflow when data arrives.",
      },
    },
  },
  render: () => (
    <div style={{ maxWidth: 600, margin: "0 auto" }}>
      <StreamExplorerSkeleton rows={6} />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const table = canvas.getByRole("generic", { name: /loading stream explorer/i });
    expect(table).toHaveAttribute("aria-busy", "true");
    expect(table.querySelectorAll("[data-testid='explorer-skeleton-row']").length).toBe(6);
  },
};

// ─── NotificationList (#823) ──────────────────────────────────────────────────

export const NotificationList: Story = {
  name: "NotificationList skeleton",
  parameters: {
    docs: {
      description: {
        story:
          "Notification items: leading icon circle, two text lines, and a trailing timestamp placeholder.",
      },
    },
  },
  render: () => (
    <div style={{ maxWidth: 400, margin: "0 auto" }}>
      <NotificationListSkeleton items={4} />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const list = canvas.getByRole("list", { name: /loading notifications/i });
    expect(list).toHaveAttribute("aria-busy", "true");
    expect(list.querySelectorAll("[data-testid='notification-skeleton-item']").length).toBe(4);
  },
};

// ─── AnalyticsSummary (#823) ──────────────────────────────────────────────────

export const AnalyticsSummary: Story = {
  name: "AnalyticsSummary skeleton",
  parameters: {
    layout: "padded",
    docs: {
      description: {
        story:
          "Analytics page: a row of stat cards above a fixed-height chart placeholder, so the page doesn't jump when data loads.",
      },
    },
  },
  render: () => (
    <div style={{ maxWidth: 640, margin: "0 auto" }}>
      <AnalyticsSummarySkeleton cards={4} />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const summary = canvas.getByRole("generic", { name: /loading analytics/i });
    expect(summary).toHaveAttribute("aria-busy", "true");
    expect(summary.querySelectorAll("[data-testid='analytics-skeleton-card']").length).toBe(4);
  },
};

export const AnalyticsSummaryCardsOnly: Story = {
  name: "AnalyticsSummary skeleton (cards only)",
  parameters: {
    docs: {
      description: {
        story:
          "`showChart={false}` renders just the stat cards — used where a chart will never appear, so no space is reserved for it.",
      },
    },
  },
  render: () => <AnalyticsSummarySkeleton cards={3} showChart={false} />,
  play: async ({ canvasElement }) => {
    expect(
      canvasElement.querySelectorAll("[data-testid='analytics-skeleton-card']").length,
    ).toBe(3);
  },
};

// ─── All page skeletons (#823) ────────────────────────────────────────────────

export const AllPages: Story = {
  name: "All five page skeletons",
  parameters: {
    layout: "padded",
    docs: {
      description: {
        story:
          "Every data-fetching view's loading state side by side: stream dashboard, sponsor stream list, stream explorer, notification list, and analytics summary.",
      },
    },
  },
  render: () => (
    <div style={{ display: "grid", gap: 32, maxWidth: 720, margin: "0 auto" }}>
      <section>
        <h3 style={{ fontFamily: "sans-serif", fontSize: 14, color: "#444" }}>Stream Dashboard</h3>
        <DashboardSkeleton />
      </section>
      <section>
        <h3 style={{ fontFamily: "sans-serif", fontSize: 14, color: "#444" }}>Sponsor Stream List</h3>
        <SponsorStreamListSkeleton rows={3} />
      </section>
      <section>
        <h3 style={{ fontFamily: "sans-serif", fontSize: 14, color: "#444" }}>Stream Explorer</h3>
        <StreamExplorerSkeleton rows={4} />
      </section>
      <section>
        <h3 style={{ fontFamily: "sans-serif", fontSize: 14, color: "#444" }}>Notification List</h3>
        <NotificationListSkeleton items={3} />
      </section>
      <section>
        <h3 style={{ fontFamily: "sans-serif", fontSize: 14, color: "#444" }}>Analytics Summary</h3>
        <AnalyticsSummarySkeleton cards={4} />
      </section>
    </div>
  ),
};

