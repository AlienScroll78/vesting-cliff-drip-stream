/**
 * Tests for HorizonStatusBanner (#278)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HorizonStatusBanner } from "./HorizonStatusBanner";

// ── Mock fetch ────────────────────────────────────────────────────────────────

function mockFetch(latencyMs: number, ok = true) {
  vi.spyOn(globalThis, "fetch").mockImplementation(() =>
    new Promise((resolve, reject) => {
      setTimeout(() => {
        if (!ok) {
          reject(new Error("Network error"));
        } else {
          resolve(new Response("{}", { status: 200 }));
        }
      }, latencyMs);
    })
  );
}

// ── Fake timers ───────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.spyOn(performance, "now").mockReturnValue(0);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("HorizonStatusBanner (#278)", () => {
  it("renders nothing when Horizon responds quickly", async () => {
    // Fast response — under 3 s threshold
    vi.spyOn(performance, "now")
      .mockReturnValueOnce(0)     // start
      .mockReturnValueOnce(200);  // end
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));

    const { container } = render(<HorizonStatusBanner />);
    await act(async () => { await vi.runAllTimersAsync(); });

    expect(container.firstChild).toBeNull();
  });

  it("shows Degraded banner when response is slow (>3 s)", async () => {
    vi.spyOn(performance, "now")
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(3500); // 3 500 ms — above threshold
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));

    render(<HorizonStatusBanner />);
    await act(async () => { await vi.runAllTimersAsync(); });

    expect(screen.getByTestId("horizon-status-banner")).toBeInTheDocument();
    expect(screen.getByText(/Degraded/)).toBeInTheDocument();
  });

  it("shows Offline banner when fetch fails", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Network error"));

    render(<HorizonStatusBanner />);
    await act(async () => { await vi.runAllTimersAsync(); });

    expect(screen.getByTestId("horizon-status-banner")).toBeInTheDocument();
    expect(screen.getByText(/Offline/)).toBeInTheDocument();
  });

  it("has role='alert' for screen reader accessibility", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Network error"));

    render(<HorizonStatusBanner />);
    await act(async () => { await vi.runAllTimersAsync(); });

    const banner = screen.getByTestId("horizon-status-banner");
    expect(banner).toHaveAttribute("role", "alert");
  });

  it("contains a link to status.stellar.org", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Network error"));

    render(<HorizonStatusBanner />);
    await act(async () => { await vi.runAllTimersAsync(); });

    const link = screen.getByRole("link", { name: /Status page/i });
    expect(link).toHaveAttribute("href", "https://status.stellar.org");
  });

  it("dismiss button hides the banner (5-minute snooze)", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Network error"));

    render(<HorizonStatusBanner />);
    await act(async () => { await vi.runAllTimersAsync(); });

    expect(screen.getByTestId("horizon-status-banner")).toBeInTheDocument();

    const dismissBtn = screen.getByRole("button", { name: /Dismiss/i });
    await userEvent.click(dismissBtn);

    expect(screen.queryByTestId("horizon-status-banner")).not.toBeInTheDocument();
  });

  it("banner reappears after snooze expires", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Network error"));

    render(<HorizonStatusBanner />);
    await act(async () => { await vi.runAllTimersAsync(); });

    const dismissBtn = screen.getByRole("button", { name: /Dismiss/i });
    await userEvent.click(dismissBtn);
    expect(screen.queryByTestId("horizon-status-banner")).not.toBeInTheDocument();

    // Advance past the 5-minute snooze
    await act(async () => { vi.advanceTimersByTime(5 * 60_000 + 1); });

    // Next 30 s poll triggers
    await act(async () => { await vi.runAllTimersAsync(); });

    await waitFor(() =>
      expect(screen.getByTestId("horizon-status-banner")).toBeInTheDocument()
    );
  });
});
