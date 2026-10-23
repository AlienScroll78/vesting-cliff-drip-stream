"use client";
import { VestingStream } from "@/types";
import { useStreamAcknowledgment } from "@/hooks/useStreamAcknowledgment";
import { SignMessageFn } from "@/utils/streamAcknowledgments";
import { formatAmount } from "@/utils/formatAmount";
import styles from "./StreamAcknowledgmentBanner.module.css";

export interface StreamAcknowledgmentBannerProps {
  stream: VestingStream;
  network?: string;
  signMessage?: SignMessageFn;
}

export function StreamAcknowledgmentBanner({
  stream,
  network = "testnet",
  signMessage,
}: StreamAcknowledgmentBannerProps) {
  const { phase, record, error, busy, acknowledge, skip } = useStreamAcknowledgment(
    stream,
    network,
    signMessage,
  );

  if (phase === "loading" || phase === "resolved") {
    return null;
  }

  const amount =
    stream.totalDeposit !== undefined
      ? `${formatAmount(stream.totalDeposit)} ${stream.token}`
      : "an amount of " + stream.token;

  return (
    <section
      className={styles.banner}
      role="status"
      aria-live="polite"
      aria-labelledby="stream-acknowledgment-title"
      data-testid="stream-acknowledgment-banner"
    >
      <div className={styles.heading}>
        <span className={styles.dot} aria-hidden="true" />
        <h2 id="stream-acknowledgment-title" className={styles.title}>
          Stream pending acknowledgment
        </h2>
      </div>

      <p className={styles.body}>
        A vesting stream was created for you by{" "}
        <span className={styles.mono}>{stream.sponsor}</span> paying {amount} at{" "}
        {stream.rate} {stream.token} per ledger
        {stream.cliffLedger !== undefined
          ? `, unlocking at the cliff on ledger ${stream.cliffLedger}.`
          : "."}
      </p>

      <p className={styles.legal}>
        Acknowledging signs a message with your wallet. It costs no XLM and sends no on-chain
        transaction. You can skip this and the stream still vests normally.
      </p>

      {error && (
        <p className={styles.error} role="alert" data-testid="acknowledgment-error">
          {error}
        </p>
      )}

      <div className={styles.actions}>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => void acknowledge()}
          disabled={busy}
          aria-busy={busy}
          data-testid="acknowledge-stream-btn"
        >
          {busy ? "Waiting for wallet…" : "Acknowledge stream"}
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => void skip()}
          disabled={busy}
          data-testid="skip-acknowledgment-btn"
        >
          Skip for now
        </button>
      </div>

      {record?.skipped_at && (
        <p className={styles.resolved} data-testid="acknowledgment-skipped">
          Acknowledgment skipped on{" "}
          {new Date(record.skipped_at).toLocaleDateString()}.
        </p>
      )}
    </section>
  );
}
