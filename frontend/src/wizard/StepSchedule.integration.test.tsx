import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

// Stub the floating-ui based Tooltip so this integration test does not depend
// on the optional @floating-ui/react package. StepSchedule only uses Tooltip
// for the field hints, which are irrelevant to the calculator assertion.
vi.mock("@/Tooltip", () => ({
  Tooltip: ({ children }: { children?: React.ReactNode }) => <>{children ?? null}</>,
}));

import { StepSchedule } from "@/wizard/StepSchedule";

describe("StepSchedule (#538 integration)", () => {
  it("renders the live cost calculator with the deposit derived from schedule inputs", () => {
    render(
      <StepSchedule
        data={{
          recipient: "GABC",
          tokenAddress: "CABC",
          tokenSymbol: "USDC",
          rate: "10",
          cliffDuration: "17280",
          totalDuration: "518400",
          walletAddress: "",
        }}
        update={() => {}}
        touch={() => {}}
        touched={new Set()}
        onNext={() => {}}
        onBack={() => {}}
      />,
    );

    expect(screen.getByTestId("cost-calculator")).toBeInTheDocument();
    expect(screen.getByTestId("cost-total-deposit")).toHaveTextContent("5,184,000");
    expect(screen.getByTestId("cost-duration-days")).toHaveTextContent("30 days");
  });
});
