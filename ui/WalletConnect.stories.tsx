import type { Meta, StoryObj } from "@storybook/react";
import { WalletModal } from "../frontend/src/components/WalletModal";

/**
 * The issue calls for a `WalletConnect` story. There is no component named
 * exactly `WalletConnect` in the codebase — WalletConnect v2 is one of the
 * providers surfaced by the unified `WalletModal` (alongside Freighter and
 * Albedo), so that component is the closest equivalent and is covered here.
 *
 * The related provider-abstraction UI is already covered by
 * `ui/WalletConnection.stories.tsx`.
 */
const meta = {
  title: "Vesting UI/WalletConnect",
  component: WalletModal,
  parameters: {
    layout: "centered",
    docs: {
      description: {
        component:
          "Unified wallet connection modal. Lists Freighter, WalletConnect v2 " +
          "(mobile via QR) and Albedo providers.",
      },
    },
  },
  tags: ["autodocs"],
  args: {
    onConnected: () => undefined,
    onDisconnect: () => undefined,
    onClose: () => undefined,
  },
} satisfies Meta<typeof WalletModal>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ProviderList: Story = {
  name: "Provider list (open)",
  args: {
    isOpen: true,
  },
};

export const AlreadyConnected: Story = {
  name: "Connected — shows address & disconnect",
  args: {
    isOpen: true,
    connectedAddress: "GABCDEFGHIJKLMNOPQRSTUVWXYZABCDEFGHIJKLMNOPQRSTUVWXYZ1234",
    network: "testnet",
  },
};
