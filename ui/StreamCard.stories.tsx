import type { Meta, StoryObj } from "@storybook/react";
import { StreamCard } from "../frontend/src/components/VestingDashboard";
import type { VestingStream } from "../frontend/src/types";

const BASE_LEDGER = 51_200_000;

/**
 * The dashboard's per-stream card is rendered by `StreamCard`, which is
 * exported from `VestingDashboard` so it can be exercised in isolation here.
 */
const meta = {
  title: "Vesting UI/StreamCard",
  component: StreamCard,
  parameters: {
    layout: "padded",
    docs: {
      description: {
        component:
          "Per-stream summary card: sponsor, status, claimable amount, two-stage " +
          "cliff/drip progress bar and schedule details.",
      },
    },
  },
  tags: ["autodocs"],
} satisfies Meta<typeof StreamCard>;

export default meta;
type Story = StoryObj<typeof meta>;

const activeStream: VestingStream = {
  id: "1",
  recipient: "GABC…XYZ",
  sponsor: "GSPON…",
  token: "USDC",
  rate: 10,
  claimableAmount: 1500,
  status: "active",
  startLedger: BASE_LEDGER - 172_800,
  cliffLedger: BASE_LEDGER - 86_400,
  endLedger: BASE_LEDGER + 6_048_000,
  totalDeposit: 63_072_000,
  totalVested: 1500,
};

const preCliffStream: VestingStream = {
  id: "2",
  recipient: "GABC…XYZ",
  sponsor: "GSPNR…",
  token: "USDC",
  rate: 5,
  claimableAmount: 0,
  status: "pre-cliff",
  startLedger: BASE_LEDGER - 17_280,
  cliffLedger: BASE_LEDGER + 259_200,
  endLedger: BASE_LEDGER + 2_592_000,
  totalDeposit: 12_960_000,
  totalVested: 0,
};

const completedStream: VestingStream = {
  id: "3",
  recipient: "GABC…XYZ",
  sponsor: "GSPON3…",
  token: "XLM",
  rate: 20,
  claimableAmount: 0,
  status: "completed",
  startLedger: BASE_LEDGER - 4_000_000,
  cliffLedger: BASE_LEDGER - 3_900_000,
  endLedger: BASE_LEDGER - 500_000,
  totalDeposit: 100_000_000,
  totalVested: 100_000_000,
};

export const Active: Story = {
  name: "Active — claimable, post-cliff",
  args: {
    stream: activeStream,
    currentLedger: BASE_LEDGER,
    onClaim: () => undefined,
  },
};

export const PreCliff: Story = {
  name: "Pre-cliff — locked",
  args: {
    stream: preCliffStream,
    currentLedger: BASE_LEDGER,
    onClaim: () => undefined,
  },
};

export const Completed: Story = {
  name: "Completed — fully vested",
  args: {
    stream: completedStream,
    currentLedger: BASE_LEDGER,
    onClaim: () => undefined,
  },
};
