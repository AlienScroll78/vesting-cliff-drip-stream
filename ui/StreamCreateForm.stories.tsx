import type { Meta, StoryObj } from "@storybook/react";
import { expect, userEvent, within } from "@storybook/test";
import React from "react";
import { StreamCreateForm } from "../frontend/src/components/StreamCreateForm";
import { WalletContext } from "../frontend/src/contexts/WalletContext";

// ─── Mock providers ───────────────────────────────────────────────────────────

const MOCK_ADDRESS = "GABCDE1234567890ABCDE1234567890ABCDE1234567890ABCDE12345678";

const connectedWallet = {
  address: MOCK_ADDRESS,
  freighterInstalled: true as const,
  balances: [],
  balancesLoading: false,
  connect: async () => {},
  disconnect: () => {},
};

const disconnectedWallet = {
  address: null,
  freighterInstalled: null,
  balances: [],
  balancesLoading: false,
  connect: async () => {},
  disconnect: () => {},
};

const FormWrapper = ({ children }: { children: React.ReactNode }) => (
  <div style={{ width: 400, padding: 24, background: "#fff", borderRadius: 8, boxShadow: "0 2px 8px rgba(0,0,0,0.1)" }}>
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
  parameters: {
    docs: {
      description: {
        component:
          "Form for creating a new vesting stream. Validates all fields client-side and submits a Soroban contract invocation via the Freighter wallet.",
      },
    },
  },
};

export default meta;
type Story = StoryObj<typeof StreamCreateForm>;

// ─── Default ──────────────────────────────────────────────────────────────────

export const Default: Story = {
  name: "Default (empty, wallet connected)",
  args: { onSuccess: undefined },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const form = canvas.getByRole("form", { name: /create vesting stream/i });
    expect(form).toBeInTheDocument();
    const submitBtn = canvas.getByTestId("stream-create-submit");
    expect(submitBtn).toBeEnabled();
  },
};

// ─── Validation errors ────────────────────────────────────────────────────────

export const WithValidationErrors: Story = {
  name: "Validation errors (submit empty)",
  parameters: {
    docs: { description: { story: "Clicking submit without filling in fields reveals inline validation errors on each field." } },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const submitBtn = canvas.getByTestId("stream-create-submit");
    await userEvent.click(submitBtn);
    const recipientError = await canvas.findByTestId("recipient-error");
    expect(recipientError).toBeInTheDocument();
    const tokenError = canvas.getByTestId("token-error");
    expect(tokenError).toBeInTheDocument();
    const rateError = canvas.getByTestId("rate-error");
    expect(rateError).toBeInTheDocument();
  },
};

// ─── Filled form ─────────────────────────────────────────────────────────────

export const FilledForm: Story = {
  name: "Filled (valid data, deposit preview)",
  parameters: {
    docs: { description: { story: "All fields filled with valid data; shows the estimated deposit preview." } },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    // Use a valid G-address (56 chars) for recipient
    const recipientAddr = "GABCDE1234567890ABCDE1234567890ABCDE1234567890ABCDE12345678";
    const tokenAddr = "CABCDE1234567890ABCDE1234567890ABCDE1234567890ABCDE12345678";

    await userEvent.type(canvas.getByLabelText(/recipient address/i), recipientAddr);
    await userEvent.type(canvas.getByLabelText(/token contract/i), tokenAddr);
    await userEvent.type(canvas.getByLabelText(/rate/i), "10");
    await userEvent.type(canvas.getByLabelText(/cliff duration/i), "30");
    await userEvent.type(canvas.getByLabelText(/total duration/i), "365");

    const preview = await canvas.findByTestId("deposit-preview");
    expect(preview).toBeInTheDocument();
    expect(preview).toHaveTextContent("tokens");
  },
};

// ─── Wallet not connected ─────────────────────────────────────────────────────

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
    const submitBtn = canvas.getByTestId("stream-create-submit");
    expect(submitBtn).toBeDisabled();
    const alert = canvas.getByRole("alert");
    expect(alert).toHaveTextContent(/connect your wallet/i);
  },
};
