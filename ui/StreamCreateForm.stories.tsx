import type { Meta, StoryObj } from "@storybook/react";
import { expect, userEvent, within } from "@storybook/test";
import React from "react";
import { StreamCreateForm } from "../frontend/src/components/StreamCreateForm";
import { WalletContext } from "../frontend/src/contexts/WalletContext";

const VALID_ADDRESS = "GJLJ23WVK4UWYA4RGQTOUFXNZUBTTJMIRQPASCDZ4G4HM53NOT5W2OZX";
const SPONSOR_ADDRESS = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
const VALID_TOKEN = "CFU5BPFMUWIF6LXAQFCQ2RDS75QZL5ER2XXKHSIM2FBHTB4MFTKA5ITF";

const connectedWallet = {
  address: SPONSOR_ADDRESS,
  freighterInstalled: true as const,
  balances: [],
  balancesLoading: false,
  provider: "freighter" as const,
  network: "testnet" as const,
  modalOpen: false,
  openModal: () => {},
  closeModal: () => {},
  connect: async () => {},
  connectWithProvider: () => {},
  disconnect: () => {},
  switchNetwork: () => {},
};

const disconnectedWallet = {
  ...connectedWallet,
  address: null,
  freighterInstalled: false,
  provider: null,
};

const FormWrapper = ({ children }: { children: React.ReactNode }) => (
  <div style={{ width: 480, padding: 24, background: "var(--color-bg-base, #fff)", borderRadius: 8 }}>
    {children}
  </div>
);

const meta: Meta<typeof StreamCreateForm> = {
  title: "Components/StreamCreateForm",
  component: StreamCreateForm,
  decorators: [
    (Story) => (
      <WalletContext.Provider value={connectedWallet}>
        <FormWrapper>
          <Story />
        </FormWrapper>
      </WalletContext.Provider>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof StreamCreateForm>;

export const SimpleMode: Story = {
  name: "Simple mode",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    expect(canvas.getByTestId("stream-create-form")).toBeInTheDocument();
    expect(canvas.getByTestId("advanced-options-toggle")).toHaveAttribute("aria-expanded", "false");
    expect(canvas.queryByLabelText(/custom rate/i)).not.toBeInTheDocument();
  },
};

export const AdvancedMode: Story = {
  name: "Advanced mode",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByTestId("advanced-options-toggle"));
    expect(canvas.getByLabelText(/custom rate/i)).toBeVisible();
    expect(canvas.getByLabelText(/variable rate segments/i)).toBeVisible();
    expect(canvas.getByLabelText(/metadata/i)).toBeVisible();
    expect(canvas.getByLabelText(/allowlist override/i)).toBeVisible();
  },
};

export const FilledForm: Story = {
  name: "Filled with derived rate",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByLabelText(/recipient address/i), VALID_ADDRESS);
    await userEvent.type(canvas.getByLabelText(/token contract/i), VALID_TOKEN);
    await userEvent.type(canvas.getByLabelText(/total amount/i), "1000");
    await userEvent.type(canvas.getByLabelText(/cliff duration/i), "30");
    await userEvent.type(canvas.getByLabelText(/total duration/i), "365");
    expect(await canvas.findByTestId("deposit-preview")).toHaveTextContent(/derived rate/i);
  },
};

export const NoWallet: Story = {
  name: "Wallet not connected",
  decorators: [
    (Story) => (
      <WalletContext.Provider value={disconnectedWallet}>
        <FormWrapper>
          <Story />
        </FormWrapper>
      </WalletContext.Provider>
    ),
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    expect(canvas.getByTestId("stream-create-submit")).toBeDisabled();
    expect(canvas.getByRole("alert")).toHaveTextContent(/connect your wallet/i);
  },
};
