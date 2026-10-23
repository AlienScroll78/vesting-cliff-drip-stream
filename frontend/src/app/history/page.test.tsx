/**
 * Tests for the /history transaction history page (#537)
 *
 * Verifies the required columns, shareable URL filter state, pagination,
 * Stellar Expert links and the loading / error / empty states.
 *
 * The app uses the repo's own LazyRouter (no react-router / next), so filter
 * and page state is pushed to the URL via history.pushState and read back from
 * window.location.search.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import TransactionHistoryPage from "@/app/history/page";
import type { HistoryEvent, UseStreamEventsResult } from "@/hooks/useStreamEvents";

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("@/contexts/WalletContext", () => ({
  useWallet: vi.fn(),
}));

vi.mock("@/hooks/useStreamEvents", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/hooks/useStreamEvents")>();
  return { ...actual, useStreamEvents: vi.fn() };
});

import { useWallet } from "@/contexts/WalletContext";
import { useStreamEvents } from "@/hooks/useStreamEvents";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const RECIPIENT = "GRECIPIENTXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX";

let pushStateSpy: ReturnType<typeof vi.spyOn>;

const events: HistoryEvent[] = [
  {
    id: "evt-1",
    type: "claimed",
    timestamp: "2026-01-02T10:30:00.000Z",
    amount: 1500,
    token: "USDC",
    status: "confirmed",
    txHash: "aaaa1111bbbb2222cccc3333dddd4444eeee5555ffff66660000000000000001",
  },
  {
    id: "evt-2",
    type: "clawed_back",
    timestamp: "2026-01-01T09:00:00.000Z",
    amount: 0,
    token: "USDC",
    status: "pending",
    txHash: "bbbb2222cccc3333dddd4444eeee5555ffff66660000000000000000aaaa1111",
  },
];

function makeHook(
  overrides: Partial<UseStreamEventsResult> = {}
): UseStreamEventsResult {
  return {
    events,
    total: 40,
    page: 1,
    pageSize: 20,
    loading: false,
    error: null,
    refresh: vi.fn(),
    ...overrides,
  };
}

function setUrl(path: string) {
  window.history.replaceState(null, "", path);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("TransactionHistoryPage (#537)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setUrl("/history");
    pushStateSpy = vi.spyOn(window.history, "pushState");
    vi.mocked(useWallet).mockReturnValue({
      address: RECIPIENT,
      network: "testnet",
    } as unknown as ReturnType<typeof useWallet>);
    vi.mocked(useStreamEvents).mockReturnValue(makeHook());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    setUrl("/");
  });

  it("asks the user to connect a wallet when disconnected", () => {
    vi.mocked(useWallet).mockReturnValue({
      address: null,
      network: "testnet",
    } as unknown as ReturnType<typeof useWallet>);

    render(<TransactionHistoryPage />);
    expect(screen.getByRole("alert")).toHaveTextContent(/connect your wallet/i);
    expect(screen.queryByTestId("history-table")).not.toBeInTheDocument();
  });

  it("renders the required columns: Date, Type, Amount, Status, Tx Hash", () => {
    render(<TransactionHistoryPage />);
    ["Date", "Type", "Amount", "Status", "Tx Hash"].forEach((label) => {
      expect(screen.getByRole("columnheader", { name: label })).toBeInTheDocument();
    });
  });

  it("renders one row per event with type, amount and status", () => {
    render(<TransactionHistoryPage />);
    expect(screen.getAllByRole("row")).toHaveLength(events.length + 1);
    const table = within(screen.getByTestId("history-table"));
    expect(table.getByText("Claimed")).toBeInTheDocument();
    expect(table.getByText("Clawed Back")).toBeInTheDocument();
    expect(table.getByText(/1,500/)).toBeInTheDocument();
    expect(screen.getAllByTestId("history-event-status")[0]).toHaveTextContent(
      "Confirmed"
    );
  });

  it("links tx hashes to Stellar Expert in a new tab", () => {
    render(<TransactionHistoryPage />);
    const link = screen.getByRole("link", {
      name: /view transaction aaaa1111 on stellar expert/i,
    });
    expect(link).toHaveAttribute(
      "href",
      `https://stellar.expert/explorer/testnet/tx/${events[0]!.txHash}`
    );
    expect(link).toHaveAttribute("target", "_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
  });

  it("reads filter and page from the URL (shareable links)", () => {
    setUrl("/history?type=clawed_back&page=3");
    vi.mocked(useStreamEvents).mockReturnValue(makeHook({ page: 3 }));

    render(<TransactionHistoryPage />);
    expect(vi.mocked(useStreamEvents)).toHaveBeenCalledWith(RECIPIENT, {
      filter: "clawed_back",
      page: 3,
    });
  });

  it("syncs state when the browser navigates back/forward", () => {
    const { rerender } = render(<TransactionHistoryPage />);
    expect(vi.mocked(useStreamEvents)).toHaveBeenCalledWith(RECIPIENT, {
      filter: "all",
      page: 1,
    });

    act(() => {
      setUrl("/history?type=claimed&page=2");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    rerender(<TransactionHistoryPage />);

    expect(vi.mocked(useStreamEvents)).toHaveBeenLastCalledWith(RECIPIENT, {
      filter: "claimed",
      page: 2,
    });
  });

  it("pushes ?type= when a filter button is clicked (page resets to 1)", async () => {
    setUrl("/history?type=created&page=4");
    vi.mocked(useStreamEvents).mockReturnValue(makeHook({ page: 4 }));
    const user = userEvent.setup();

    render(<TransactionHistoryPage />);
    await user.click(screen.getByTestId("history-filter-cancelled"));

    expect(pushStateSpy).toHaveBeenCalledWith(
      null,
      "",
      "/history?type=cancelled"
    );
    expect(screen.getByTestId("history-filter-cancelled")).toHaveAttribute(
      "aria-pressed",
      "true"
    );
  });

  it("clears the filter back to /history", async () => {
    setUrl("/history?type=claimed");
    vi.mocked(useStreamEvents).mockReturnValue(makeHook({ events: [], total: 0 }));
    const user = userEvent.setup();

    render(<TransactionHistoryPage />);
    await user.click(screen.getByTestId("history-clear-filter"));
    expect(pushStateSpy).toHaveBeenCalledWith(null, "", "/history");
  });

  it("shows a filtered empty state when no events match", () => {
    setUrl("/history?type=cancelled");
    vi.mocked(useStreamEvents).mockReturnValue(makeHook({ events: [], total: 0 }));

    render(<TransactionHistoryPage />);
    expect(screen.getByTestId("history-empty")).toHaveTextContent(
      /no matching events/i
    );
  });

  it("shows the illustrated empty state when there are no events at all", () => {
    vi.mocked(useStreamEvents).mockReturnValue(makeHook({ events: [], total: 0 }));

    render(<TransactionHistoryPage />);
    expect(screen.getByTestId("history-empty")).toHaveTextContent(
      /no transactions yet/i
    );
  });

  it("paginates with 20 rows per page and links to the next page in the URL", async () => {
    const user = userEvent.setup();
    render(<TransactionHistoryPage />);

    expect(screen.getByRole("navigation", { name: "Pagination" })).toHaveTextContent(
      /Page 1 of 2/
    );
    expect(screen.getByRole("button", { name: "Previous page" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Next page" }));
    expect(pushStateSpy).toHaveBeenCalledWith(null, "", "/history?page=2");
  });

  it("disables the next button on the last page", () => {
    setUrl("/history?page=2");
    vi.mocked(useStreamEvents).mockReturnValue(makeHook({ page: 2, total: 40 }));

    render(<TransactionHistoryPage />);
    expect(screen.getByRole("button", { name: "Next page" })).toBeDisabled();
  });

  it("renders the loading state", () => {
    vi.mocked(useStreamEvents).mockReturnValue(
      makeHook({ loading: true, events: [] })
    );

    render(<TransactionHistoryPage />);
    expect(screen.getByTestId("history-skeleton")).toBeInTheDocument();
    expect(screen.queryByTestId("history-table")).not.toBeInTheDocument();
  });

  it("renders the error state and retries on demand", async () => {
    const refresh = vi.fn();
    vi.mocked(useStreamEvents).mockReturnValue(
      makeHook({ events: [], error: "Request failed with status 500", refresh })
    );
    const user = userEvent.setup();

    render(<TransactionHistoryPage />);
    expect(screen.getByTestId("history-error")).toHaveTextContent(
      /failed to load transaction history/i
    );

    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
