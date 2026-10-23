import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  CostCalculator,
  LEDGERS_PER_DAY,
  DEFAULT_MIN_DEPOSIT,
  calculateStreamCost,
  formatDays,
} from "@/components/CostCalculator";

// 2030-06-01T12:00:00Z — a fixed reference so date math is deterministic.
const START = new Date(Date.UTC(2030, 5, 1, 12, 0, 0));

describe("calculateStreamCost", () => {
  it("computes totalDeposit = rate × totalDuration", () => {
    const result = calculateStreamCost({
      rate: 10,
      totalDuration: 518_400,
      cliffDuration: 17_280,
      startDate: START,
    });
    expect(result.totalDeposit).toBe(5_184_000);
    expect(result.isUsable).toBe(true);
  });

  it("converts totalDuration to days using 17,280 ledgers/day", () => {
    const result = calculateStreamCost({
      rate: 1,
      totalDuration: 518_400,
      startDate: START,
    });
    expect(result.durationDays).toBe(30);
    expect(LEDGERS_PER_DAY).toBe(17_280);
  });

  it("derives the cliff date from cliffDuration", () => {
    const result = calculateStreamCost({
      rate: 1,
      totalDuration: LEDGERS_PER_DAY * 30,
      cliffDuration: LEDGERS_PER_DAY, // 1 day × 5 s/ledger
      startDate: START,
    });
    expect(result.cliffDate.getTime() - START.getTime()).toBe(LEDGERS_PER_DAY * 5_000);
  });

  it("derives the end date from totalDuration", () => {
    const result = calculateStreamCost({
      rate: 1,
      totalDuration: LEDGERS_PER_DAY * 2,
      startDate: START,
    });
    expect(result.endDate.getTime() - START.getTime()).toBe(LEDGERS_PER_DAY * 2 * 5_000);
  });

  it("flags a deposit below the default minimum of 100", () => {
    const result = calculateStreamCost({ rate: 1, totalDuration: 50, startDate: START });
    expect(DEFAULT_MIN_DEPOSIT).toBe(100);
    expect(result.belowMinDeposit).toBe(true);
    expect(result.minDeposit).toBe(100);
  });

  it("does not flag a deposit exactly at the minimum", () => {
    const result = calculateStreamCost({ rate: 1, totalDuration: 100, startDate: START });
    expect(result.belowMinDeposit).toBe(false);
  });

  it("honours a custom minimum deposit threshold", () => {
    const result = calculateStreamCost({
      rate: 1,
      totalDuration: 500,
      minDeposit: 1_000,
      startDate: START,
    });
    expect(result.belowMinDeposit).toBe(true);
    expect(result.minDeposit).toBe(1_000);
  });

  it("treats a zero rate as unusable and not below minimum", () => {
    const result = calculateStreamCost({ rate: 0, totalDuration: 10_000, startDate: START });
    expect(result.totalDeposit).toBe(0);
    expect(result.isUsable).toBe(false);
    expect(result.belowMinDeposit).toBe(false);
  });

  it("treats a zero duration as unusable", () => {
    const result = calculateStreamCost({ rate: 10, totalDuration: 0, startDate: START });
    expect(result.totalDeposit).toBe(0);
    expect(result.isUsable).toBe(false);
  });

  it("clamps negative inputs to zero instead of producing negative deposits", () => {
    const result = calculateStreamCost({ rate: -5, totalDuration: -20, startDate: START });
    expect(result.totalDeposit).toBe(0);
    expect(result.isUsable).toBe(false);
  });
});

describe("formatDays", () => {
  it("renders sub-hour durations in minutes", () => {
    expect(formatDays(0.01)).toMatch(/min$/);
  });

  it("renders multi-day durations", () => {
    expect(formatDays(30)).toBe("30 days");
  });
});

describe("CostCalculator", () => {
  it("shows a placeholder until usable inputs are provided", () => {
    render(<CostCalculator rate={0} totalDuration={0} />);
    expect(screen.getByTestId("cost-placeholder")).toBeInTheDocument();
    expect(screen.queryByTestId("cost-breakdown")).toHaveTextContent(/Enter a rate/);
  });

  it("renders the live deposit, duration and dates", () => {
    render(
      <CostCalculator
        rate={10}
        totalDuration={518_400}
        cliffDuration={17_280}
        tokenSymbol="USDC"
        startDate={START}
      />,
    );
    expect(screen.getByTestId("cost-total-deposit")).toHaveTextContent("5,184,000");
    expect(screen.getByTestId("cost-total-deposit")).toHaveTextContent("USDC");
    expect(screen.getByTestId("cost-duration-days")).toHaveTextContent("30 days");
    expect(screen.getByTestId("cost-cliff-date")).toHaveTextContent("2030");
    expect(screen.getByTestId("cost-end-date")).toHaveTextContent("2030");
  });

  it("shows the minimum-deposit warning when the deposit is too small", () => {
    render(<CostCalculator rate={1} totalDuration={50} />);
    const warning = screen.getByTestId("min-deposit-warning");
    expect(warning).toBeInTheDocument();
    expect(warning).toHaveTextContent("Below minimum");
    expect(warning).toHaveTextContent("100");
  });

  it("hides the warning for a sufficient deposit", () => {
    render(<CostCalculator rate={10} totalDuration={100_000} />);
    expect(screen.queryByTestId("min-deposit-warning")).not.toBeInTheDocument();
  });

  it("updates the deposit when props change (real-time)", () => {
    const { rerender } = render(<CostCalculator rate={5} totalDuration={1_000} />);
    expect(screen.getByTestId("cost-total-deposit")).toHaveTextContent("5,000");
    rerender(<CostCalculator rate={5} totalDuration={2_000} />);
    expect(screen.getByTestId("cost-total-deposit")).toHaveTextContent("10,000");
  });
});
