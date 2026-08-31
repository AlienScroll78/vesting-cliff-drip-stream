/**
 * Tests for TransactionHistoryPanel
 * @closes #272
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor, fireEvent, act } from "@testing-library/react";
import { TransactionHistoryPanel } from "@/components/TransactionHistoryPanel";

describe("TransactionHistoryPanel", () => {
  // ── Initial state ───────────────────────────────────────────────────────────

  it("renders loading skeleton initially", () => {
    render(<TransactionHistoryPanel />);
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.getAllByTestId("event-skeleton-row").length).toBeGreaterThan(0);
  });

  it("shows custom title when provided", () => {
    render(<TransactionHistoryPanel title="My Stream Events" />);
    expect(screen.getByText("My Stream Events")).toBeInTheDocument();
  });

  it("has a refresh button", () => {
    render(<TransactionHistoryPanel />);
    expect(screen.getByRole("button", { name: /refresh/i })).toBeInTheDocument();
  });

  it("section has aria-label", () => {
    render(<TransactionHistoryPanel title="Transaction History" />);
    expect(screen.getByRole("region", { name: "Transaction History" })).toBeInTheDocument();
  });

  it("renders filter group aria-label", () => {
    render(<TransactionHistoryPanel />);
    expect(screen.getByRole("group", { name: /filter events/i })).toBeInTheDocument();
  });

  it("renders all four filter buttons immediately", () => {
    render(<TransactionHistoryPanel />);
    expect(screen.getByRole("button", { name: /All Events/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Stream Created/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Tokens Claimed/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Stream Cancelled/i })).toBeInTheDocument();
  });

  // ── Loaded state ────────────────────────────────────────────────────────────

  it("renders events after loading", async () => {
    render(<TransactionHistoryPanel />);
    await waitFor(
      () => expect(screen.getAllByTestId("event-row").length).toBeGreaterThan(0),
      { timeout: 2000 }
    );
  });

  it("renders 20 events on first load", async () => {
    render(<TransactionHistoryPanel />);
    await waitFor(
      () => {
        const rows = screen.getAllByTestId("event-row");
        expect(rows.length).toBe(20);
      },
      { timeout: 2000 }
    );
  });

  it("shows Load more button when there are more events", async () => {
    render(<TransactionHistoryPanel />);
    await waitFor(
      () => expect(screen.getByTestId("load-more-btn")).toBeInTheDocument(),
      { timeout: 2000 }
    );
  });

  it("loads more events on Load more click", async () => {
    render(<TransactionHistoryPanel />);
    await waitFor(() => expect(screen.getAllByTestId("event-row").length).toBe(20), {
      timeout: 2000,
    });

    fireEvent.click(screen.getByTestId("load-more-btn"));

    await waitFor(() => expect(screen.getAllByTestId("event-row").length).toBe(40), {
      timeout: 2000,
    });
  });

  it("renders Stellar Expert links for each event", async () => {
    render(<TransactionHistoryPanel />);
    await waitFor(
      () => expect(screen.getAllByTestId("event-row").length).toBeGreaterThan(0),
      { timeout: 2000 }
    );

    const links = screen.getAllByRole("link");
    links.forEach((link) => {
      expect(link.getAttribute("href")).toContain("stellar.expert");
      expect(link.getAttribute("target")).toBe("_blank");
      expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    });
  });

  it("has aria-label on the event table", async () => {
    render(<TransactionHistoryPanel />);
    await waitFor(
      () => expect(screen.getAllByTestId("event-row").length).toBeGreaterThan(0),
      { timeout: 2000 }
    );
    expect(screen.getByRole("table", { name: /stream contract events/i })).toBeInTheDocument();
  });

  it("filters events when filter button is clicked", async () => {
    render(<TransactionHistoryPanel />);
    await waitFor(
      () => expect(screen.getAllByTestId("event-row").length).toBeGreaterThan(0),
      { timeout: 2000 }
    );

    fireEvent.click(screen.getByRole("button", { name: /Tokens Claimed/i }));

    // After clicking filter, skeleton should appear briefly then events
    await waitFor(
      () => expect(screen.getAllByTestId("event-row").length).toBeGreaterThan(0),
      { timeout: 2000 }
    );
  });

  it("resets to skeleton when filter changes", async () => {
    render(<TransactionHistoryPanel />);
    await waitFor(() => expect(screen.getAllByTestId("event-row").length).toBeGreaterThan(0), {
      timeout: 2000,
    });

    // Click a filter — a new load starts
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: /Stream Created/i }));
    });

    // Events eventually load again
    await waitFor(
      () => expect(screen.getAllByTestId("event-row").length).toBeGreaterThan(0),
      { timeout: 2000 }
    );
  });
});
