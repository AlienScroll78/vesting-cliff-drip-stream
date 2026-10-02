import type { Meta, StoryObj } from "@storybook/react";
import { CliffCountdown } from "../frontend/src/components/CliffCountdown";

const meta: Meta<typeof CliffCountdown> = {
  title: "Components/CliffCountdown",
  component: CliffCountdown,
  parameters: {
    docs: {
      description: {
        component: "Accessible, live cliff countdown with adaptive refresh intervals.",
      },
    },
  },
};

export default meta;
type Story = StoryObj<typeof CliffCountdown>;

export const MoreThanSevenDays: Story = {
  args: {
    cliffLedger: (142 * 86400 + 6 * 3600) / 5,
    currentLedger: 0,
  },
};

export const OneToSevenDays: Story = {
  args: {
    cliffLedger: (6 * 86400 + 14 * 3600 + 32 * 60) / 5,
    currentLedger: 0,
  },
};

export const LastHour: Story = {
  args: {
    cliffLedger: (47 * 60 + 23) / 5,
    currentLedger: 0,
  },
};

export const CliffReached: Story = {
  args: {
    cliffLedger: 100,
    currentLedger: 100,
    claimableAmount: 1250,
    tokenSymbol: "USDC",
    onClaim: () => undefined,
  },
};

export const ReducedMotion: Story = {
  args: {
    cliffLedger: 100,
    currentLedger: 100,
  },
  parameters: {
    chromatic: {
      modes: ["light", "dark"],
    },
  },
};
