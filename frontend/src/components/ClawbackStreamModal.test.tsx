import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ClawbackStreamModal } from "./ClawbackStreamModal";
import type { VestingStream } from "@/types";

const STREAM: VestingStream = {
  id: "stream-1",
  streamId: 3,
  recipient: "GRECIPIENT",
  sponsor: "GSPONSOR",
  token: "USDC",
  rate: 10,
  claimableAmount: 0,
  status: "active",
  clawbackEligible: true,
  clawbackAmount: 12_500,
};

describe("ClawbackStreamModal", () => {
  it("requires explanation, a reason, and a final amount confirmation", async () => {
    const user = userEvent.setup();
    const onClawback = vi.fn().mockResolvedValue(12_500);
    const onClose = vi.fn();
    render(
      <ClawbackStreamModal stream={STREAM} onClawback={onClawback} onClose={onClose} />,
    );

    expect(screen.getByText(/Step 1 of 3/)).toBeInTheDocument();
    expect(screen.getByTestId("clawback-warning")).toHaveTextContent(
      "This action is irreversible. All remaining tokens will be returned to you.",
    );
    expect(screen.getByRole("heading", { name: "Compliance Clawback" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByText(/Step 2 of 3/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();

    await user.type(screen.getByLabelText(/Reason for clawback/), "Regulatory requirement");
    expect(screen.getByTestId("clawback-reason-counter")).toHaveTextContent(
      "22/256",
    );
    await user.click(screen.getByRole("button", { name: "Continue" }));

    expect(screen.getByText(/Step 3 of 3/)).toBeInTheDocument();
    expect(screen.getByTestId("clawback-amount")).toHaveTextContent("12,500 USDC");
    await user.click(screen.getByTestId("clawback-final-confirm"));

    expect(onClawback).toHaveBeenCalledWith(STREAM, "Regulatory requirement");
    expect(await screen.findByTestId("clawback-success")).toHaveTextContent(
      "Clawback complete. 12,500 tokens returned to your wallet.",
    );
    await user.click(screen.getByRole("button", { name: "Done" }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("reports transaction errors and preserves the final confirmation step", async () => {
    const user = userEvent.setup();
    const onClawback = vi.fn().mockRejectedValue(new Error("Transaction rejected"));
    render(
      <ClawbackStreamModal stream={STREAM} onClawback={onClawback} onClose={vi.fn()} />,
    );

    await user.click(screen.getByRole("button", { name: "Continue" }));
    await user.type(screen.getByLabelText(/Reason for clawback/), "Compliance review");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await user.click(screen.getByTestId("clawback-final-confirm"));

    expect(await screen.findByRole("alert")).toHaveTextContent("Transaction rejected");
    expect(screen.getByText(/Step 3 of 3/)).toBeInTheDocument();
  });

  it("limits the reason to 256 characters and reports the count", async () => {
    const user = userEvent.setup();
    render(
      <ClawbackStreamModal stream={STREAM} onClawback={vi.fn()} onClose={vi.fn()} />,
    );

    await user.click(screen.getByRole("button", { name: "Continue" }));
    const reasonInput = screen.getByLabelText(/Reason for clawback/);
    await user.type(reasonInput, "x".repeat(257));

    expect(reasonInput).toHaveValue("x".repeat(256));
    expect(screen.getByTestId("clawback-reason-counter")).toHaveTextContent("256/256");
  });

  it("does not allow a final confirmation without a verified recovery amount", async () => {
    const user = userEvent.setup();
    render(
      <ClawbackStreamModal
        stream={{ ...STREAM, clawbackAmount: undefined }}
        onClawback={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Continue" }));
    await user.type(screen.getByLabelText(/Reason for clawback/), "Compliance review");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByTestId("clawback-amount")).toHaveTextContent("Amount unavailable");
    expect(screen.getByTestId("clawback-final-confirm")).toBeDisabled();
  });
});
