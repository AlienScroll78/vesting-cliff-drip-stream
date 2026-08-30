/**
 * Skeleton loading screen components — Issue #540: migrated to CSS Modules.
 *
 * All class names are now locally scoped via Skeletons.module.css,
 * eliminating global class conflicts and improving maintainability.
 *
 * - Animated shimmer effect via CSS keyframes (degrades to pulse for prefers-reduced-motion)
 * - Dimensions match actual content to prevent layout shift
 * - aria-busy="true" + aria-label="Loading" on container elements
 * - aria-hidden="true" on individual skeleton blocks
 * - Maximum 3 skeleton rows shown by default (count capped at 3)
 *
 * Exports:
 *   Skeleton                    — base primitive (rect, circle, text)
 *   StreamCardSkeleton          — matches StreamCard layout
 *   StreamDetailSkeleton        — matches detail panel layout
 *   TransactionHistorySkeleton  — matches table row layout
 *   StatsRowSkeleton            — 3-column stats row
 *   StreamListSkeleton          — list of StreamCardSkeletons (max 3)
 *   DashboardSkeleton           — StatsRow + StreamList
 *   FormSkeleton                — generic form field skeleton
 */

import React from "react";
import styles from "./Skeletons.module.css";

// ─── Base Skeleton primitive ──────────────────────────────────────────────────

export interface SkeletonProps {
  width?: string | number;
  height?: string | number;
  shape?: "rect" | "circle" | "text";
  /** Extra CSS class names to pass through (optional) */
  className?: string;
  style?: React.CSSProperties;
}

const SHAPE_CLASS: Record<NonNullable<SkeletonProps["shape"]>, string> = {
  rect:   styles.skeletonRect,
  circle: styles.skeletonCircle,
  text:   styles.skeletonText,
};

/**
 * The atomic skeleton block.  All other skeleton components compose from this.
 */
export function Skeleton({
  width = "100%",
  height = "1rem",
  shape = "rect",
  className = "",
  style,
}: SkeletonProps) {
  const computedStyle: React.CSSProperties = {
    width:  typeof width  === "number" ? `${width}px`  : width,
    height: typeof height === "number" ? `${height}px` : height,
    ...style,
  };

  return (
    <span
      className={[SHAPE_CLASS[shape], className].filter(Boolean).join(" ")}
      style={computedStyle}
      aria-hidden="true"
    />
  );
}

// ─── StreamCardSkeleton ───────────────────────────────────────────────────────

/**
 * Matches the StreamCard layout: header with label + status badge,
 * a stats row, and a progress bar.  Prevents layout shift on load.
 */
export function StreamCardSkeleton() {
  return (
    <li className={styles.streamCard} aria-hidden="true" style={{ listStyle: "none" }}>
      {/* Header row: label + badge */}
      <div className={styles.row} style={{ justifyContent: "space-between" }}>
        <div className={styles.stack} style={{ gap: "0.4rem" }}>
          <Skeleton width="55%" height="0.75rem" />
          <Skeleton width="75%" height="1.1rem" />
        </div>
        <Skeleton width="5rem" height="1.5rem" shape="circle" />
      </div>

      {/* Stats mini-grid */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "0.5rem" }}>
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className={styles.statCell}>
            <Skeleton width="40%" height="0.65rem" />
            <Skeleton width="65%" height="1rem" />
          </div>
        ))}
      </div>

      {/* Progress bar */}
      <Skeleton height="0.5rem" shape="circle" />
    </li>
  );
}

// ─── StreamDetailSkeleton ─────────────────────────────────────────────────────

/**
 * Matches the stream detail panel: large title, 4-cell stats grid, and timeline.
 */
export function StreamDetailSkeleton() {
  return (
    <div className={styles.streamDetail} aria-busy="true" aria-label="Loading stream details">
      {/* Title area */}
      <div className={styles.stack} style={{ gap: "0.5rem" }}>
        <Skeleton width="30%" height="0.75rem" />
        <Skeleton width="60%" height="1.5rem" />
      </div>

      {/* Stats grid (2×2) */}
      <div className={styles.statsGrid}>
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className={styles.statCell}>
            <Skeleton width="40%" height="0.65rem" />
            <Skeleton width="70%" height="1.1rem" />
          </div>
        ))}
      </div>

      {/* Timeline placeholder */}
      <div className={styles.stack} style={{ gap: "0.4rem" }}>
        <Skeleton height="1rem" shape="circle" />
        <div className={styles.row} style={{ justifyContent: "space-between" }}>
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} width="3.5rem" height="0.65rem" />
          ))}
        </div>
      </div>

      {/* Action button */}
      <Skeleton width="10rem" height="2.5rem" shape="rect" style={{ borderRadius: "0.5rem" }} />
    </div>
  );
}

// ─── TransactionHistorySkeleton ───────────────────────────────────────────────

const MAX_TX_ROWS = 3;

/**
 * Matches the transaction history table: hash, amount, and date columns.
 * Shows at most 3 rows.
 */
export function TransactionHistorySkeleton({ rows = 3 }: { rows?: number }) {
  const count = Math.min(rows, MAX_TX_ROWS);
  return (
    <div className={styles.table} aria-busy="true" aria-label="Loading transaction history">
      {/* Column headers */}
      <div className={styles.tableHeader} aria-hidden="true">
        <Skeleton width="4rem" height="0.65rem" />
        <Skeleton width="3rem" height="0.65rem" />
        <Skeleton width="3rem" height="0.65rem" />
      </div>

      {/* Rows */}
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className={styles.tableRow} aria-hidden="true">
          <Skeleton width="85%" height="0.875rem" style={{ fontFamily: "monospace" }} />
          <Skeleton width="70%" height="0.875rem" />
          <Skeleton width="80%" height="0.875rem" />
        </div>
      ))}
    </div>
  );
}

// ─── StatsRowSkeleton ─────────────────────────────────────────────────────────

/**
 * Three-column stats row at the top of the dashboard.
 */
export function StatsRowSkeleton() {
  return (
    <div
      className={styles.row}
      style={{ gap: "1rem", marginBottom: "1rem", alignItems: "stretch" }}
      aria-busy="true"
      aria-label="Loading stats"
    >
      {[1, 2, 3].map((i) => (
        <div key={i} className={styles.statCell} style={{ flex: 1 }}>
          <Skeleton width="50%" height="0.65rem" />
          <Skeleton width="65%" height="1.5rem" />
        </div>
      ))}
    </div>
  );
}

// ─── StreamListSkeleton ───────────────────────────────────────────────────────

const MAX_SKELETON_ROWS = 3;

/**
 * A list of StreamCardSkeletons.  Count is capped at 3 to avoid visual overload.
 */
export function StreamListSkeleton({ count = 3 }: { count?: number }) {
  const safeCount = Math.min(count, MAX_SKELETON_ROWS);
  return (
    <ul
      style={{ listStyle: "none", padding: 0, margin: "1rem 0 0", display: "flex", flexDirection: "column", gap: "0.75rem" }}
      aria-busy="true"
      aria-label="Loading streams"
    >
      {Array.from({ length: safeCount }).map((_, i) => (
        <StreamCardSkeleton key={i} />
      ))}
    </ul>
  );
}

// ─── DashboardSkeleton ────────────────────────────────────────────────────────

/**
 * Full dashboard skeleton: stats row above the stream list.
 */
export function DashboardSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading dashboard">
      <StatsRowSkeleton />
      <StreamListSkeleton count={3} />
    </div>
  );
}

// ─── FormSkeleton ─────────────────────────────────────────────────────────────

/**
 * Placeholder for a form that is loading (e.g. waiting for token list).
 */
export function FormSkeleton({ fields = 4 }: { fields?: number }) {
  return (
    <div className={styles.form} aria-busy="true" aria-label="Loading form">
      {Array.from({ length: fields }).map((_, i) => (
        <div key={i} className={styles.field}>
          <Skeleton width="35%" height="0.75rem" />
          <Skeleton width="100%" height="2.375rem" shape="rect" />
        </div>
      ))}
      <Skeleton
        width="40%"
        height="2.5rem"
        shape="rect"
        style={{ marginTop: "0.5rem", borderRadius: "0.5rem" }}
      />
    </div>
  );
}
