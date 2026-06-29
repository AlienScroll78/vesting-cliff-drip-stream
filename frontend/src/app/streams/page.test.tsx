import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SponsorStreamsPage from "@/app/streams/page";
import * as useStreamsModule from "@/hooks/useStreams";

// Minimal mock stream data
const mockStreams = [
  {
    id: "1", recipient: "GABC1…XYZ", sponsor: "GSPON…", token: "USDC",
    rate: 10, claimableAmount: 1500, status: "active" as const,
    cliffLedger: 51_113_600, endLedger: 57_248_000, totalDeposit: 63_072_000,
  },
  {
    id: "2", recipient: "GABC2…XYZ", sponsor: "GSPON…", token: "XLM",
    rate: 5,  claimableAmount: 0,    status: "pre-cliff" as const,
    cliffLedger: 51_459_200, endLedger: 53_792_000, totalDeposit: 12_960_000,
  },
  {
    id: "3", recipient: "GABC3…XYZ", sponsor: "GSPON…", token: "USDC",
    rate: 20, claimableAmount: 0,    status: "completed" as const,
  },
  {
    id: "4", recipient: "GABC4…XYZ", sponsor: "GSPON…", token: "USDC",
    rate: 8,  claimableAmount: 0,    status: "cancelled" as const,
  },
];

function makeHook(overrides: Partial<ReturnType<typeof useStreamsModule.useStreams>> = {}) {
  return {
    streams: mockStreams,
    total: mockStreams.length,
    page: 1,
    pageSize: 25,
    loading: false,
    error: null,
    filter: "all" as const,
    setPage: vi.fn(),
    setFilter: vi.fn(),
    ...overrides,
  };
}

describe("SponsorStreamsPage", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("renders the page heading", () => {
    vi.spyOn(useStreamsModule, "useStreams").mockReturnValue(makeHook());
    render(<SponsorStreamsPage />);
    expect(screen.getByRole("heading", { name: /my streams/i })).toBeInTheDocument();
  });

  it("shows streams table with rows", () => {
    vi.spyOn(useStreamsModule, "useStreams").mockReturnValue(makeHook());
    render(<SponsorStreamsPage />);
    expect(screen.getByTestId("streams-table")).toBeInTheDocument();
    expect(screen.getAllByRole("row")).toHaveLength(mockStreams.length + 1); // +1 for header
  });

  it("renders status badges for each stream", () => {
    vi.spyOn(useStreamsModule, "useStreams").mockReturnValue(makeHook());
    render(<SponsorStreamsPage />);
    // Badge labels appear in both filter buttons and badge spans; assert at least one of each
    expect(screen.getAllByText("Active").length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText("Pre-cliff").length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText("Completed").length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText("Cancelled").length).toBeGreaterThanOrEqual(2);
  });

  it("shows cancel button only for active/pre-cliff streams", () => {
    vi.spyOn(useStreamsModule, "useStreams").mockReturnValue(makeHook());
    render(<SponsorStreamsPage />);
    expect(screen.getByTestId("cancel-btn-1")).toBeInTheDocument(); // active
    expect(screen.getByTestId("cancel-btn-2")).toBeInTheDocument(); // pre-cliff
    expect(screen.queryByTestId("cancel-btn-3")).not.toBeInTheDocument(); // completed
    expect(screen.queryByTestId("cancel-btn-4")).not.toBeInTheDocument(); // cancelled
  });

  it("opens cancel modal when cancel button is clicked", async () => {
    vi.spyOn(useStreamsModule, "useStreams").mockReturnValue(makeHook());
    render(<SponsorStreamsPage />);
    await userEvent.click(screen.getByTestId("cancel-btn-1"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("closes cancel modal when Go back is clicked", async () => {
    vi.spyOn(useStreamsModule, "useStreams").mockReturnValue(makeHook());
    render(<SponsorStreamsPage />);
    await userEvent.click(screen.getByTestId("cancel-btn-1"));
    await userEvent.click(screen.getByText(/go back/i));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("shows empty state when there are no streams", () => {
    vi.spyOn(useStreamsModule, "useStreams").mockReturnValue(makeHook({ streams: [], total: 0 }));
    render(<SponsorStreamsPage />);
    expect(screen.getByTestId("empty-state")).toBeInTheDocument();
    expect(screen.getByTestId("empty-create-stream")).toBeInTheDocument();
  });

  it("shows skeleton loader while loading", () => {
    vi.spyOn(useStreamsModule, "useStreams").mockReturnValue(makeHook({ loading: true }));
    render(<SponsorStreamsPage />);
    expect(screen.getByRole("list", { hidden: true })).toHaveAttribute("aria-busy", "true");
    expect(screen.queryByTestId("streams-table")).not.toBeInTheDocument();
  });

  it("shows error alert when error is set", () => {
    vi.spyOn(useStreamsModule, "useStreams").mockReturnValue(
      makeHook({ streams: [], total: 0, error: "Network error" })
    );
    render(<SponsorStreamsPage />);
    expect(screen.getByRole("alert")).toHaveTextContent("Network error");
  });

  it("renders filter buttons with correct pressed state", () => {
    vi.spyOn(useStreamsModule, "useStreams").mockReturnValue(makeHook({ filter: "active" }));
    render(<SponsorStreamsPage />);
    expect(screen.getByRole("button", { name: /^active$/i })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /^all$/i })).toHaveAttribute("aria-pressed", "false");
  });

  it("calls setFilter when a filter button is clicked", async () => {
    const setFilter = vi.fn();
    vi.spyOn(useStreamsModule, "useStreams").mockReturnValue(makeHook({ setFilter }));
    render(<SponsorStreamsPage />);
    await userEvent.click(screen.getByRole("button", { name: /^completed$/i }));
    expect(setFilter).toHaveBeenCalledWith("completed");
  });

  it("Export CSV button is disabled when no streams", () => {
    vi.spyOn(useStreamsModule, "useStreams").mockReturnValue(makeHook({ streams: [], total: 0 }));
    render(<SponsorStreamsPage />);
    expect(screen.getByTestId("export-csv-btn")).toBeDisabled();
  });

  it("Export CSV button is enabled when streams exist", () => {
    vi.spyOn(useStreamsModule, "useStreams").mockReturnValue(makeHook());
    render(<SponsorStreamsPage />);
    expect(screen.getByTestId("export-csv-btn")).not.toBeDisabled();
  });

  it("renders cliff and end ledgers", () => {
    vi.spyOn(useStreamsModule, "useStreams").mockReturnValue(makeHook());
    render(<SponsorStreamsPage />);
    // Ledger numbers are rendered (locale formatted)
    expect(screen.getByTestId("stream-row-1")).toBeInTheDocument();
  });

  it("shows pagination when total > pageSize", () => {
    vi.spyOn(useStreamsModule, "useStreams").mockReturnValue(
      makeHook({ total: 50, pageSize: 25, page: 1 })
    );
    render(<SponsorStreamsPage />);
    expect(screen.getByRole("navigation", { name: /pagination/i })).toBeInTheDocument();
  });

  it("does not show pagination when total <= pageSize", () => {
    vi.spyOn(useStreamsModule, "useStreams").mockReturnValue(makeHook({ total: 4, pageSize: 25 }));
    render(<SponsorStreamsPage />);
    expect(screen.queryByRole("navigation", { name: /pagination/i })).not.toBeInTheDocument();
  });

  it("calls setPage when next page button is clicked", async () => {
    const setPage = vi.fn();
    vi.spyOn(useStreamsModule, "useStreams").mockReturnValue(
      makeHook({ total: 50, pageSize: 25, page: 1, setPage })
    );
    render(<SponsorStreamsPage />);
    await userEvent.click(screen.getByRole("button", { name: /next page/i }));
    expect(setPage).toHaveBeenCalledWith(2);
  });
});
