import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TransactionReviewSummary } from "@/components/TransactionReviewSummary";
import * as feeEstimate from "@/utils/feeEstimate";
import type { FeeEstimate } from "@/utils/feeEstimate";
import {
  ESTIMATED_CONFIRMATION_SECONDS,
  FEE_WARNING_THRESHOLD_XLM,
  defaultFeeEstimator,
  getRawTransactionXdr,
  isFeeAboveWarningThreshold,
  parseFeeXlm,
  TRANSACTION_LABELS,
} from "@/utils/transactionReview";

const LOW_FEE: FeeEstimate = { xlm: "0.00010", usd: "$0.000012" };
const HIGH_FEE: FeeEstimate = { xlm: "1.50000", usd: "$0.180000" };

function estimator(value: FeeEstimate | null) {
  return vi.fn().mockResolvedValue(value);
}

describe("TransactionReviewSummary", () => {
  it("labels the transaction type for every transaction kind", () => {
    for (const kind of ["claim", "create", "cancel"] as const) {
      const { unmount } = render(
        <TransactionReviewSummary kind={kind} estimateFee={estimator(null)} />
      );
      expect(screen.getByTestId("review-kind")).toHaveTextContent(TRANSACTION_LABELS[kind]);
      unmount();
    }
  });

  it("shows an animated loading state while the fee is being estimated", async () => {
    render(<TransactionReviewSummary kind="claim" estimateFee={estimator(LOW_FEE)} />);
    expect(screen.getByTestId("fee-estimate")).toHaveAttribute("aria-busy", "true");
    expect(screen.getByTestId("fee-spinner")).toBeInTheDocument();
    expect(screen.getByTestId("fee-loading")).toBeInTheDocument();
    await screen.findByTestId("fee-value");
  });

  it("shows the fee in both XLM and USD", async () => {
    render(<TransactionReviewSummary kind="claim" estimateFee={estimator(LOW_FEE)} />);
    const value = await screen.findByTestId("fee-value");
    expect(value).toHaveTextContent("0.00010 XLM");
    expect(screen.getByTestId("fee-usd")).toHaveTextContent("$0.000012");
    expect(screen.getByTestId("fee-estimate")).toHaveAttribute("aria-busy", "false");
  });

  it("reports an unavailable fee instead of inventing one", async () => {
    render(<TransactionReviewSummary kind="claim" estimateFee={estimator(null)} />);
    expect(await screen.findByTestId("fee-unknown")).toHaveTextContent(/unavailable/i);
    expect(screen.queryByTestId("fee-value")).not.toBeInTheDocument();
  });

  it("shows the XLM fee when only the USD price is unavailable", async () => {
    render(
      <TransactionReviewSummary kind="claim" estimateFee={estimator({ xlm: "0.00010", usd: null })} />
    );
    expect(await screen.findByTestId("fee-value")).toHaveTextContent("0.00010 XLM");
    expect(screen.getByTestId("fee-usd-unavailable")).toHaveTextContent(/USD price unavailable/i);
  });

  it("treats a rejected estimator as an unavailable fee", async () => {
    render(
      <TransactionReviewSummary
        kind="claim"
        estimateFee={vi.fn().mockRejectedValue(new Error("network down"))}
      />
    );
    expect(await screen.findByTestId("fee-unknown")).toBeInTheDocument();
  });

  it("warns when the fee is above the congestion threshold", async () => {
    render(<TransactionReviewSummary kind="claim" estimateFee={estimator(HIGH_FEE)} />);
    const warning = await screen.findByTestId("review-fee-warning");
    expect(warning).toHaveTextContent("1.50000 XLM");
    expect(warning).toHaveTextContent(/congestion/i);
    expect(warning).toHaveAttribute("role", "alert");
  });

  it("does not warn at exactly the threshold", async () => {
    render(
      <TransactionReviewSummary
        kind="claim"
        estimateFee={estimator({ xlm: String(FEE_WARNING_THRESHOLD_XLM), usd: null })}
      />
    );
    await screen.findByTestId("fee-value");
    expect(screen.queryByTestId("review-fee-warning")).not.toBeInTheDocument();
  });

  it("shows the expected confirmation time", async () => {
    render(<TransactionReviewSummary kind="claim" estimateFee={estimator(LOW_FEE)} />);
    expect(screen.getByTestId("review-eta")).toHaveTextContent(
      `~${ESTIMATED_CONFIRMATION_SECONDS} seconds`
    );
    await screen.findByTestId("fee-value");
  });

  it("exposes raw XDR in the advanced section", async () => {
    const xdr = "AAAAAgQAAAAAAAAAAAAAAAAAAAAA";
    render(
      <TransactionReviewSummary
        kind="claim"
        estimateFee={estimator(LOW_FEE)}
        loadXdr={vi.fn().mockResolvedValue(xdr)}
      />
    );
    expect(await screen.findByTestId("review-xdr")).toHaveTextContent(xdr);
    expect(screen.queryByTestId("review-xdr-unavailable")).not.toBeInTheDocument();
  });

  it("keeps the advanced section usable while XDR is loading", async () => {
    render(
      <TransactionReviewSummary
        kind="claim"
        estimateFee={estimator(LOW_FEE)}
        loadXdr={vi.fn().mockReturnValue(new Promise(() => {}))}
      />
    );
    expect(screen.getByTestId("review-xdr-loading")).toBeInTheDocument();
    await screen.findByTestId("fee-value");
  });

  it("states plainly when raw XDR cannot be produced", async () => {
    render(
      <TransactionReviewSummary
        kind="claim"
        estimateFee={estimator(LOW_FEE)}
        loadXdr={vi.fn().mockResolvedValue(null)}
      />
    );
    expect(await screen.findByTestId("review-xdr-unavailable")).toHaveTextContent(
      /no Stellar SDK/i
    );
  });

  it("treats a rejected XDR loader as unavailable", async () => {
    render(
      <TransactionReviewSummary
        kind="claim"
        estimateFee={estimator(LOW_FEE)}
        loadXdr={vi.fn().mockRejectedValue(new Error("boom"))}
      />
    );
    expect(await screen.findByTestId("review-xdr-unavailable")).toBeInTheDocument();
  });

  it("toggles the advanced section from the keyboard", async () => {
    render(
      <TransactionReviewSummary
        kind="claim"
        estimateFee={estimator(LOW_FEE)}
        loadXdr={vi.fn().mockResolvedValue("AAAA")}
      />
    );
    const summary = screen.getByText("Advanced");
    const xdr = await screen.findByTestId("review-xdr");
    expect(xdr.closest("details")).not.toHaveAttribute("open");
    await userEvent.click(summary);
    await waitFor(() =>
      expect(screen.getByText("Advanced").closest("details")).toHaveAttribute("open")
    );
  });
});

describe("transactionReview helpers", () => {
  it("compares fees against the 1 XLM threshold", () => {
    expect(isFeeAboveWarningThreshold(LOW_FEE)).toBe(false);
    expect(isFeeAboveWarningThreshold(HIGH_FEE)).toBe(true);
  });

  it("falls back to zero for an unparseable fee", () => {
    expect(parseFeeXlm({ xlm: "not-a-number", usd: null })).toBe(0);
    expect(isFeeAboveWarningThreshold({ xlm: "not-a-number", usd: null })).toBe(false);
  });

  it("provides a default estimator backed by feeEstimate", async () => {
    const spy = vi.spyOn(feeEstimate, "estimateFee").mockResolvedValue(LOW_FEE);
    await expect(defaultFeeEstimator()).resolves.toEqual(LOW_FEE);
    expect(spy).toHaveBeenCalledOnce();
    spy.mockRestore();
  });

  it("provides a default XDR provider that reports no SDK support", async () => {
    await expect(getRawTransactionXdr()).resolves.toBeNull();
  });
});
