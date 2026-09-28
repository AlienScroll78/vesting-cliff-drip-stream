import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { VestingTimeline } from "@/components/VestingTimeline";

const validSchedule = {
  startLedger: 100,
  cliffLedger: 150,
  endLedger: 300,
  rate: 10,
  tokenSymbol: "USDC",
  currentLedger: 120,
};

describe("VestingTimeline", () => {
  it("renders chart with valid schedule", () => {
    render(<VestingTimeline schedule={validSchedule} />);
    expect(screen.getByTestId("vesting-timeline")).toBeInTheDocument();
  });

  it("shows invalid schedule message when rate is zero", () => {
    render(
      <VestingTimeline
        schedule={{ ...validSchedule, rate: 0 }}
      />
    );
    expect(screen.getByText(/invalid schedule/i)).toBeInTheDocument();
  });

  it("shows invalid schedule message when total duration is zero", () => {
    render(
      <VestingTimeline
        schedule={{ ...validSchedule, startLedger: 300, endLedger: 300 }}
      />
    );
    expect(screen.getByText(/invalid schedule/i)).toBeInTheDocument();
  });

  it("renders description when provided", () => {
    render(
      <VestingTimeline
        schedule={validSchedule}
        description="Vesting curve for contributor A"
      />
    );
    expect(screen.getByText("Vesting curve for contributor A")).toBeInTheDocument();
  });

  it("has accessible label on chart container", () => {
    render(<VestingTimeline schedule={validSchedule} />);
    const chart = screen.getByTestId("vesting-timeline");
    expect(chart).toHaveAttribute("aria-label");
    expect(chart.getAttribute("aria-label")).toContain("Vesting curve");
  });

  it("shows cliff day in legend", () => {
    render(<VestingTimeline schedule={validSchedule} />);
    expect(screen.getByText(/cliff/i)).toBeInTheDocument();
  });

  it("shows current position in legend when currentLedger is provided", () => {
    render(<VestingTimeline schedule={validSchedule} />);
    expect(screen.getByText(/current position/i)).toBeInTheDocument();
  });

  it("does not show current position when currentLedger is not provided", () => {
    render(
      <VestingTimeline
        schedule={{ ...validSchedule, currentLedger: undefined }}
      />
    );
    expect(screen.queryByText(/current position/i)).not.toBeInTheDocument();
  });

  it("has chart legend with cumulative vested", () => {
    render(<VestingTimeline schedule={validSchedule} />);
    expect(screen.getByText(/cumulative vested/i)).toBeInTheDocument();
  });

  it("has correct figure role", () => {
    render(<VestingTimeline schedule={validSchedule} />);
    expect(screen.getByRole("figure")).toBeInTheDocument();
  });

  it("renders chart with recharts components", () => {
    const { container } = render(<VestingTimeline schedule={validSchedule} />);
    expect(container.querySelector("svg")).toBeInTheDocument();
  });
});
