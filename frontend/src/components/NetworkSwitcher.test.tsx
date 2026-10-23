import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import {
  NetworkProvider,
  NetworkSwitcher,
  NetworkBadge,
  getNetworkConfig,
  useNetwork,
  type Network,
} from "@/components/NetworkSwitcher";

// ── Helpers ───────────────────────────────────────────────────────────────────

function Wrapper({
  initialNetwork = "testnet",
  onDisconnect,
  children,
}: {
  initialNetwork?: Network;
  onDisconnect?: () => void;
  children: React.ReactNode;
}) {
  return (
    <NetworkProvider onDisconnectWallet={onDisconnect}>
      {children}
    </NetworkProvider>
  );
}

// A tiny component that exposes context values for inspection
function Inspector() {
  const { network, networkConfig } = useNetwork();
  return (
    <>
      <span data-testid="ctx-network">{network}</span>
      <span data-testid="ctx-rpc">{networkConfig.rpcUrl}</span>
      <span data-testid="ctx-horizon">{networkConfig.horizonUrl}</span>
    </>
  );
}

// ── getNetworkConfig ──────────────────────────────────────────────────────────

describe("getNetworkConfig", () => {
  it("returns testnet defaults when no env vars are set", () => {
    const cfg = getNetworkConfig("testnet");
    expect(cfg.rpcUrl).toContain("testnet");
    expect(cfg.horizonUrl).toContain("testnet");
    expect(cfg.networkPassphrase).toContain("Test SDF");
  });

  it("returns mainnet defaults when no env vars are set", () => {
    const cfg = getNetworkConfig("mainnet");
    expect(cfg.rpcUrl).not.toContain("testnet");
    expect(cfg.horizonUrl).not.toContain("testnet");
    expect(cfg.networkPassphrase).toContain("Public Global");
  });
});

// ── NetworkProvider + localStorage persistence ────────────────────────────────

describe("NetworkProvider", () => {
  beforeEach(() => {
    localStorage.clear();
  });
  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("defaults to testnet when localStorage has no preference", () => {
    render(
      <Wrapper>
        <Inspector />
      </Wrapper>
    );
    expect(screen.getByTestId("ctx-network")).toHaveTextContent("testnet");
  });

  it("restores the persisted network on mount", () => {
    localStorage.setItem("stellar_network_preference", "mainnet");
    render(
      <Wrapper>
        <Inspector />
      </Wrapper>
    );
    expect(screen.getByTestId("ctx-network")).toHaveTextContent("mainnet");
  });

  it("persists the new network in localStorage when switching", async () => {
    render(
      <Wrapper>
        <Inspector />
        <NetworkSwitcher />
      </Wrapper>
    );

    // Open the modal (switching to mainnet)
    fireEvent.change(screen.getByTestId("network-select"), {
      target: { value: "mainnet" },
    });
    // Confirm the modal
    await act(async () => {
      fireEvent.click(screen.getByTestId("mainnet-modal-confirm"));
    });

    expect(localStorage.getItem("stellar_network_preference")).toBe("mainnet");
    expect(screen.getByTestId("ctx-network")).toHaveTextContent("mainnet");
  });

  it("calls onDisconnectWallet when switching networks", async () => {
    const onDisconnect = vi.fn();
    render(
      <Wrapper onDisconnect={onDisconnect}>
        <NetworkSwitcher />
      </Wrapper>
    );

    fireEvent.change(screen.getByTestId("network-select"), {
      target: { value: "mainnet" },
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("mainnet-modal-confirm"));
    });

    expect(onDisconnect).toHaveBeenCalledOnce();
  });

  it("clears network-specific localStorage keys when switching", async () => {
    localStorage.setItem("vesting_wallet_address", "GABC123");
    localStorage.setItem("vesting_wallet_provider", "freighter");

    render(
      <Wrapper>
        <NetworkSwitcher />
      </Wrapper>
    );

    fireEvent.change(screen.getByTestId("network-select"), {
      target: { value: "mainnet" },
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("mainnet-modal-confirm"));
    });

    expect(localStorage.getItem("vesting_wallet_address")).toBeNull();
    expect(localStorage.getItem("vesting_wallet_provider")).toBeNull();
  });
});

// ── NetworkBadge ──────────────────────────────────────────────────────────────

describe("NetworkBadge", () => {
  beforeEach(() => { localStorage.clear(); });
  afterEach(() => { localStorage.clear(); });

  it("renders a yellow TESTNET banner on testnet", () => {
    render(
      <Wrapper>
        <NetworkBadge />
      </Wrapper>
    );
    const badge = screen.getByTestId("network-badge");
    expect(badge).toHaveAttribute("data-network", "testnet");
    expect(badge).toHaveTextContent("TESTNET");
    expect(badge.getAttribute("role")).toBe("status");
  });

  it("renders a red MAINNET banner on mainnet", () => {
    localStorage.setItem("stellar_network_preference", "mainnet");
    render(
      <Wrapper>
        <NetworkBadge />
      </Wrapper>
    );
    const badge = screen.getByTestId("network-badge");
    expect(badge).toHaveAttribute("data-network", "mainnet");
    expect(badge).toHaveTextContent(/MAINNET/i);
    expect(badge.getAttribute("role")).toBe("alert");
    expect(badge).toHaveAttribute("aria-live", "assertive");
  });

  it("updates the badge when the network switches", async () => {
    render(
      <Wrapper>
        <NetworkBadge />
        <NetworkSwitcher />
      </Wrapper>
    );

    expect(screen.getByTestId("network-badge")).toHaveAttribute("data-network", "testnet");

    fireEvent.change(screen.getByTestId("network-select"), {
      target: { value: "mainnet" },
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("mainnet-modal-confirm"));
    });

    expect(screen.getByTestId("network-badge")).toHaveAttribute("data-network", "mainnet");
  });
});

// ── NetworkSwitcher ───────────────────────────────────────────────────────────

describe("NetworkSwitcher", () => {
  beforeEach(() => { localStorage.clear(); });
  afterEach(() => { localStorage.clear(); vi.restoreAllMocks(); });

  it("renders the select with testnet selected by default", () => {
    render(
      <Wrapper>
        <NetworkSwitcher />
      </Wrapper>
    );
    const select = screen.getByTestId("network-select") as HTMLSelectElement;
    expect(select.value).toBe("testnet");
  });

  it("opens the mainnet warning modal when the user selects mainnet", () => {
    render(
      <Wrapper>
        <NetworkSwitcher />
      </Wrapper>
    );
    fireEvent.change(screen.getByTestId("network-select"), {
      target: { value: "mainnet" },
    });
    expect(screen.getByTestId("mainnet-warning-modal")).toBeInTheDocument();
    expect(screen.getByTestId("mainnet-warning-modal")).toHaveTextContent(
      /you are switching to mainnet/i
    );
  });

  it("does NOT open a modal when switching back to testnet", async () => {
    localStorage.setItem("stellar_network_preference", "mainnet");
    render(
      <Wrapper>
        <NetworkSwitcher />
      </Wrapper>
    );
    fireEvent.change(screen.getByTestId("network-select"), {
      target: { value: "testnet" },
    });
    expect(screen.queryByTestId("mainnet-warning-modal")).not.toBeInTheDocument();
  });

  it("cancelling the modal keeps the current network", async () => {
    render(
      <Wrapper>
        <Inspector />
        <NetworkSwitcher />
      </Wrapper>
    );

    fireEvent.change(screen.getByTestId("network-select"), {
      target: { value: "mainnet" },
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("mainnet-modal-cancel"));
    });

    expect(screen.queryByTestId("mainnet-warning-modal")).not.toBeInTheDocument();
    expect(screen.getByTestId("ctx-network")).toHaveTextContent("testnet");
  });

  it("pressing Escape closes the modal without switching", async () => {
    render(
      <Wrapper>
        <Inspector />
        <NetworkSwitcher />
      </Wrapper>
    );

    fireEvent.change(screen.getByTestId("network-select"), {
      target: { value: "mainnet" },
    });
    expect(screen.getByTestId("mainnet-warning-modal")).toBeInTheDocument();

    await act(async () => {
      fireEvent.keyDown(document, { key: "Escape" });
    });

    expect(screen.queryByTestId("mainnet-warning-modal")).not.toBeInTheDocument();
    expect(screen.getByTestId("ctx-network")).toHaveTextContent("testnet");
  });

  it("confirming the modal switches the network to mainnet", async () => {
    render(
      <Wrapper>
        <Inspector />
        <NetworkSwitcher />
      </Wrapper>
    );

    fireEvent.change(screen.getByTestId("network-select"), {
      target: { value: "mainnet" },
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("mainnet-modal-confirm"));
    });

    expect(screen.queryByTestId("mainnet-warning-modal")).not.toBeInTheDocument();
    expect(screen.getByTestId("ctx-network")).toHaveTextContent("mainnet");
  });

  // ── Network config after switch ──────────────────────────────────────────

  it("provides the mainnet RPC URL in context after switching to mainnet", async () => {
    render(
      <Wrapper>
        <Inspector />
        <NetworkSwitcher />
      </Wrapper>
    );

    fireEvent.change(screen.getByTestId("network-select"), {
      target: { value: "mainnet" },
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("mainnet-modal-confirm"));
    });

    // After switch the RPC and Horizon URLs should NOT contain "testnet"
    expect(screen.getByTestId("ctx-rpc").textContent).not.toContain("testnet");
    expect(screen.getByTestId("ctx-horizon").textContent).not.toContain("testnet");
  });

  it("provides the testnet RPC URL after switching back to testnet", async () => {
    localStorage.setItem("stellar_network_preference", "mainnet");
    render(
      <Wrapper>
        <Inspector />
        <NetworkSwitcher />
      </Wrapper>
    );

    expect(screen.getByTestId("ctx-network")).toHaveTextContent("mainnet");

    fireEvent.change(screen.getByTestId("network-select"), {
      target: { value: "testnet" },
    });

    expect(screen.getByTestId("ctx-network")).toHaveTextContent("testnet");
    expect(screen.getByTestId("ctx-rpc").textContent).toContain("testnet");
  });

  // ── Accessibility ────────────────────────────────────────────────────────

  it("modal has the correct ARIA attributes", () => {
    render(
      <Wrapper>
        <NetworkSwitcher />
      </Wrapper>
    );

    fireEvent.change(screen.getByTestId("network-select"), {
      target: { value: "mainnet" },
    });

    const modal = screen.getByRole("dialog");
    expect(modal).toHaveAttribute("aria-modal", "true");
    expect(modal).toHaveAttribute("aria-labelledby", "mainnet-modal-title");
    expect(modal).toHaveAttribute("aria-describedby", "mainnet-modal-desc");
  });

  it("the label has an aria-label for the select", () => {
    render(
      <Wrapper>
        <NetworkSwitcher />
      </Wrapper>
    );
    expect(screen.getByLabelText("Select network")).toBeInTheDocument();
  });
});
