/**
 * Tests for SVGVestingTimeline
 * @closes #271
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { SVGVestingTimeline } from "@/components/SVGVestingTimeline";

const validProps = {
  startLedger: 100,
  cliffLedger: 200,
  endLedger: 500,
  currentLedger: 150,
  tokenSymbol: "USDC",
};

describe("SVGVestingTimeline", () => {
  // ── Render ──────────────────────────────────────────────────────────────────

  it("renders SVG element", () => {
    const { container } = render(<SVGVestingTimeline {...validProps} />);
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
  });

  it("renders the timeline figure with correct test id", () => {
    render(<SVGVestingTimeline {...validProps} />);
    expect(screen.getByTestId("svg-vesting-timeline")).toBeInTheDocument();
  });

  it("renders the SVG with correct test id", () => {
    render(<SVGVestingTimeline {...validProps} />);
    expect(screen.getByTestId("svg-timeline-svg")).toBeInTheDocument();
  });

  // ── Invalid schedule ────────────────────────────────────────────────────────

  it("shows invalid message when total duration is zero", () => {
    render(
      <SVGVestingTimeline {...validProps} startLedger={500} endLedger={500} />
    );
    expect(screen.getByTestId("svg-timeline-invalid")).toBeInTheDocument();
    expect(screen.getByText(/invalid schedule/i)).toBeInTheDocument();
  });

  it("shows invalid message when cliff equals start", () => {
    render(
      <SVGVestingTimeline {...validProps} cliffLedger={100} />
    );
    expect(screen.getByTestId("svg-timeline-invalid")).toBeInTheDocument();
  });

  it("shows invalid message when cliff equals end", () => {
    render(
      <SVGVestingTimeline {...validProps} cliffLedger={500} />
    );
    expect(screen.getByTestId("svg-timeline-invalid")).toBeInTheDocument();
  });

  // ── Accessibility ───────────────────────────────────────────────────────────

  it("SVG has role=img", () => {
    render(<SVGVestingTimeline {...validProps} />);
    const svg = screen.getByRole("img");
    expect(svg).toBeInTheDocument();
  });

  it("SVG has aria-labelledby pointing to a title element", () => {
    const { container } = render(<SVGVestingTimeline {...validProps} />);
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    const labelledBy = svg!.getAttribute("aria-labelledby");
    expect(labelledBy).toBeTruthy();
    const titleEl = container.querySelector(`#${labelledBy}`);
    expect(titleEl).not.toBeNull();
    expect(titleEl!.textContent).toContain("Vesting Stream Timeline");
  });

  it("SVG has aria-describedby pointing to a desc element", () => {
    const { container } = render(<SVGVestingTimeline {...validProps} />);
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    const describedBy = svg!.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    const descEl = container.querySelector(`#${describedBy}`);
    expect(descEl).not.toBeNull();
    expect(descEl!.textContent).toContain("cliff");
  });

  it("figure has aria-label", () => {
    render(<SVGVestingTimeline {...validProps} />);
    const figure = screen.getByTestId("svg-vesting-timeline");
    expect(figure.getAttribute("aria-label")).toBe("SVG vesting timeline");
  });

  // ── Legend ──────────────────────────────────────────────────────────────────

  it("renders legend with Locked label", () => {
    render(<SVGVestingTimeline {...validProps} />);
    // "Locked" appears in both the SVG bar text and the legend — at least one should be present
    expect(screen.getAllByText("Locked").length).toBeGreaterThan(0);
  });

  it("renders legend with Claimable label including token symbol", () => {
    render(<SVGVestingTimeline {...validProps} tokenSymbol="XLM" />);
    expect(screen.getByText(/Claimable \(XLM\)/i)).toBeInTheDocument();
  });

  it("renders legend with Cliff and day count", () => {
    render(<SVGVestingTimeline {...validProps} />);
    expect(screen.getByText(/Cliff \(Day/i)).toBeInTheDocument();
  });

  it("renders current position in legend when currentLedger is provided", () => {
    render(<SVGVestingTimeline {...validProps} />);
    expect(screen.getByText(/Current position/i)).toBeInTheDocument();
  });

  it("does NOT render current position in legend when currentLedger is not provided", () => {
    render(<SVGVestingTimeline {...validProps} currentLedger={undefined} />);
    expect(screen.queryByText(/Current position/i)).toBeNull();
  });

  it("legend has aria-label", () => {
    render(<SVGVestingTimeline {...validProps} />);
    expect(screen.getByRole("list", { name: /timeline legend/i })).toBeInTheDocument();
  });

  // ── Current marker ──────────────────────────────────────────────────────────

  it("renders current ledger marker when currentLedger is provided", () => {
    render(<SVGVestingTimeline {...validProps} />);
    expect(screen.getByTestId("current-ledger-marker")).toBeInTheDocument();
  });

  it("does NOT render current marker when currentLedger is undefined", () => {
    render(<SVGVestingTimeline {...validProps} currentLedger={undefined} />);
    expect(screen.queryByTestId("current-ledger-marker")).toBeNull();
  });

  // ── Phases in SVG ───────────────────────────────────────────────────────────

  it("renders locked rect with aria-label", () => {
    const { container } = render(<SVGVestingTimeline {...validProps} />);
    const lockedRect = container.querySelector('rect[aria-label="Locked period"]');
    expect(lockedRect).not.toBeNull();
  });

  it("renders claimable rect with aria-label", () => {
    const { container } = render(<SVGVestingTimeline {...validProps} />);
    const dripRect = container.querySelector('rect[aria-label="Claimable (linear drip) region"]');
    expect(dripRect).not.toBeNull();
  });

  // ── Mobile / responsive ─────────────────────────────────────────────────────

  it("SVG has width 100% for responsive rendering", () => {
    const { container } = render(<SVGVestingTimeline {...validProps} />);
    const svg = container.querySelector("svg");
    expect(svg!.getAttribute("width")).toBe("100%");
  });

  it("renders correctly with large ledger ranges", () => {
    render(
      <SVGVestingTimeline
        startLedger={50_000_000}
        cliffLedger={50_172_800}
        endLedger={56_307_200}
        currentLedger={50_100_000}
      />
    );
    expect(screen.getByTestId("svg-vesting-timeline")).toBeInTheDocument();
  });
});
