import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ClaimButton, type ClaimButtonProps } from "@/components/ClaimButton";

// ── Default props ─────────────────────────────────────────────────────────────

const defaultProps: ClaimButtonProps = {
  phase: "idle",
  cliffReached: true,
  claimableAmount: 1500,
  tokenSymbol: "USDC",
  amountClaimed: null,
  errorMessage: null,
  onClick: vi.fn(),
};

function setup(overrides: Partial<ClaimButtonProps> = {}) {
  const onClick = vi.fn();
  const props = { ...defaultProps, onClick, ...overrides };
  render(<ClaimButton {...props} />);
  return { onClick, props };
}

describe("ClaimButton", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  // ── Idle (enabled) ──────────────────────────────────────────────────────────

  it("renders 'Claim' in idle state when cliff reached and amount > 0", () => {
    setup();
    const btn = screen.getByTestId("claim-button");
    expect(btn).toHaveTextContent("Claim");
    expect(btn).not.toBeDisabled();
  });

  it("calls onClick when clicked in idle state", async () => {
    const { onClick } = setup();
    await userEvent.click(screen.getByTestId("claim-button"));
    expect(onClick).toHaveBeenCalledOnce();
  });

  // ── Pre-cliff disabled ──────────────────────────────────────────────────────

  it("disables button when cliff not reached", () => {
    setup({ cliffReached: false, claimableAmount: 0 });
    expect(screen.getByTestId("claim-button")).toBeDisabled();
  });

  it("does not call onClick when button is disabled (cliff)", async () => {
    const { onClick } = setup({ cliffReached: false, claimableAmount: 0 });
    // Attempt click via keyboard on the wrapper (button is disabled)
    const btn = screen.getByTestId("claim-button");
    expect(btn).toBeDisabled();
    await userEvent.click(btn, { pointerEventsCheck: 0 });
    expect(onClick).not.toHaveBeenCalled();
  });

  it("shows tooltip with cliff message on hover", async () => {
    setup({ cliffReached: false, claimableAmount: 0, ledgersUntilCliff: 17_280 });
    const btn = screen.getByTestId("claim-button");
    await userEvent.hover(btn.parentElement!);
    const tooltip = await screen.findByRole("tooltip");
    expect(tooltip).toHaveTextContent(/cliff not reached/i);
  });

  it("tooltip includes ledger-count when provided", async () => {
    setup({ cliffReached: false, claimableAmount: 0, ledgersUntilCliff: 17_280 });
    const btn = screen.getByTestId("claim-button");
    await userEvent.hover(btn.parentElement!);
    expect(await screen.findByRole("tooltip")).toHaveTextContent(/17,280/);
  });

  it("shows tooltip without ledger count when ledgersUntilCliff is 0", async () => {
    setup({ cliffReached: false, claimableAmount: 0, ledgersUntilCliff: 0 });
    const btn = screen.getByTestId("claim-button");
    await userEvent.hover(btn.parentElement!);
    expect(await screen.findByRole("tooltip")).toHaveTextContent(/still locked/i);
  });

  // ── Zero-amount disabled ────────────────────────────────────────────────────

  it("disables button when claimableAmount is 0 (cliff passed)", () => {
    setup({ cliffReached: true, claimableAmount: 0 });
    expect(screen.getByTestId("claim-button")).toBeDisabled();
  });

  it("shows tooltip about nothing to claim when amount is 0", async () => {
    setup({ cliffReached: true, claimableAmount: 0 });
    const btn = screen.getByTestId("claim-button");
    await userEvent.hover(btn.parentElement!);
    expect(await screen.findByRole("tooltip")).toHaveTextContent(/nothing to claim/i);
  });

  // ── Signing phase ───────────────────────────────────────────────────────────

  it("shows 'Signing…' in signing phase", () => {
    setup({ phase: "signing" });
    expect(screen.getByTestId("claim-button")).toHaveTextContent("Signing…");
  });

  it("renders spinner in signing phase", () => {
    setup({ phase: "signing" });
    expect(screen.getByTestId("claim-btn-spinner")).toBeInTheDocument();
  });

  it("disables button in signing phase", () => {
    setup({ phase: "signing" });
    expect(screen.getByTestId("claim-button")).toBeDisabled();
  });

  it("marks button as aria-busy in signing phase", () => {
    setup({ phase: "signing" });
    expect(screen.getByTestId("claim-button")).toHaveAttribute("aria-busy", "true");
  });

  // ── Pending phase ───────────────────────────────────────────────────────────

  it("shows 'Pending…' in pending phase", () => {
    setup({ phase: "pending" });
    expect(screen.getByTestId("claim-button")).toHaveTextContent("Pending…");
  });

  it("renders spinner in pending phase", () => {
    setup({ phase: "pending" });
    expect(screen.getByTestId("claim-btn-spinner")).toBeInTheDocument();
  });

  it("disables button in pending phase", () => {
    setup({ phase: "pending" });
    expect(screen.getByTestId("claim-button")).toBeDisabled();
  });

  // ── Success phase ───────────────────────────────────────────────────────────

  it("shows 'Claimed ✓' with amount in success phase", () => {
    setup({ phase: "success", amountClaimed: 1500 });
    expect(screen.getByTestId("claim-button")).toHaveTextContent("1,500");
    expect(screen.getByTestId("claim-button")).toHaveTextContent("USDC");
  });

  it("disables button in success phase", () => {
    setup({ phase: "success", amountClaimed: 1500 });
    expect(screen.getByTestId("claim-button")).toBeDisabled();
  });

  it("does not show spinner in success phase", () => {
    setup({ phase: "success", amountClaimed: 1500 });
    expect(screen.queryByTestId("claim-btn-spinner")).not.toBeInTheDocument();
  });

  it("shows 'Claimed ✓' generic when amountClaimed is null in success", () => {
    setup({ phase: "success", amountClaimed: null });
    expect(screen.getByTestId("claim-button")).toHaveTextContent("Claimed ✓");
  });

  // ── Error phase ─────────────────────────────────────────────────────────────

  it("shows 'Retry' in error phase", () => {
    setup({ phase: "error", errorMessage: "Cliff not reached: tokens are locked." });
    expect(screen.getByTestId("claim-button")).toHaveTextContent("Retry");
  });

  it("re-enables button in error phase", () => {
    setup({ phase: "error", errorMessage: "Cliff not reached." });
    expect(screen.getByTestId("claim-button")).not.toBeDisabled();
  });

  it("calls onClick when Retry is clicked", async () => {
    const { onClick } = setup({ phase: "error", errorMessage: "Failed." });
    await userEvent.click(screen.getByTestId("claim-button"));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("renders inline error message below button", () => {
    setup({ phase: "error", errorMessage: "Something went wrong." });
    expect(screen.getByTestId("claim-btn-error")).toHaveTextContent("Something went wrong.");
  });

  it("renders error with role='alert'", () => {
    setup({ phase: "error", errorMessage: "Something went wrong." });
    expect(screen.getByTestId("claim-btn-error")).toHaveAttribute("role", "alert");
  });

  it("does not render error element when errorMessage is null", () => {
    setup({ phase: "idle" });
    expect(screen.queryByTestId("claim-btn-error")).not.toBeInTheDocument();
  });

  // ── data-phase attribute ────────────────────────────────────────────────────

  it("sets data-phase attribute to reflect current phase", () => {
    setup({ phase: "pending" });
    expect(screen.getByTestId("claim-button")).toHaveAttribute("data-phase", "pending");
  });

  // ── Tooltip hides on mouse leave ────────────────────────────────────────────

  it("tooltip disappears after mouse leaves the button", async () => {
    setup({ cliffReached: false, claimableAmount: 0, ledgersUntilCliff: 100 });
    const btn = screen.getByTestId("claim-button");
    await userEvent.hover(btn.parentElement!);
    await screen.findByRole("tooltip");
    await userEvent.unhover(btn.parentElement!);
    await waitFor(() =>
      expect(screen.queryByRole("tooltip")).not.toBeInTheDocument()
    );
  });
});
