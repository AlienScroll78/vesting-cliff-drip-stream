import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WalletButton } from "@/components/WalletButton";
import { WalletContext } from "@/contexts/WalletContext";
import React from "react";

const VALID_ADDRESS = "GJLJ23WVK4UWYA4RGQTOUFXNZUBTTJMIRQPASCDZ4G4HM53NOT5W2OZX";

function renderWallet(context: Partial<React.ComponentProps<typeof WalletContext.Provider>["value"]>) {
  return render(
    <WalletContext.Provider
      value={{
        address: null,
        freighterInstalled: null,
        balances: [],
        balancesLoading: false,
        connect: vi.fn(),
        disconnect: vi.fn(),
        ...context,
      }}
    >
      <WalletButton />
    </WalletContext.Provider>
  );
}

describe("WalletButton", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("shows Connect Wallet button when disconnected", () => {
    renderWallet({ address: null, freighterInstalled: true });
    expect(screen.getByTestId("connect-wallet")).toBeInTheDocument();
    expect(screen.getByText("Connect Wallet")).toBeInTheDocument();
  });

  it("shows Install Freighter link when not installed", () => {
    renderWallet({ address: null, freighterInstalled: false });
    expect(screen.getByText("Install Freighter")).toBeInTheDocument();
    expect(screen.getByLabelText(/install freighter/i)).toBeInTheDocument();
  });

  it("shows freighter requirement text when not installed", () => {
    renderWallet({ address: null, freighterInstalled: false });
    expect(screen.getByText(/freighter extension required/i)).toBeInTheDocument();
  });

  it("shows truncated address when connected", () => {
    renderWallet({ address: VALID_ADDRESS, freighterInstalled: true });
    const truncated = `${VALID_ADDRESS.slice(0, 6)}…${VALID_ADDRESS.slice(-4)}`;
    expect(screen.getByText(truncated)).toBeInTheDocument();
  });

  it("shows disconnect button when connected", () => {
    renderWallet({ address: VALID_ADDRESS, freighterInstalled: true });
    expect(screen.getByTestId("disconnect-wallet")).toBeInTheDocument();
  });

  it("calls connect when Connect Wallet is clicked", async () => {
    const connect = vi.fn().mockResolvedValue(undefined);
    renderWallet({ address: null, freighterInstalled: true, connect });
    await userEvent.click(screen.getByTestId("connect-wallet"));
    expect(connect).toHaveBeenCalledOnce();
  });

  it("calls disconnect when Disconnect is clicked", async () => {
    const disconnect = vi.fn();
    renderWallet({ address: VALID_ADDRESS, freighterInstalled: true, disconnect });
    await userEvent.click(screen.getByTestId("disconnect-wallet"));
    expect(disconnect).toHaveBeenCalledOnce();
  });

  it("shows loading state while connecting", async () => {
    let resolve: () => void;
    const connect = vi.fn().mockImplementation(
      () => new Promise<void>((r) => { resolve = r; })
    );
    renderWallet({ address: null, freighterInstalled: true, connect });
    await userEvent.click(screen.getByTestId("connect-wallet"));
    expect(screen.getByText("Connecting…")).toBeInTheDocument();
    resolve!();
  });

  it("disables connect button while loading", async () => {
    let resolve: () => void;
    const connect = vi.fn().mockImplementation(
      () => new Promise<void>((r) => { resolve = r; })
    );
    renderWallet({ address: null, freighterInstalled: true, connect });
    await userEvent.click(screen.getByTestId("connect-wallet"));
    expect(screen.getByTestId("connect-wallet")).toBeDisabled();
    resolve!();
  });

  it("shows error message on connect failure", async () => {
    const connect = vi.fn().mockRejectedValue(new Error("User rejected"));
    renderWallet({ address: null, freighterInstalled: true, connect });
    await userEvent.click(screen.getByTestId("connect-wallet"));
    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(/user rejected/i);
    });
  });

  it("has CopyButton when connected", () => {
    renderWallet({ address: VALID_ADDRESS, freighterInstalled: true });
    expect(screen.getByLabelText(/copy wallet address/i)).toBeInTheDocument();
  });

  it("has aria-busy attribute while connecting", async () => {
    let resolve: () => void;
    const connect = vi.fn().mockImplementation(
      () => new Promise<void>((r) => { resolve = r; })
    );
    renderWallet({ address: null, freighterInstalled: true, connect });
    await userEvent.click(screen.getByTestId("connect-wallet"));
    expect(screen.getByTestId("connect-wallet")).toHaveAttribute("aria-busy", "true");
    resolve!();
  });
});
