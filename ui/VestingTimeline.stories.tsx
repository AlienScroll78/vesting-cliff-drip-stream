import type { Meta, StoryObj } from "@storybook/react";
import { VestingTimeline } from "../frontend/src/components/VestingTimeline";

const meta = {
  title: "Vesting UI/VestingTimeline",
  component: VestingTimeline,
  parameters: {
    layout: "padded",
  },
  tags: ["autodocs"],
} satisfies Meta<typeof VestingTimeline>;

export default meta;
type Story = StoryObj<typeof meta>;

// ─── Shared base ──────────────────────────────────────────────────────────────

const baseArgs = {
  startLedger: 1000,
  cliffLedger: 10000,
  endLedger: 100000,
  totalAmount: BigInt(1_000_000),
  tokenSymbol: "XLM",
};

// ─── Stories ──────────────────────────────────────────────────────────────────

/** Before the cliff — all tokens locked */
export const PreCliff: Story = {
  name: "Pre-cliff (all locked)",
  args: {
    ...baseArgs,
    currentLedger: 5000,
    claimedAmount: BigInt(0),
    claimableAmount: BigInt(0),
  },
};

/** At exactly the cliff — instant catch-up unlocked */
export const AtCliff: Story = {
  name: "At cliff (catch-up unlocked)",
  args: {
    ...baseArgs,
    currentLedger: 10000,
    claimedAmount: BigInt(0),
    claimableAmount: BigInt(100_000), // cliff catch-up
  },
};

/** Mid-stream — some claimed, more claimable, rest locked */
export const PostCliffPartialClaim: Story = {
  name: "Post-cliff — partial claim",
  args: {
    ...baseArgs,
    currentLedger: 55000,
    claimedAmount: BigInt(200_000),
    claimableAmount: BigInt(350_000),
  },
};

/** Stream fully expired */
export const Expired: Story = {
  name: "Expired — all tokens released",
  args: {
    ...baseArgs,
    currentLedger: 110000,
    claimedAmount: BigInt(800_000),
    claimableAmount: BigInt(200_000),
  },
};

/** Fully claimed */
export const FullyClaimed: Story = {
  name: "Fully claimed",
  args: {
    ...baseArgs,
    currentLedger: 110000,
    claimedAmount: BigInt(1_000_000),
    claimableAmount: BigInt(0),
  },
};

/** Short cliff — cliff is a small fraction of total */
export const ShortCliff: Story = {
  name: "Short cliff (5%)",
  args: {
    ...baseArgs,
    cliffLedger: 5450, // ~5% of 99000 span
    currentLedger: 50000,
    claimedAmount: BigInt(400_000),
    claimableAmount: BigInt(100_000),
  },
};

/** Long cliff — cliff is the majority of the vesting period */
export const LongCliff: Story = {
  name: "Long cliff (75%)",
  args: {
    ...baseArgs,
    cliffLedger: 74250,
    currentLedger: 40000,
    claimedAmount: BigInt(0),
    claimableAmount: BigInt(0),
  },
};
