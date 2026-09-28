import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ClaimBottomSheet } from "@/components/ClaimBottomSheet";
import * as feeEstimate from "@/utils/feeEstimate";
import { VestingStream } from "@/types";

const activeStream: VestingStream = {
  id: "1",
  recipient: "GABC…",
  sponsor: "GXYZ…",
  token: "USDC",
  rate: 10,
  claimableAmount: 1500,
  status: "active",
  totalDeposit: 10000,
  totalVested: 1500,
};

const defaultProps = {
  stream: activeStream,
  currentLedger: 51_200_000,
  onClaim: vi.fn().mockResolvedValue(undefined),
  onClose: vi.fn(),
};

describe("ClaimBottomSheet", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(feeEstimate, "estimateFee").mockResolvedValue({
      xlm: "0.00010",
      usd: "$0.000012",
    });
  });

  it("renders claimable amount", () => {
    render(<ClaimBottomSheet {...defaultProps} />);
    expect(screen.getByTestId("claimable-amount")).toBeInTheDocument();
  });

  it("shows fee estimate after loading", async () => {
    render(<ClaimBottomSheet {...defaultProps} />);
    expect(screen.getByTestId("fee-loading")).toBeInTheDocument();
    expect(await screen.findByTestId("fee-value")).toHaveTextContent("0.00010 XLM");
    expect(screen.getByTestId("fee-value")).toHaveTextContent("$0.000012");
  });

  it("shows fee unknown warning when estimation fails", async () => {
    vi.spyOn(feeEstimate, "estimateFee").mockResolvedValue(null);
    render(<ClaimBottomSheet {...defaultProps} />);
    expect(await screen.findByTestId("fee-unknown")).toHaveTextContent(/unavailable/i);
  });

  it("fee unknown does not block claim button", async () => {
    vi.spyOn(feeEstimate, "estimateFee").mockResolvedValue(null);
    render(<ClaimBottomSheet {...defaultProps} />);
    await screen.findByTestId("fee-unknown");
    expect(screen.getByTestId("claim-button")).not.toBeDisabled();
  });

  it("calls onClaim when claim button is clicked", async () => {
    const onClaim = vi.fn().mockResolvedValue(undefined);
    render(<ClaimBottomSheet {...defaultProps} onClaim={onClaim} />);
    await userEvent.click(screen.getByTestId("claim-button"));
    expect(onClaim).toHaveBeenCalledOnce();
  });

  it("disables claim button while loading", async () => {
    let resolve: () => void;
    const onClaim = vi.fn().mockImplementation(
      () => new Promise<void>((r) => { resolve = r; })
    );
    render(<ClaimBottomSheet {...defaultProps} onClaim={onClaim} />);
    await userEvent.click(screen.getByTestId("claim-button"));
    expect(screen.getByTestId("claim-button")).toBeDisabled();
    resolve!();
    // After successful claim the button stays disabled (claimed=true optimistic state)
    await waitFor(() => expect(screen.getByTestId("claim-button")).toHaveTextContent("Claimed"));
  });

  it("shows 'Claiming…' text while loading", async () => {
    let resolve: () => void;
    const onClaim = vi.fn().mockImplementation(
      () => new Promise<void>((r) => { resolve = r; })
    );
    render(<ClaimBottomSheet {...defaultProps} onClaim={onClaim} />);
    await userEvent.click(screen.getByTestId("claim-button"));
    expect(screen.getByTestId("claim-button")).toHaveTextContent("Claiming…");
    resolve!();
  });

  it("disables claim button when claimableAmount is 0", () => {
    const zeroStream: VestingStream = { ...activeStream, claimableAmount: 0 };
    render(<ClaimBottomSheet {...defaultProps} stream={zeroStream} />);
    expect(screen.getByTestId("claim-button")).toBeDisabled();
  });

  it("calls onClose when Close is clicked", async () => {
    const onClose = vi.fn();
    render(<ClaimBottomSheet {...defaultProps} onClose={onClose} />);
    await userEvent.click(screen.getByText(/close/i));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("calls onClose on Escape key", async () => {
    const onClose = vi.fn();
    render(<ClaimBottomSheet {...defaultProps} onClose={onClose} />);
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("shows cliff countdown for pre-cliff stream", () => {
    const preCliffStream: VestingStream = {
      ...activeStream,
      status: "pre-cliff",
      claimableAmount: 0,
      cliffLedger: 51_259_200, // 59_200 ledgers away
    };
    render(<ClaimBottomSheet {...defaultProps} stream={preCliffStream} />);
    expect(screen.getByTestId("cliff-countdown")).toBeInTheDocument();
    expect(screen.getByTestId("cliff-countdown")).toHaveTextContent(/cliff not reached/i);
  });

  it("disables claim button for pre-cliff stream", () => {
    const preCliffStream: VestingStream = {
      ...activeStream,
      status: "pre-cliff",
      claimableAmount: 0,
    };
    render(<ClaimBottomSheet {...defaultProps} stream={preCliffStream} />);
    expect(screen.getByTestId("claim-button")).toBeDisabled();
  });

  it("shows schedule info when totalVested is provided", () => {
    render(<ClaimBottomSheet {...defaultProps} />);
    expect(screen.getByTestId("schedule-info")).toBeInTheDocument();
    expect(screen.getByTestId("total-vested")).toHaveTextContent("1,500");
  });

  it("shows optimistic claimed state after successful claim", async () => {
    const onClaim = vi.fn().mockResolvedValue(undefined);
    render(<ClaimBottomSheet {...defaultProps} onClaim={onClaim} />);
    await userEvent.click(screen.getByTestId("claim-button"));
    expect(await screen.findByTestId("claim-success")).toBeInTheDocument();
  });
});
