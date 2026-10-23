import type { Meta, StoryObj } from "@storybook/react";
import { CreateStreamForm } from "../frontend/src/components/CreateStreamForm";

const meta = {
  title: "Vesting UI/CreateStreamForm",
  component: CreateStreamForm,
  parameters: {
    layout: "padded",
    docs: {
      description: {
        component:
          "Multi-step form for sponsors to create vesting streams. Steps: Recipient → Token → Schedule → Review → Sign.",
      },
    },
  },
  tags: ["autodocs"],
  argTypes: {
    sponsorAddress: {
      control: "text",
      description: "Connected wallet address. Form is disabled if empty.",
    },
    onSuccess: { action: "streamCreated" },
  },
} satisfies Meta<typeof CreateStreamForm>;

export default meta;
type Story = StoryObj<typeof meta>;

// ─── Stories ──────────────────────────────────────────────────────────────────

/** Default: wallet connected, starts at step 1 */
export const Default: Story = {
  name: "Step 1 — Recipient (connected)",
  args: {
    sponsorAddress: "GABC1234SPONSORADDRESSXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
  },
};

/** No wallet connected — shows connect prompt */
export const WalletNotConnected: Story = {
  name: "Wallet not connected",
  args: {
    sponsorAddress: undefined,
  },
};
