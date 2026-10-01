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
 *   SponsorStreamListSkeleton   — sponsor list rows with varying widths (#823)
 *   StreamExplorerSkeleton      — explorer table rows (#823)
 *   NotificationListSkeleton    — notification items (#823)
 *   AnalyticsSummarySkeleton    — stat cards + chart placeholder (#823)
 *
 * Motion: the shimmer is a CSS animation that is switched off entirely under
 * `prefers-reduced-motion: reduce`, leaving a static placeholder block.
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

// ─── SponsorStreamListSkeleton (#823) ──────────────────────────────────────────

/**
 * Sponsor stream list. Row widths deliberately vary so the placeholder reads as
 * a list of real records rather than a uniform grid.
 */
const SPONSOR_ROW_WIDTHS: string[][] = [
  ["70%", "45%", "55%"],
  ["55%", "60%", "40%"],
  ["80%", "35%", "65%"],
  ["62%", "50%", "48%"],
  ["72%", "42%", "58%"],
];

const MAX_SPONSOR_ROWS = 5;

export function SponsorStreamListSkeleton({ rows = 5 }: { rows?: number }) {
  const count = Math.min(rows, MAX_SPONSOR_ROWS);
  return (
    <ul
      style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: "0.75rem" }}
      aria-busy="true"
      aria-label="Loading sponsor streams"
    >
      {Array.from({ length: count }).map((_, i) => {
        const w = SPONSOR_ROW_WIDTHS[i % SPONSOR_ROW_WIDTHS.length]!;
        return (
          <li key={i} className={styles.streamCard} data-testid="sponsor-stream-skeleton-row" aria-hidden="true">
            <div className={styles.row} style={{ justifyContent: "space-between" }}>
              <div className={styles.stack} style={{ gap: "0.4rem" }}>
                <Skeleton width={w[0]!} height="0.9rem" />
                <Skeleton width={w[1]!} height="0.7rem" />
              </div>
              <Skeleton width="4.5rem" height="1.25rem" shape="rect" />
            </div>
            <Skeleton width="100%" height="0.5rem" shape="rect" />
          </li>
        );
      })}
    </ul>
  );
}

// ─── StreamExplorerSkeleton (#823) ─────────────────────────────────────────────

/**
 * Stream explorer table. Mirrors the explorer's column set so column widths
 * survive the load and the table doesn't reflow when data arrives.
 */
const EXPLORER_COLUMNS = ["2fr", "1.5fr", "1.25fr", "1fr"] as const;
const MAX_EXPLORER_ROWS = 6;

export function StreamExplorerSkeleton({ rows = 6 }: { rows?: number }) {
  const count = Math.min(rows, MAX_EXPLORER_ROWS);
  const cols = EXPLORER_COLUMNS.join(" ");
  return (
    <div className={styles.table} aria-busy="true" aria-label="Loading stream explorer">
      <div className={styles.tableHeader} style={{ gridTemplateColumns: cols }} aria-hidden="true">
        {EXPLORER_COLUMNS.map((_, i) => (
          <Skeleton key={i} width="70%" height="0.65rem" />
        ))}
      </div>
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className={styles.tableRow}
          data-testid="explorer-skeleton-row"
          style={{ gridTemplateColumns: cols }}
          aria-hidden="true"
        >
          {EXPLORER_COLUMNS.map((_, j) => (
            <Skeleton
              key={j}
              width={j === 0 ? "85%" : "65%"}
              height="0.875rem"
              style={{ fontFamily: j === 0 ? "monospace" : undefined }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

// ─── NotificationListSkeleton (#823) ───────────────────────────────────────────

/** Notification item: leading icon, two text lines, and a trailing timestamp. */
const MAX_NOTIFICATION_ITEMS = 6;

export function NotificationListSkeleton({ items = 4 }: { items?: number }) {
  const count = Math.min(items, MAX_NOTIFICATION_ITEMS);
  return (
    <ul
      style={{ listStyle: "none", padding: 0, margin: 0 }}
      aria-busy="true"
      aria-label="Loading notifications"
    >
      {Array.from({ length: count }).map((_, i) => (
        <li
          key={i}
          data-testid="notification-skeleton-item"
          aria-hidden="true"
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.75rem",
            padding: "0.875rem 1rem",
            borderBottom: "1px solid var(--color-border, #e5e7eb)",
          }}
        >
          <Skeleton width="2rem" height="2rem" shape="circle" />
          <div className={styles.stack} style={{ gap: "0.35rem" }}>
            <Skeleton width={i % 2 === 0 ? "60%" : "48%"} height="0.8rem" />
            <Skeleton width={i % 2 === 0 ? "40%" : "55%"} height="0.7rem" />
          </div>
          <Skeleton width="3.5rem" height="0.65rem" style={{ marginLeft: "auto" }} />
        </li>
      ))}
    </ul>
  );
}

// ─── AnalyticsSummarySkeleton (#823) ───────────────────────────────────────────

/** Analytics page: a row of stat cards above a chart placeholder. */
const ANALYTICS_CARDS = 4;
const CHART_BAR_HEIGHTS = [45, 70, 55, 85, 60, 75, 50, 90];

/**
 * Analytics summary. Pass `showChart={false}` for contexts that only render the
 * stat cards (e.g. the sponsor dashboard header), so no phantom chart is
 * reserved for content that will never appear.
 */
export function AnalyticsSummarySkeleton({
  cards = ANALYTICS_CARDS,
  showChart = true,
}: {
  cards?: number;
  showChart?: boolean;
}) {
  const count = Math.min(cards, ANALYTICS_CARDS);
  return (
    <div aria-busy="true" aria-label="Loading analytics">
      <div
        className={styles.statsGrid}
        style={{ gridTemplateColumns: `repeat(${count}, minmax(0, 1fr))` }}
      >
        {Array.from({ length: count }).map((_, i) => (
          <div key={i} className={styles.statCell} data-testid="analytics-skeleton-card" aria-hidden="true">
            <Skeleton width="55%" height="0.65rem" />
            <Skeleton width="70%" height="1.5rem" />
            <Skeleton width="40%" height="0.6rem" />
          </div>
        ))}
      </div>

      {/* Chart placeholder — fixed height so the page doesn't jump on load. */}
      {showChart && (
        <div
          aria-hidden="true"
          style={{
            height: "12rem",
            marginTop: "1rem",
            border: "1px solid var(--color-border, #e5e7eb)",
            borderRadius: "0.5rem",
            padding: "1rem",
            display: "flex",
            alignItems: "flex-end",
            gap: "0.5rem",
          }}
        >
          {CHART_BAR_HEIGHTS.map((h, i) => (
            <Skeleton key={i} width="100%" height={`${h}%`} shape="rect" style={{ flex: 1 }} />
          ))}
        </div>
      )}
    </div>
  );
}

