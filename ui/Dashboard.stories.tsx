import type { Meta, StoryObj } from "@storybook/react";
import { VestingDashboard } from "../frontend/src/components/VestingDashboard";
import {
  WalletContext,
  type WalletProvider,
} from "../frontend/src/contexts/WalletContext";
import type { WalletBalance } from "../frontend/src/types";

/**
 * `VestingDashboard` is the recipient-facing "My Streams" dashboard. It only
 * renders streams once a wallet is connected, so this story supplies a mocked
 * `WalletContext` value to exercise both the connected and disconnected states
 * deterministically (no Freighter extension required).
 *
 * Note: the closest sibling `SponsorDashboard` (sponsor-facing) is covered by
 * `ui/SponsorDashboard.stories.tsx`.
 */
const meta = {
  title: "Vesting UI/Dashboard",
  component: VestingDashboard,
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "Recipient dashboard listing every vesting stream for the connected " +
          "wallet, with cliff/drip progress and claim actions.",
      },
    },
  },
  tags: ["autodocs"],
} satisfies Meta<typeof VestingDashboard>;

export default meta;
type Story = StoryObj<typeof meta>;

const ADDRESS = "GABCDEFGHIJKLMNOPQRSTUVWXYZABCDEFGHIJKLMNOPQRSTUVWXYZ1234";

const balances: WalletBalance[] = [
  { token: "XLM", amount: 1250.5 },
  { token: "USDC", amount: 4200 },
];

function mockWallet(overrides: {
  address: string | null;
  provider?: WalletProvider | null;
  balances?: WalletBalance[];
}) {
  return {
    address: overrides.address,
    provider: overrides.provider ?? null,
    network: "testnet" as const,
    freighterInstalled: true,
    balances: overrides.balances ?? [],
    balancesLoading: false,
    modalOpen: false,
    openModal: () => undefined,
    closeModal: () => undefined,
    connect: async () => undefined,
    connectWithProvider: () => undefined,
    disconnect: () => undefined,
    switchNetwork: () => undefined,
  };
}

export const Connected: Story = {
  name: "Connected — streams loaded",
  decorators: [
    (Story) => (
      <WalletContext.Provider value={mockWallet({ address: ADDRESS, provider: "freighter", balances })}>
        <div style={{ padding: "1.5rem" }}>
          <Story />
        </div>
      </WalletContext.Provider>
    ),
  ],
  parameters: {
    // Allow the 600ms mock fetch + initial render to settle before snapshotting.
    chromatic: { delay: 1500 },
  },
};

export const Disconnected: Story = {
  name: "Disconnected — connect prompt",
  decorators: [
    (Story) => (
      <WalletContext.Provider value={mockWallet({ address: null })}>
        <div style={{ padding: "1.5rem" }}>
          <Story />
        </div>
      </WalletContext.Provider>
    ),
  ],
  parameters: {
    chromatic: { delay: 1500 },
  },
};
