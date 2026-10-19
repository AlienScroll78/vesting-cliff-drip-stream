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

/** Generic full-page loading skeleton for routes with no specific skeleton. */
export function FullPageSkeleton() {
  return (
    <div
      style={{ padding: "2rem", maxWidth: 720, margin: "0 auto" }}
      aria-busy="true"
      aria-label="Loading page"
    >
      <Skeleton width="40%" height="1.75rem" style={{ marginBottom: "1.5rem" }} />
      <Skeleton width="100%" height="1rem" style={{ marginBottom: "0.5rem" }} />
      <Skeleton width="80%" height="1rem" style={{ marginBottom: "1.5rem" }} />
      <Skeleton width="100%" height="8rem" shape="rect" style={{ borderRadius: "0.5rem" }} />
    </div>
  );
}

// ─── SponsorStreamListSkeleton (#823) ─────────────────────────────────────────

/**
 * Sponsor stream list rows.
 * Text widths vary row-to-row so the placeholder reads as a list of real records
 * rather than a uniform grid.  Capped at 5 rows.
 */
const MAX_SPONSOR_ROWS = 5;

// Width sequences for recipient, rate, cliff, status columns per row.
const SPONSOR_ROW_WIDTHS = [
  ["70%", "55%", "60%", "4rem"],
  ["85%", "45%", "75%", "4.5rem"],
  ["60%", "65%", "50%", "4rem"],
  ["78%", "50%", "68%", "5rem"],
  ["65%", "60%", "55%", "4rem"],
];

export function SponsorStreamListSkeleton({ rows = 5 }: { rows?: number }) {
  const count = Math.min(rows, MAX_SPONSOR_ROWS);
  return (
    <ul
      className={styles.sponsorStreamList}
      aria-busy="true"
      aria-label="Loading sponsor streams"
    >
      {Array.from({ length: count }).map((_, i) => {
        const [w0, w1, w2, w3] = SPONSOR_ROW_WIDTHS[i % SPONSOR_ROW_WIDTHS.length];
        return (
          <li key={i} className={styles.sponsorStreamRow} data-testid="sponsor-stream-skeleton-row" aria-hidden="true">
            <Skeleton width={w0} height="0.875rem" />
            <Skeleton width={w1} height="0.875rem" />
            <Skeleton width={w2} height="0.875rem" />
            <Skeleton width={w3} height="1.5rem" shape="circle" />
            <Skeleton width="0.75rem" height="0.75rem" shape="circle" />
          </li>
        );
      })}
    </ul>
  );
}

// ─── StreamExplorerSkeleton (#823) ────────────────────────────────────────────

/**
 * Explorer table rows.  5-column layout: recipient, token, rate, cliff, status.
 * Column widths are fixed while loading so the table doesn't reflow when data
 * arrives.
 */
const MAX_EXPLORER_ROWS = 10;

export function StreamExplorerSkeleton({ rows = 5 }: { rows?: number }) {
  const count = Math.min(rows, MAX_EXPLORER_ROWS);
  return (
    <div
      className={styles.explorerTable}
      aria-busy="true"
      aria-label="Loading stream explorer"
    >
      {/* Column headers */}
      <div className={styles.explorerHeader} aria-hidden="true">
        {["50%", "40%", "35%", "40%", "45%"].map((w, i) => (
          <Skeleton key={i} width={w} height="0.65rem" />
        ))}
      </div>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className={styles.explorerRow} data-testid="explorer-skeleton-row" aria-hidden="true">
          <Skeleton width="80%" height="0.875rem" />
          <Skeleton width="65%" height="0.875rem" />
          <Skeleton width="55%" height="0.875rem" />
          <Skeleton width="60%" height="0.875rem" />
          <Skeleton width="4.5rem" height="1.5rem" shape="circle" />
        </div>
      ))}
    </div>
  );
}

// ─── NotificationListSkeleton (#823) ──────────────────────────────────────────

/**
 * Notification items: leading icon circle, title + body text lines, trailing
 * timestamp placeholder.  Capped at 8 items.
 */
const MAX_NOTIFICATION_ITEMS = 8;

export function NotificationListSkeleton({ items = 4 }: { items?: number }) {
  const count = Math.min(items, MAX_NOTIFICATION_ITEMS);
  return (
    <ul
      className={styles.notificationList}
      aria-busy="true"
      aria-label="Loading notifications"
    >
      {Array.from({ length: count }).map((_, i) => (
        <li key={i} className={styles.notificationItem} data-testid="notification-skeleton-item" aria-hidden="true">
          {/* Icon */}
          <Skeleton width="2rem" height="2rem" shape="circle" />
          {/* Text body */}
          <div className={styles.notificationBody}>
            <Skeleton width={i % 2 === 0 ? "75%" : "85%"} height="0.85rem" />
            <Skeleton width={i % 2 === 0 ? "55%" : "65%"} height="0.75rem" />
          </div>
          {/* Timestamp */}
          <Skeleton width="3rem" height="0.65rem" />
        </li>
      ))}
    </ul>
  );
}

// ─── AnalyticsSummarySkeleton (#823) ─────────────────────────────────────────

/**
 * Analytics page: a row of stat cards above a fixed-height chart placeholder.
 * Prevents the page from jumping when data arrives.
 * Pass `showChart={false}` for pages that never show a chart.
 */
const MAX_ANALYTICS_CARDS = 8;

export function AnalyticsSummarySkeleton({
  cards = 4,
  showChart = true,
}: {
  cards?: number;
  showChart?: boolean;
}) {
  const count = Math.min(cards, MAX_ANALYTICS_CARDS);
  return (
    <div
      className={styles.analyticsSummary}
      aria-busy="true"
      aria-label="Loading analytics"
    >
      {/* Stat cards */}
      <div className={styles.analyticsCards}>
        {Array.from({ length: count }).map((_, i) => (
          <div key={i} className={styles.analyticsCard} data-testid="analytics-skeleton-card" aria-hidden="true">
            <Skeleton width="50%" height="0.65rem" />
            <Skeleton width="65%" height="1.5rem" />
            <Skeleton width="40%" height="0.65rem" />
          </div>
        ))}
      </div>
      {/* Chart placeholder */}
      {showChart && (
        <div className={styles.analyticsChart} aria-hidden="true">
          <Skeleton width="100%" height="14rem" shape="rect" style={{ borderRadius: 0 }} />
        </div>
      )}
    </div>
  );
}

// ─── DashboardStatsSkeleton ───────────────────────────────────────────────────

/**
 * Dashboard stats row: up to 4 stat cards in a responsive grid.
 * Each card has a label, a large metric value, and a small trend line.
 * Used at the top of both the recipient and sponsor dashboards.
 */
export function DashboardStatsSkeleton({ count = 4 }: { count?: number }) {
  const safeCount = Math.min(count, 4);
  return (
    <div
      className={styles.dashboardStats}
      aria-busy="true"
      aria-label="Loading dashboard stats"
    >
      {Array.from({ length: safeCount }).map((_, i) => (
        <div key={i} className={styles.dashboardStatCard} data-testid="dashboard-stat-skeleton-card" aria-hidden="true">
          <Skeleton width="50%" height="0.65rem" />
          <Skeleton width="70%" height="1.75rem" />
          <Skeleton width="40%" height="0.65rem" />
        </div>
      ))}
    </div>
  );
}

// ─── StreamTableRowSkeleton ───────────────────────────────────────────────────

/**
 * A single row in the stream table (5-column: recipient, token, rate, cliff,
 * status). Compose multiples inside a `<div role="table">` wrapper.
 */
export function StreamTableRowSkeleton() {
  return (
    <div className={styles.streamTableRow} data-testid="stream-table-row-skeleton" aria-hidden="true">
      <Skeleton width="75%" height="0.875rem" />
      <Skeleton width="55%" height="0.875rem" />
      <Skeleton width="60%" height="0.875rem" />
      <Skeleton width="50%" height="0.875rem" />
      <Skeleton width="4.5rem" height="1.5rem" shape="circle" />
    </div>
  );
}
