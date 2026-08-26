/**
 * Tests for MobileBottomNav (#279)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MobileBottomNav } from "./MobileBottomNav";

// ── Mock next/navigation ──────────────────────────────────────────────────────

vi.mock("next/navigation", () => ({
  usePathname: vi.fn(() => "/"),
}));

import { usePathname } from "next/navigation";

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("MobileBottomNav (#279)", () => {
  beforeEach(() => {
    vi.mocked(usePathname).mockReturnValue("/");
  });

  it("renders the nav landmark", () => {
    render(<MobileBottomNav />);
    expect(screen.getByRole("navigation", { name: /Mobile navigation/i })).toBeInTheDocument();
  });

  it("renders all 4 tabs: Dashboard, Create, History, Settings", () => {
    render(<MobileBottomNav />);
    expect(screen.getByTestId("mobile-nav-dashboard")).toBeInTheDocument();
    expect(screen.getByTestId("mobile-nav-create")).toBeInTheDocument();
    expect(screen.getByTestId("mobile-nav-history")).toBeInTheDocument();
    expect(screen.getByTestId("mobile-nav-settings")).toBeInTheDocument();
  });

  it("marks the Dashboard tab as current when pathname is '/'", () => {
    vi.mocked(usePathname).mockReturnValue("/");
    render(<MobileBottomNav />);
    expect(screen.getByTestId("mobile-nav-dashboard")).toHaveAttribute("aria-current", "page");
  });

  it("marks the History tab as current when pathname starts with '/history'", () => {
    vi.mocked(usePathname).mockReturnValue("/history");
    render(<MobileBottomNav />);
    expect(screen.getByTestId("mobile-nav-history")).toHaveAttribute("aria-current", "page");
  });

  it("calls onCreateStream when Create tab is clicked", async () => {
    const onCreateStream = vi.fn();
    render(<MobileBottomNav onCreateStream={onCreateStream} />);
    await userEvent.click(screen.getByTestId("mobile-nav-create"));
    expect(onCreateStream).toHaveBeenCalledOnce();
  });

  it("calls onSettings when Settings tab is clicked", async () => {
    const onSettings = vi.fn();
    render(<MobileBottomNav onSettings={onSettings} />);
    await userEvent.click(screen.getByTestId("mobile-nav-settings"));
    expect(onSettings).toHaveBeenCalledOnce();
  });

  it("Dashboard and History tabs are anchor elements with correct hrefs", () => {
    render(<MobileBottomNav />);
    const dashboard = screen.getByTestId("mobile-nav-dashboard");
    const history = screen.getByTestId("mobile-nav-history");
    expect(dashboard.tagName).toBe("A");
    expect(history.tagName).toBe("A");
    expect(dashboard).toHaveAttribute("href", "/");
    expect(history).toHaveAttribute("href", "/history");
  });

  it("each tab has an accessible aria-label", () => {
    render(<MobileBottomNav />);
    expect(screen.getByLabelText(/Dashboard/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Create new stream/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/History/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Open settings/i)).toBeInTheDocument();
  });
});
