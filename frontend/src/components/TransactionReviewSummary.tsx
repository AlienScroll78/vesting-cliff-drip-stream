"use client";
import { useEffect, useId, useRef, useState } from "react";
import { type FeeEstimate } from "@/utils/feeEstimate";
import {
  ESTIMATED_CONFIRMATION_SECONDS,
  type FeeEstimator,
  type TransactionKind,
  TRANSACTION_LABELS,
  type XdrProvider,
  defaultFeeEstimator,
  getRawTransactionXdr,
  isFeeAboveWarningThreshold,
} from "@/utils/transactionReview";
import styles from "./TransactionReviewSummary.module.css";

export interface TransactionReviewSummaryProps {
  kind: TransactionKind;
  estimateFee?: FeeEstimator;
  loadXdr?: XdrProvider;
}

export function TransactionReviewSummary({
  kind,
  estimateFee = defaultFeeEstimator,
  loadXdr = getRawTransactionXdr,
}: TransactionReviewSummaryProps) {
  const [fee, setFee] = useState<FeeEstimate | null | "loading">("loading");
  const [xdr, setXdr] = useState<string | null>(null);
  const [xdrMissing, setXdrMissing] = useState(false);
  const estimatorRef = useRef(estimateFee);
  const loaderRef = useRef(loadXdr);
  const xdrRegionId = useId();

  useEffect(() => {
    let active = true;
    estimatorRef
      .current()
      .then((result) => {
        if (active) setFee(result);
      })
      .catch(() => {
        if (active) setFee(null);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    loaderRef
      .current()
      .then((result) => {
        if (!active) return;
        setXdr(result);
        setXdrMissing(result === null);
      })
      .catch(() => {
        if (active) setXdrMissing(true);
      });
    return () => {
      active = false;
    };
  }, []);

  const resolvedFee = fee === "loading" ? null : fee;
  const highFee = resolvedFee !== null && isFeeAboveWarningThreshold(resolvedFee);

  return (
    <div className={styles.summary} data-testid="transaction-review">
      <p className={styles.kind} data-testid="review-kind">
        {TRANSACTION_LABELS[kind]}
      </p>

      <div
        className={styles.feeBlock}
        data-testid="fee-estimate"
        aria-live="polite"
        aria-busy={fee === "loading"}
      >
        {fee === "loading" && (
          <>
            <span className={styles.spinner} data-testid="fee-spinner" />
            <span data-testid="fee-loading">Estimating network fee…</span>
          </>
        )}
        {fee === null && (
          <span className={styles.unavailable} data-testid="fee-unknown">
            Fee estimate unavailable
          </span>
        )}
        {resolvedFee !== null && (
          <span data-testid="fee-value">
            Estimated fee: <strong>{resolvedFee.xlm} XLM</strong>{" "}
            {resolvedFee.usd ? (
              <span data-testid="fee-usd">({resolvedFee.usd})</span>
            ) : (
              <span data-testid="fee-usd-unavailable">(USD price unavailable)</span>
            )}
          </span>
        )}
      </div>

      {highFee && resolvedFee !== null && (
        <p className={styles.warning} role="alert" data-testid="review-fee-warning">
          Unusually high network fee: {resolvedFee.xlm} XLM. High fees can happen during network
          congestion — you can still continue if you accept it.
        </p>
      )}

      <p className={styles.eta} data-testid="review-eta">
        Estimated confirmation: ~{ESTIMATED_CONFIRMATION_SECONDS} seconds
      </p>

      <details className={styles.advanced}>
        <summary>Advanced</summary>
        <div className={styles.advancedBody} id={xdrRegionId}>
          {xdrMissing ? (
            <p className={styles.xdrNote} data-testid="review-xdr-unavailable">
              Raw transaction XDR is unavailable: this build has no Stellar SDK to build or simulate
              a transaction envelope.
            </p>
          ) : xdr !== null ? (
            <pre className={styles.xdr} data-testid="review-xdr">
              {xdr}
            </pre>
          ) : (
            <p className={styles.xdrNote} data-testid="review-xdr-loading">
              Building transaction…
            </p>
          )}
        </div>
      </details>
    </div>
  );
}
