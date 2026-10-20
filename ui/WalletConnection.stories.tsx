import type { Meta, StoryObj } from "@storybook/react";
import { WalletConnectionProvider, WalletConnectButton, WALLET_OPTIONS, type WalletOption } from "../frontend/src/components/WalletConnection";

// Mock wallet options for Storybook (no real browser extensions)
const mockWallets: WalletOption[] = [
  {
    ...WALLET_OPTIONS[0], // Freighter
    isAvailable: () => true,
    connect: async () => {
      await new Promise((r) => setTimeout(r, 800));
      return "GABC1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZABCDE1234567890XYZ";
    },
    disconnect: async () => {},
  },
  {
    ...WALLET_OPTIONS[1], // LOBSTR
    isAvailable: () => false, // Not installed in Storybook
    connect: async () => { throw new Error("LOBSTR not installed"); },
    disconnect: async () => {},
  },
  {
    ...WALLET_OPTIONS[2], // xBull
    isAvailable: () => false,
    connect: async () => { throw new Error("xBull not installed"); },
    disconnect: async () => {},
  },
  {
    ...WALLET_OPTIONS[3], // WalletConnect
    isAvailable: () => true,
    connect: async () => {
      throw new Error("WalletConnect requires project configuration.");
    },
    disconnect: async () => {},
  },
];

const meta = {
  title: "Vesting UI/WalletConnection",
  component: WalletConnectButton,
  parameters: { layout: "centered" },
  tags: ["autodocs"],
  decorators: [
    (Story: React.ComponentType) => (
      <WalletConnectionProvider wallets={mockWallets}>
        <div style={{ padding: "20px", background: "#0F172A", minHeight: "80px", display: "flex", alignItems: "center" }}>
          <Story />
        </div>
      </WalletConnectionProvider>
    ),
  ],
} satisfies Meta<typeof WalletConnectButton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const DisconnectedButton: Story = {
  name: "Disconnected — shows 'Connect Wallet'",
};

export const WalletSelectorModal: Story = {
  name: "Wallet selector modal (click button to open)",
};
