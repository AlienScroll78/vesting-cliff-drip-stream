import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CancelConfirmModal } from "@/components/CancelConfirmModal";

const stream = {
  id: "1",
  recipient: "GABC123…",
  sponsor: "GXYZ789…",
  token: "USDC",
  rate: 10,
  claimableAmount: 500,
  status: "active" as const,
  totalDeposit: 10000,
};

const defaultProps = {
  stream,
  amounts: { recipientAmount: 500, sponsorRefund: 9500, cliffReached: true },
  onConfirm: vi.fn().mockResolvedValue(undefined),
  onClose: vi.fn(),
};

describe("CancelConfirmModal", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("renders dialog with title", () => {
    render(<CancelConfirmModal {...defaultProps} />);
    expect(screen.getByText("Cancel Stream")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("renders recipient address", () => {
    render(<CancelConfirmModal {...defaultProps} />);
    expect(screen.getByText(/GABC123…/)).toBeInTheDocument();
  });

  it("shows cliff warning when cliff not reached", () => {
    render(
      <CancelConfirmModal
        {...defaultProps}
        amounts={{ recipientAmount: 0, sponsorRefund: 10000, cliffReached: false }}
      />
    );
    expect(screen.getByText(/cliff not yet reached/i)).toBeInTheDocument();
  });

  it("hides cliff warning when cliff is reached", () => {
    render(<CancelConfirmModal {...defaultProps} />);
    expect(screen.queryByText(/cliff not yet reached/i)).not.toBeInTheDocument();
  });

  it("shows recipient amount breakdown", () => {
    render(<CancelConfirmModal {...defaultProps} />);
    expect(screen.getByText("500")).toBeInTheDocument();
    expect(screen.getByText("9,500")).toBeInTheDocument();
  });

  it("confirm button is disabled until CANCEL is typed", () => {
    render(<CancelConfirmModal {...defaultProps} />);
    expect(screen.getByTestId("cancel-confirm-btn")).toBeDisabled();
  });

  it("enables confirm button after typing CANCEL", async () => {
    render(<CancelConfirmModal {...defaultProps} />);
    const input = screen.getByLabelText(/type/i);
    await userEvent.type(input, "CANCEL");
    expect(screen.getByTestId("cancel-confirm-btn")).not.toBeDisabled();
  });

  it("disables button when wrong text is typed", async () => {
    render(<CancelConfirmModal {...defaultProps} />);
    const input = screen.getByLabelText(/type/i);
    await userEvent.type(input, "cancel");
    expect(screen.getByTestId("cancel-confirm-btn")).toBeDisabled();
  });

  it("calls onConfirm when confirmed", async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    render(<CancelConfirmModal {...defaultProps} onConfirm={onConfirm} />);
    await userEvent.type(screen.getByLabelText(/type/i), "CANCEL");
    await userEvent.click(screen.getByTestId("cancel-confirm-btn"));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it("shows loading state while confirming", async () => {
    let resolve: () => void;
    const onConfirm = vi.fn().mockImplementation(
      () => new Promise<void>((r) => { resolve = r; })
    );
    render(<CancelConfirmModal {...defaultProps} onConfirm={onConfirm} />);
    await userEvent.type(screen.getByLabelText(/type/i), "CANCEL");
    await userEvent.click(screen.getByTestId("cancel-confirm-btn"));
    expect(screen.getByText("Cancelling…")).toBeInTheDocument();
    resolve!();
  });

  it("disables both buttons while loading", async () => {
    let resolve: () => void;
    const onConfirm = vi.fn().mockImplementation(
      () => new Promise<void>((r) => { resolve = r; })
    );
    render(<CancelConfirmModal {...defaultProps} onConfirm={onConfirm} />);
    await userEvent.type(screen.getByLabelText(/type/i), "CANCEL");
    await userEvent.click(screen.getByTestId("cancel-confirm-btn"));
    expect(screen.getByText("Go back")).toBeDisabled();
    resolve!();
  });

  it("calls onClose when Go back is clicked", async () => {
    const onClose = vi.fn();
    render(<CancelConfirmModal {...defaultProps} onClose={onClose} />);
    await userEvent.click(screen.getByText("Go back"));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("calls onClose on Escape key", async () => {
    const onClose = vi.fn();
    render(<CancelConfirmModal {...defaultProps} onClose={onClose} />);
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("calls onClose on backdrop click", async () => {
    const onClose = vi.fn();
    render(<CancelConfirmModal {...defaultProps} onClose={onClose} />);
    await userEvent.click(document.querySelector("[role='dialog']")!);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("does not call onClose when clicking inside the modal", async () => {
    const onClose = vi.fn();
    render(<CancelConfirmModal {...defaultProps} onClose={onClose} />);
    await userEvent.click(screen.getByText("Cancel Stream"));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("has correct ARIA attributes", () => {
    render(<CancelConfirmModal {...defaultProps} />);
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAttribute("aria-labelledby");
  });
});
