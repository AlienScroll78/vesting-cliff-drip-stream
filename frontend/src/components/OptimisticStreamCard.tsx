/**
 * OptimisticStreamCard — visual state for an optimistically-rendered stream.
 *
 * When a user submits a "create stream" transaction, the UI can immediately
 * render a provisional card before the transaction is confirmed on-chain.
 * This component represents that in-progress / optimistic state.
 *
 * Visual spec
 * ───────────
 * • Dashed violet border (--color-primary-400) signals "not yet confirmed"
 * • Pale violet background (--color-primary-50)
 * • Animated shimmer sweep across the card (2 s, low-opacity violet)
 * • "Pending confirmation" badge with a pulsing dot
 * • All metadata fields are shown with the data provided by the caller;
 *   fields not yet known are displayed as "—"
 * • A progress bar placeholder (indeterminate, 45 % fill) conveys activity
 *
 * Reduced-motion
 * ──────────────
 * The shimmer sweep and pulsing dot are disabled.  The card uses static
 * reduced opacity (0.75) to indicate the pending state without motion.
 *
 * Accessibility
 * ─────────────
 * • `role="article"` with `aria-label` describing the card as pending
 * • `aria-busy="true"` while the transaction is unconfirmed
 * • Badge text is readable by screen readers (not purely decorative)
 * • All purely decorative animated elements carry `aria-hidden="true"`
 *
 * Usage
 * ─────
 * // Immediately after the user submits:
 * <OptimisticStreamCard
 *   recipient="GABCDE…"
 *   token="USDC"
 *   rate={10}
 *   cliffDays={30}
 *   totalDays={365}
 * />
 *
 * // Once confirmed, replace with the real StreamCard and optionally
 * // trigger the ConfettiBurst animation.
 */

"use client";

import styles from "./Skeletons.module.css";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface OptimisticStreamCardProps {
  /** Recipient stellar address (G…). */
  recipient: string;
  /** Token symbol, e.g. "USDC". */
  token?: string;
  /** Tokens per ledger. */
  rate?: number;
  /** Number of days until the cliff (approximate). */
  cliffDays?: number;
  /** Total stream duration in days (approximate). */
  totalDays?: number;
  /** Optional extra CSS class for the outer card element. */
  className?: string;
  /** Custom badge label, defaults to "Pending confirmation". */
  badgeLabel?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function truncateAddress(address: string): string {
  if (address.length <= 16) return address;
  return `${address.slice(0, 8)}…${address.slice(-6)}`;
}

function formatRate(rate?: number, token?: string): string {
  if (rate == null) return "—";
  const t = token ?? "tokens";
  return `${rate.toLocaleString()} ${t}/ledger`;
}

function formatDays(days?: number): string {
  if (days == null) return "—";
  return `~${days.toLocaleString()} day${days === 1 ? "" : "s"}`;
}

// ─── OptimisticStreamCard ─────────────────────────────────────────────────────

export function OptimisticStreamCard({
  recipient,
  token,
  rate,
  cliffDays,
  totalDays,
  className,
  badgeLabel = "Pending confirmation",
}: OptimisticStreamCardProps) {
  const combinedClass = [styles.optimisticCard, className].filter(Boolean).join(" ");

  return (
    <article
      className={combinedClass}
      role="article"
      aria-label={`Optimistic stream for ${truncateAddress(recipient)} — pending confirmation`}
      aria-busy="true"
      data-testid="optimistic-stream-card"
    >
      {/* Header: title + pending badge */}
      <div className={styles.optimisticHeader}>
        <p className={styles.optimisticTitle}>
          {truncateAddress(recipient)}
        </p>
        <span className={styles.optimisticBadge} aria-label={badgeLabel}>
          <span className={styles.optimisticBadgeDot} aria-hidden="true" />
          {badgeLabel}
        </span>
      </div>

      {/* Meta grid */}
      <div className={styles.optimisticMeta}>
        <div className={styles.optimisticMetaItem}>
          <span className={styles.optimisticMetaLabel}>Token</span>
          <span className={styles.optimisticMetaValue}>{token ?? "—"}</span>
        </div>
        <div className={styles.optimisticMetaItem}>
          <span className={styles.optimisticMetaLabel}>Rate</span>
          <span className={styles.optimisticMetaValue}>{formatRate(rate, token)}</span>
        </div>
        <div className={styles.optimisticMetaItem}>
          <span className={styles.optimisticMetaLabel}>Cliff</span>
          <span className={styles.optimisticMetaValue}>{formatDays(cliffDays)}</span>
        </div>
        <div className={styles.optimisticMetaItem}>
          <span className={styles.optimisticMetaLabel}>Duration</span>
          <span className={styles.optimisticMetaValue}>{formatDays(totalDays)}</span>
        </div>
      </div>

      {/* Indeterminate progress bar — conveys ongoing activity */}
      <div
        className={styles.optimisticProgressBar}
        role="progressbar"
        aria-label="Transaction confirmation in progress"
        aria-valuemin={0}
        aria-valuemax={100}
        /* aria-valuenow omitted — indeterminate */
      >
        <div
          className={styles.optimisticProgressFill}
          aria-hidden="true"
          style={{ width: "45%" }}
        />
      </div>
    </article>
  );
}
