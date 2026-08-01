/**
 * Skeleton loading screen components.
 *
 * - Animated shimmer effect via CSS keyframes (degrades to pulse for prefers-reduced-motion)
 * - Dimensions match actual content to prevent layout shift
 * - aria-busy="true" + aria-label="Loading" on container elements
 * - aria-hidden="true" on individual skeleton blocks
 * - Maximum 3 skeleton rows shown by default (count capped at 3)
 *
 * Exports:
 *   Skeleton                — base primitive (rect, circle, text)
 *   StreamCardSkeleton      — matches StreamCard layout
 *   StreamDetailSkeleton    — matches detail panel layout
 *   TransactionHistorySkeleton — matches table row layout
 *   StatsRowSkeleton        — 3-column stats row
 *   StreamListSkeleton      — list of StreamCardSkeletons (max 3)
 *   DashboardSkeleton       — StatsRow + StreamList
 *   FormSkeleton            — generic form field skeleton
 */

import React from "react";
import "./Skeletons.css";

// ─── Base Skeleton primitive ──────────────────────────────────────────────────

export interface SkeletonProps {
  width?: string | number;
  height?: string | number;
  shape?: "rect" | "circle" | "text";
  className?: string;
  style?: React.CSSProperties;
}

/**
 * The atomic skeleton block. All other skeleton components compose from this.
 */
export function Skeleton({
  width = "100%",
  height = "1rem",
  shape = "rect",
  className = "",
  style,
}: SkeletonProps) {
  const shapeClass = `skeleton--${shape}`;
  const computedStyle: React.CSSProperties = {
    width: typeof width === "number" ? `${width}px` : width,
    height: typeof height === "number" ? `${height}px` : height,
    ...style,
  };

  return (
    <span
      className={`skeleton ${shapeClass} ${className}`.trim()}
      style={computedStyle}
      aria-hidden="true"
    />
  );
}

// ─── StreamCardSkeleton ───────────────────────────────────────────────────────

/**
 * Matches the StreamCard layout: header with label + status badge,
 * a stats row, and a progress bar. Prevents layout shift on load.
 */
export function StreamCardSkeleton() {
  return (
    <li
      className="skeleton-stream-card"
      aria-hidden="true"
      style={{ listStyle: "none" }}
    >
      {/* Header row: label + badge */}
      <div className="skeleton-row" style={{ justifyContent: "space-between" }}>
        <div className="skeleton-stack" style={{ gap: "0.4rem" }}>
          {/* "Contributor stream" label */}
          <Skeleton width="55%" height="0.75rem" />
          {/* Stream name */}
          <Skeleton width="75%" height="1.1rem" />
        </div>
        {/* Status badge */}
        <Skeleton width="5rem" height="1.5rem" shape="circle" />
      </div>

      {/* Stats mini-grid */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "0.5rem" }}>
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="skeleton-stat-cell">
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
    <div
      className="skeleton-stream-detail"
      aria-busy="true"
      aria-label="Loading stream details"
    >
      {/* Title area */}
      <div className="skeleton-stack" style={{ gap: "0.5rem" }}>
        <Skeleton width="30%" height="0.75rem" />
        <Skeleton width="60%" height="1.5rem" />
      </div>

      {/* Stats grid (2×2) */}
      <div className="skeleton-stats-grid">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="skeleton-stat-cell">
            <Skeleton width="40%" height="0.65rem" />
            <Skeleton width="70%" height="1.1rem" />
          </div>
        ))}
      </div>

      {/* Timeline placeholder */}
      <div className="skeleton-stack" style={{ gap: "0.4rem" }}>
        <Skeleton height="1rem" shape="circle" />
        <div className="skeleton-row" style={{ justifyContent: "space-between" }}>
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

/** Maximum rows shown in the transaction history skeleton. */
const MAX_TX_ROWS = 3;

/**
 * Matches the transaction history table: hash, amount, and date columns.
 * Shows at most 3 rows.
 */
export function TransactionHistorySkeleton({ rows = 3 }: { rows?: number }) {
  const count = Math.min(rows, MAX_TX_ROWS);
  return (
    <div
      className="skeleton-table"
      aria-busy="true"
      aria-label="Loading transaction history"
    >
      {/* Column headers */}
      <div className="skeleton-table-header" aria-hidden="true">
        <Skeleton width="4rem" height="0.65rem" />
        <Skeleton width="3rem" height="0.65rem" />
        <Skeleton width="3rem" height="0.65rem" />
      </div>

      {/* Rows */}
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="skeleton-table-row" aria-hidden="true">
          {/* Transaction hash (monospace, wider) */}
          <Skeleton width="85%" height="0.875rem" style={{ fontFamily: "monospace" }} />
          {/* Amount */}
          <Skeleton width="70%" height="0.875rem" />
          {/* Date */}
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
      className="skeleton-row"
      style={{ gap: "1rem", marginBottom: "1rem", alignItems: "stretch" }}
      aria-busy="true"
      aria-label="Loading stats"
    >
      {[1, 2, 3].map((i) => (
        <div
          key={i}
          className="skeleton-stat-cell"
          style={{ flex: 1 }}
        >
          <Skeleton width="50%" height="0.65rem" />
          <Skeleton width="65%" height="1.5rem" />
        </div>
      ))}
    </div>
  );
}

// ─── StreamListSkeleton ───────────────────────────────────────────────────────

/** Maximum number of skeleton stream cards to show. */
const MAX_SKELETON_ROWS = 3;

/**
 * A list of StreamCardSkeletons. Count is capped at 3 regardless of the prop
 * to avoid visual overload and match the issue spec.
 */
export function StreamListSkeleton({ count = 3 }: { count?: number }) {
  const safeCount = Math.min(count, MAX_SKELETON_ROWS);
  return (
    <ul
      className="stream-list"
      style={{ marginTop: "1rem", padding: 0 }}
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
    <div
      aria-busy="true"
      aria-label="Loading dashboard"
    >
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
    <div
      className="skeleton-form"
      aria-busy="true"
      aria-label="Loading form"
    >
      {Array.from({ length: fields }).map((_, i) => (
        <div key={i} className="skeleton-field">
          {/* Label */}
          <Skeleton width="35%" height="0.75rem" />
          {/* Input */}
          <Skeleton width="100%" height="2.375rem" shape="rect" />
        </div>
      ))}
      {/* Submit button */}
      <Skeleton width="40%" height="2.5rem" shape="rect" style={{ marginTop: "0.5rem", borderRadius: "0.5rem" }} />
    </div>
  );
}
