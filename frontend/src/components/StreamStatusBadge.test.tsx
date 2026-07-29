/**
 * StreamStatusBadge tests — Issue #378
 */
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { StreamStatusBadge, StreamStatusLegend, type StreamBadgeStatus } from "@/components/StreamStatusBadge";

const ALL_STATUSES: StreamBadgeStatus[] = ["pre-cliff", "active", "expired", "cancelled", "drained", "paused"];

describe("StreamStatusBadge", () => {
  // ── Rendering each status ──────────────────────────────────────────────────

  it.each(ALL_STATUSES)("renders badge for status: %s", (status) => {
    render(<StreamStatusBadge status={status} />);
    expect(screen.getByTestId(`stream-status-badge-${status}`)).toBeInTheDocument();
  });

  it.each(ALL_STATUSES)("displays correct label for status: %s", (status) => {
    render(<StreamStatusBadge status={status} />);
    const badge = screen.getByTestId(`stream-status-badge-${status}`);
    expect(badge.textContent).toBeTruthy();
  });

  // ── Accessibility ──────────────────────────────────────────────────────────

  it.each(ALL_STATUSES)("has role='status' for: %s", (status) => {
    render(<StreamStatusBadge status={status} />);
    const badge = screen.getByTestId(`stream-status-badge-${status}`);
    expect(badge).toHaveAttribute("role", "status");
  });

  it.each(ALL_STATUSES)("has aria-label containing status name for: %s", (status) => {
    render(<StreamStatusBadge status={status} />);
    const badge = screen.getByTestId(`stream-status-badge-${status}`);
    const ariaLabel = badge.getAttribute("aria-label");
    expect(ariaLabel).toBeTruthy();
    expect(ariaLabel!.toLowerCase()).toContain("stream status");
  });

  // ── Tooltip ────────────────────────────────────────────────────────────────

  it("shows tooltip on mouse enter", () => {
    render(<StreamStatusBadge status="active" />);
    const badge = screen.getByTestId("stream-status-badge-active");
    fireEvent.mouseEnter(badge.parentElement!);
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
  });

  it("hides tooltip on mouse leave", () => {
    render(<StreamStatusBadge status="active" />);
    const badge = screen.getByTestId("stream-status-badge-active");
    const wrapper = badge.parentElement!;
    fireEvent.mouseEnter(wrapper);
    fireEvent.mouseLeave(wrapper);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("does not render tooltip when showTooltip=false", () => {
    render(<StreamStatusBadge status="active" showTooltip={false} />);
    const badge = screen.getByTestId("stream-status-badge-active");
    fireEvent.mouseEnter(badge);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("tooltip contains descriptive text", () => {
    render(<StreamStatusBadge status="pre-cliff" />);
    const wrapper = screen.getByTestId("stream-status-badge-pre-cliff").parentElement!;
    fireEvent.mouseEnter(wrapper);
    const tooltip = screen.getByRole("tooltip");
    expect(tooltip.textContent).toBeTruthy();
    expect(tooltip.textContent!.length).toBeGreaterThan(10);
  });

  // ── Active state pulse ─────────────────────────────────────────────────────

  it("active status renders pulse ring element", () => {
    render(<StreamStatusBadge status="active" />);
    const badge = screen.getByTestId("stream-status-badge-active");
    const iconSpan = badge.querySelector('span[aria-hidden="true"]');
    expect(iconSpan).not.toBeNull();
  });

  it("paused status renders icon text, not a pulse ring", () => {
    render(<StreamStatusBadge status="paused" />);
    const badge = screen.getByTestId("stream-status-badge-paused");
    expect(badge.textContent).toContain("Paused");
  });

  it("non-active statuses render an icon span with aria-hidden", () => {
    const nonActive: StreamBadgeStatus[] = ["pre-cliff", "expired", "cancelled", "drained", "paused"];
    for (const status of nonActive) {
      const { unmount } = render(<StreamStatusBadge status={status} />);
      const badge = screen.getByTestId(`stream-status-badge-${status}`);
      const iconSpan = badge.querySelector('span[aria-hidden="true"]');
      expect(iconSpan).not.toBeNull();
      expect(iconSpan!.textContent!.trim().length).toBeGreaterThan(0);
      unmount();
    }
  });

  // ── Size variants ──────────────────────────────────────────────────────────

  it("size='sm' renders with small font size", () => {
    render(<StreamStatusBadge status="active" size="sm" />);
    const badge = screen.getByTestId("stream-status-badge-active");
    expect(badge.style.fontSize).toBe("0.7rem");
  });

  it("size='md' renders with medium font size (default)", () => {
    render(<StreamStatusBadge status="active" size="md" />);
    const badge = screen.getByTestId("stream-status-badge-active");
    expect(badge.style.fontSize).toBe("0.8rem");
  });

  it("size='lg' renders with large font size", () => {
    render(<StreamStatusBadge status="active" size="lg" />);
    const badge = screen.getByTestId("stream-status-badge-active");
    expect(badge.style.fontSize).toBe("0.95rem");
  });

  it("defaults to size='md' when no size prop is given", () => {
    render(<StreamStatusBadge status="cancelled" />);
    const badge = screen.getByTestId("stream-status-badge-cancelled");
    expect(badge.style.fontSize).toBe("0.8rem");
  });

  // ── Custom className ───────────────────────────────────────────────────────

  it("applies custom className to the badge element", () => {
    render(<StreamStatusBadge status="drained" className="my-custom-class" />);
    const badge = screen.getByTestId("stream-status-badge-drained");
    expect(badge.className).toContain("my-custom-class");
  });

  // ── Specific status labels ─────────────────────────────────────────────────

  it.each([
    ["pre-cliff", "Pre-Cliff"],
    ["active", "Active"],
    ["expired", "Expired"],
    ["cancelled", "Cancelled"],
    ["drained", "Drained"],
    ["paused", "Paused"],
  ] as [StreamBadgeStatus, string][])(
    "status '%s' shows label '%s'",
    (status, expectedLabel) => {
      render(<StreamStatusBadge status={status} showTooltip={false} />);
      expect(screen.getByTestId(`stream-status-badge-${status}`).textContent).toContain(expectedLabel);
    }
  );
});

// ── StreamStatusLegend ──────────────────────────────────────────────────────

describe("StreamStatusLegend", () => {
  it("renders all 6 status badges", () => {
    render(<StreamStatusLegend />);
    for (const status of ALL_STATUSES) {
      expect(screen.getByTestId(`stream-status-badge-${status}`)).toBeInTheDocument();
    }
  });

  it("has role='note' and aria-label", () => {
    render(<StreamStatusLegend />);
    const legend = screen.getByRole("note");
    expect(legend).toBeInTheDocument();
    expect(legend).toHaveAttribute("aria-label", "Stream status legend");
  });

  it("accepts size prop and passes it to badges", () => {
    render(<StreamStatusLegend size="lg" />);
    for (const status of ALL_STATUSES) {
      const badge = screen.getByTestId(`stream-status-badge-${status}`);
      expect(badge.style.fontSize).toBe("0.95rem");
    }
  });
});
