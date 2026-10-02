import type { Meta, StoryObj } from "@storybook/react";
import { SponsorDashboard, type SponsorStream } from "../frontend/src/components/SponsorDashboard";

const meta = {
  title: "Vesting UI/SponsorDashboard",
  component: SponsorDashboard,
  parameters: { layout: "fullscreen" },
  tags: ["autodocs"],
} satisfies Meta<typeof SponsorDashboard>;

export default meta;
type Story = StoryObj<typeof meta>;

// ─── Fixture data ─────────────────────────────────────────────────────────────

function makeStream(overrides: Partial<SponsorStream> = {}): SponsorStream {
  return {
    id: `stream-${Math.random().toString(36).slice(2, 8)}`,
    recipient: `G${Math.random().toString(36).slice(2).toUpperCase().padEnd(55, "A")}`,
    token: `C${Math.random().toString(36).slice(2).toUpperCase().padEnd(55, "B")}`,
    tokenSymbol: "XLM",
    ratePerLedger: 10,
    cliffDate: "2026-03-01",
    endDate: "2027-03-01",
    status: "active",
    claimedPercent: Math.round(Math.random() * 80),
    totalAmount: 1_000_000,
    claimedAmount: 250_000,
    createdAt: "2026-01-01",
    ...overrides,
  };
}

const streams: SponsorStream[] = [
  makeStream({ tokenSymbol: "XLM", status: "active", claimedPercent: 35 }),
  makeStream({ tokenSymbol: "USDC", status: "pre-cliff", claimedPercent: 0 }),
  makeStream({ tokenSymbol: "XLM", status: "expired", claimedPercent: 100, endDate: "2025-12-01" }),
  makeStream({ tokenSymbol: "AQUA", status: "cancelled", claimedPercent: 22 }),
  makeStream({ tokenSymbol: "XLM", status: "active", claimedPercent: 60 }),
  makeStream({ tokenSymbol: "USDC", status: "active", claimedPercent: 8 }),
];

// ─── Stories ──────────────────────────────────────────────────────────────────

export const WithStreams: Story = {
  name: "Dashboard with streams",
  args: {
    sponsorAddress: "GABCDEFGHIJKLMNOPQRSTUVWXYZABCDEFGHIJKLMNOPQRSTUVWXYZ1234",
    streams,
    onCancelStream: async (id) => {
      console.log("Cancel:", id);
      await new Promise((r) => setTimeout(r, 800));
    },
    onViewStream: (id) => console.log("View:", id),
  },
  parameters: { layout: "padded" },
};

export const EmptyState: Story = {
  name: "Empty state (no streams)",
  args: {
    sponsorAddress: "GABCDEFGHIJKLMNOPQRSTUVWXYZABCDEFGHIJKLMNOPQRSTUVWXYZ1234",
    streams: [],
  },
  parameters: { layout: "padded" },
};

// Generate 120 streams for virtual scroll demo
export const ManyStreams: Story = {
  name: "Virtual scroll (120 streams)",
  args: {
    sponsorAddress: "GABCDEFGHIJKLMNOPQRSTUVWXYZABCDEFGHIJKLMNOPQRSTUVWXYZ1234",
    streams: Array.from({ length: 120 }, (_, i) =>
      makeStream({
        tokenSymbol: ["XLM", "USDC", "AQUA"][i % 3],
        status: (["active", "pre-cliff", "expired", "cancelled"] as const)[i % 4],
        claimedPercent: Math.round((i / 120) * 100),
      })
    ),
  },
  parameters: { layout: "padded" },
};
