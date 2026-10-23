import type { Meta, StoryObj } from "@storybook/react";
import { StreamDetails } from "../frontend/src/app/dashboard/StreamDashboardClient";
import type { VestingStream } from "../frontend/src/types";

const BASE_LEDGER = 51_200_000;

/**
 * `StreamDetails` renders the `<dl>` breakdown of a single vesting stream
 * (cliff date, vested/remaining totals, drip rate, sponsor and status).
 * It is exported from `StreamDashboardClient` so it can be exercised in
 * isolation here.
 */
const meta = {
  title: "Vesting UI/StreamDetail",
  component: StreamDetails,
  parameters: {
    layout: "padded",
    docs: {
      description: {
        component:
          "Per-stream detail grid: cliff date, total vested, total remaining, " +
          "total deposit, drip rate, sponsor and status.",
      },
    },
  },
  tags: ["autodocs"],
} satisfies Meta<typeof StreamDetails>;

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
  token: "XLM",
  rate: 5,
  claimableAmount: 0,
  status: "pre-cliff",
  startLedger: BASE_LEDGER - 17_280,
  cliffLedger: BASE_LEDGER + 259_200,
  endLedger: BASE_LEDGER + 2_592_000,
  totalDeposit: 12_960_000,
  totalVested: 0,
};

export const Active: Story = {
  name: "Active — post-cliff",
  args: {
    stream: activeStream,
    progress: 42,
    totalRemaining: 61_572_000,
  },
};

export const PreCliff: Story = {
  name: "Pre-cliff — locked",
  args: {
    stream: preCliffStream,
    progress: 0,
    totalRemaining: 12_960_000,
  },
};
