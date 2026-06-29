import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StreamCreateForm } from "@/components/StreamCreateForm";
import { WalletContext } from "@/contexts/WalletContext";

const VALID_ADDRESS = "GJLJ23WVK4UWYA4RGQTOUFXNZUBTTJMIRQPASCDZ4G4HM53NOT5W2OZX";
const VALID_TOKEN   = "CFU5BPFMUWIF6LXAQFCQ2RDS75QZL5ER2XXKHSIM2FBHTB4MFTKA5ITF";

function renderNoWallet(props = {}) {
  return render(
    <WalletContext.Provider value={{ address: null, freighterInstalled: false, connect: vi.fn(), disconnect: vi.fn() }}>
      <StreamCreateForm {...props} />
    </WalletContext.Provider>
  );
}

function renderWithWallet(props = {}) {
  return render(
    <WalletContext.Provider value={{ address: VALID_ADDRESS, freighterInstalled: true, connect: vi.fn(), disconnect: vi.fn() }}>
      <StreamCreateForm {...props} />
    </WalletContext.Provider>
  );
}

/** Fill a field via userEvent (triggers real React synthetic events) */
async function fill(label: RegExp, value: string) {
  const input = screen.getByLabelText(label);
  await userEvent.clear(input);
  await userEvent.type(input, value);
  await userEvent.tab(); // blur to set touched
}

describe("StreamCreateForm", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("shows error for empty recipient on blur", async () => {
    renderNoWallet();
    await userEvent.click(screen.getByLabelText(/recipient address/i));
    await userEvent.tab();
    expect(screen.getByTestId("recipient-error")).toHaveTextContent(/required/i);
  });

  it("shows error for invalid Stellar address", async () => {
    renderNoWallet();
    await fill(/recipient address/i, "bad");
    expect(screen.getByTestId("recipient-error")).toHaveTextContent(/valid stellar address/i);
  });

  it("shows error for invalid token address", async () => {
    renderNoWallet();
    await fill(/token contract/i, "bad");
    expect(screen.getByTestId("token-error")).toHaveTextContent(/SAC contract address/i);
  });

  it("clears recipient error when valid address is entered", async () => {
    renderNoWallet();
    await fill(/recipient address/i, "bad");
    expect(screen.getByTestId("recipient-error")).toBeInTheDocument();
    // Replace with valid address
    const input = screen.getByLabelText(/recipient address/i);
    await userEvent.clear(input);
    await userEvent.type(input, VALID_ADDRESS);
    await userEvent.tab();
    expect(screen.queryByTestId("recipient-error")).not.toBeInTheDocument();
  });

  it("shows error when rate is 0", async () => {
    renderNoWallet();
    await fill(/rate \(tokens per ledger\)/i, "0");
    expect(screen.getByTestId("rate-error")).toHaveTextContent(/positive integer/i);
  });

  it("shows error when total duration <= cliff duration", async () => {
    renderNoWallet();
    await fill(/cliff duration \(days\)/i, "100");
    await fill(/total duration \(days\)/i, "100");
    expect(screen.getByTestId("totalDays-error")).toHaveTextContent(/greater than cliff/i);
  });

  it("shows ledger hint for cliff duration", async () => {
    renderNoWallet();
    await fill(/cliff duration \(days\)/i, "30");
    expect(screen.getByText(/ledgers/i)).toBeInTheDocument();
  });

  it("submit is disabled when no wallet even with valid inputs", async () => {
    renderNoWallet();
    await fill(/recipient address/i, VALID_ADDRESS);
    await fill(/token contract/i, VALID_TOKEN);
    await fill(/rate \(tokens per ledger\)/i, "10");
    await fill(/cliff duration \(days\)/i, "30");
    await fill(/total duration \(days\)/i, "365");
    expect(screen.getByTestId("stream-create-submit")).toBeDisabled();
  });

  it("surfaces all field errors when submitted with empty form", async () => {
    renderWithWallet();
    await userEvent.click(screen.getByTestId("stream-create-submit"));
    await waitFor(() => {
      expect(screen.getByTestId("recipient-error")).toBeInTheDocument();
      expect(screen.getByTestId("token-error")).toBeInTheDocument();
      expect(screen.getByTestId("rate-error")).toBeInTheDocument();
      expect(screen.getByTestId("cliffDays-error")).toBeInTheDocument();
      expect(screen.getByTestId("totalDays-error")).toBeInTheDocument();
    });
  });

  it("shows wallet-required message when no wallet connected", () => {
    renderNoWallet();
    expect(screen.getByText(/connect your wallet/i)).toBeInTheDocument();
  });

  it("shows deposit preview once all fields are valid", async () => {
    renderWithWallet();
    await fill(/recipient address/i, VALID_ADDRESS);
    await fill(/token contract/i, VALID_TOKEN);
    await fill(/rate \(tokens per ledger\)/i, "10");
    await fill(/cliff duration \(days\)/i, "30");
    await fill(/total duration \(days\)/i, "365");
    expect(screen.getByTestId("deposit-preview")).toBeInTheDocument();
  });

  it("shows success after valid submission", async () => {
    const onSuccess = vi.fn();
    renderWithWallet({ onSuccess });
    await fill(/recipient address/i, VALID_ADDRESS);
    await fill(/token contract/i, VALID_TOKEN);
    await fill(/rate \(tokens per ledger\)/i, "10");
    await fill(/cliff duration \(days\)/i, "30");
    await fill(/total duration \(days\)/i, "365");
    await userEvent.click(screen.getByTestId("stream-create-submit"));
    await waitFor(
      () => expect(screen.getByTestId("tx-success")).toBeInTheDocument(),
      { timeout: 5000 }
    );
    expect(onSuccess).toHaveBeenCalledOnce();
  });
});
