import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { buildCreateStreamRequest, StreamCreateForm } from "@/components/StreamCreateForm";
import { WalletContext } from "@/contexts/WalletContext";

const VALID_ADDRESS = "GJLJ23WVK4UWYA4RGQTOUFXNZUBTTJMIRQPASCDZ4G4HM53NOT5W2OZX";
const SPONSOR_ADDRESS = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
const VALID_TOKEN = "CFU5BPFMUWIF6LXAQFCQ2RDS75QZL5ER2XXKHSIM2FBHTB4MFTKA5ITF";

function walletValue(address: string | null) {
  return {
    address,
    freighterInstalled: address !== null,
    balances: [],
    balancesLoading: false,
    provider: address === null ? null : "freighter" as const,
    network: "testnet" as const,
    modalOpen: false,
    openModal: vi.fn(),
    closeModal: vi.fn(),
    connect: vi.fn(),
    connectWithProvider: vi.fn(),
    disconnect: vi.fn(),
    switchNetwork: vi.fn(),
  };
}

function renderNoWallet() {
  return render(
    <WalletContext.Provider value={walletValue(null)}>
      <StreamCreateForm />
    </WalletContext.Provider>,
  );
}

function renderWithWallet(onSuccess?: (hash: string) => void) {
  return render(
    <WalletContext.Provider value={walletValue(SPONSOR_ADDRESS)}>
      <StreamCreateForm onSuccess={onSuccess} />
    </WalletContext.Provider>,
  );
}

async function fill(label: RegExp, value: string) {
  const input = screen.getByLabelText(label);
  await userEvent.clear(input);
  await userEvent.type(input, value);
  await userEvent.tab();
}

async function fillSimpleForm() {
  await fill(/recipient address/i, VALID_ADDRESS);
  await fill(/token contract/i, VALID_TOKEN);
  await fill(/total amount/i, "1000");
  await fill(/cliff duration/i, "30");
  await fill(/total duration/i, "365");
}

describe("StreamCreateForm", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("shows simple fields and keeps advanced fields collapsed", () => {
    renderWithWallet();
    expect(screen.getByLabelText(/recipient address/i)).toBeVisible();
    expect(screen.getByLabelText(/total amount/i)).toBeVisible();
    expect(screen.queryByLabelText(/custom rate/i)).not.toBeInTheDocument();
    expect(screen.getByTestId("advanced-options-toggle")).toHaveAttribute("aria-expanded", "false");
  });

  it("toggles advanced fields with accessible disclosure state", async () => {
    renderWithWallet();
    const toggle = screen.getByTestId("advanced-options-toggle");
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByLabelText(/custom rate/i)).toBeVisible();
    expect(screen.getByLabelText(/variable rate segments/i)).toBeVisible();
    expect(screen.getByLabelText(/metadata/i)).toBeVisible();
    expect(screen.getByLabelText(/allowlist override/i)).toBeVisible();
    await userEvent.click(toggle);
    expect(screen.queryByLabelText(/custom rate/i)).not.toBeInTheDocument();
  });

  it("persists the advanced disclosure state", async () => {
    const first = renderWithWallet();
    await userEvent.click(screen.getByTestId("advanced-options-toggle"));
    expect(localStorage.getItem("vesting:stream-create:advanced")).toBe("true");
    first.unmount();
    renderWithWallet();
    expect(screen.getByTestId("advanced-options-toggle")).toHaveAttribute("aria-expanded", "true");
  });

  it("derives the rate from amount and duration", async () => {
    renderWithWallet();
    await fillSimpleForm();
    const preview = screen.getByTestId("deposit-preview");
    expect(preview).toHaveTextContent(/derived rate/i);
    expect(preview).toHaveTextContent(/1,000 tokens/i);
  });

  it("uses a custom rate when advanced mode provides one", async () => {
    renderWithWallet();
    await fillSimpleForm();
    await userEvent.click(screen.getByTestId("advanced-options-toggle"));
    await fill(/custom rate/i, "20000000");
    expect(screen.getByTestId("deposit-preview")).toHaveTextContent(/2 tokens\/ledger/i);
  });

  it("shows advanced validation errors inline", async () => {
    renderWithWallet();
    await userEvent.click(screen.getByTestId("advanced-options-toggle"));
    await fill(/variable rate segments/i, "100, 1\n100, 2");
    expect(screen.getByTestId("variableRateSegments-error")).toHaveTextContent(/increase in order/i);
    await fill(/metadata/i, "é".repeat(129));
    expect(screen.getByTestId("metadata-error")).toHaveTextContent(/256 UTF-8 bytes/i);
  });

  it("builds the same normalized request for simple and advanced schedules", () => {
    const base = {
      recipient: VALID_ADDRESS,
      token: VALID_TOKEN,
      totalAmount: "1000",
      cliffDays: "30",
      totalDays: "365",
      rate: "",
      variableRateSegments: "",
      metadata: "",
      allowlistOverride: false,
      feeOverrideBps: "",
    };
    const simple = buildCreateStreamRequest(base, VALID_ADDRESS);
    const advanced = buildCreateStreamRequest({
      ...base,
      rate: "10000000",
      variableRateSegments: "1000, 20000000",
      metadata: "team",
      allowlistOverride: true,
      feeOverrideBps: "25",
    }, VALID_ADDRESS);
    expect(simple.rate).toBeGreaterThan(0);
    expect(advanced.rate).toBe(10_000_000);
    expect(advanced.variableRateSegments).toEqual([{ endLedger: 1000, rate: 20_000_000 }]);
    expect(advanced.metadata).toBe("team");
    expect(advanced.allowlistOverride).toBe(true);
    expect(advanced.feeOverrideBps).toBe(25);
  });

  it("shows wallet-required message when no wallet is connected", () => {
    renderNoWallet();
    expect(screen.getByText(/connect your wallet/i)).toBeInTheDocument();
  });

  it("shows all simple validation errors on submit", async () => {
    renderWithWallet();
    await userEvent.click(screen.getByTestId("stream-create-submit"));
    await waitFor(() => {
      expect(screen.getByTestId("recipient-error")).toBeInTheDocument();
      expect(screen.getByTestId("token-error")).toBeInTheDocument();
      expect(screen.getByTestId("totalAmount-error")).toBeInTheDocument();
      expect(screen.getByTestId("cliffDays-error")).toBeInTheDocument();
      expect(screen.getByTestId("totalDays-error")).toBeInTheDocument();
    });
  });

  it("creates a stream using the derived schedule", async () => {
    const onSuccess = vi.fn();
    renderWithWallet(onSuccess);
    await fillSimpleForm();
    await userEvent.click(screen.getByTestId("stream-create-submit"));
    await waitFor(() => expect(screen.getByTestId("tx-success")).toBeInTheDocument(), { timeout: 5000 });
    expect(onSuccess).toHaveBeenCalledOnce();
  });
});
