"use client";

import { useState, useEffect, useCallback } from "react";
import type { VestingStream } from "@/types";
import { StatusBadge } from "@/components/StatusBadge";
import { formatAmount } from "@/utils/formatAmount";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface StreamComparisonViewProps {
  streams: VestingStream[];
  onClose?: () => void;
}

const MAX_SELECTIONS = 3;

// Comparison row definitions
interface Row {
  key: keyof VestingStream | "statusBadge";
  label: string;
  format?: (v: unknown, s: VestingStream) => string;
}

const ROWS: Row[] = [
  { key: "recipient",     label: "Recipient",      format: (v) => String(v) },
  { key: "token",         label: "Token",           format: (v) => String(v) },
  { key: "rate",          label: "Rate (per ledger)", format: (v) => `${v} tokens` },
  { key: "cliffLedger",   label: "Cliff Ledger",    format: (v) => v != null ? String(v) : "—" },
  { key: "endLedger",     label: "End Ledger",      format: (v) => v != null ? String(v) : "—" },
  { key: "totalDeposit",  label: "Total Deposit",   format: (v) => v != null ? formatAmount(Number(v)) : "—" },
  { key: "totalVested",   label: "Total Claimed",   format: (v) => v != null ? formatAmount(Number(v)) : "—" },
  { key: "claimableAmount", label: "Claimable Now", format: (v) => formatAmount(Number(v)) },
  { key: "statusBadge",   label: "Status" },
];

// ── CSV export ────────────────────────────────────────────────────────────────

function exportCSV(selected: VestingStream[]) {
  const headers = ["Field", ...selected.map((s) => `Stream ${s.id} (${s.recipient})`)];
  const rowsData = ROWS.filter((r) => r.key !== "statusBadge").concat([
    { key: "status", label: "Status", format: (v) => String(v) },
  ]);

  const lines = [
    headers.join(","),
    ...rowsData.map((row) => {
      const cells = selected.map((s) => {
        const raw = s[row.key as keyof VestingStream];
        const val = row.format ? row.format(raw, s) : String(raw ?? "");
        // Escape CSV cells containing commas or quotes
        return val.includes(",") || val.includes('"') ? `"${val.replace(/"/g, '""')}"` : val;
      });
      return [row.label, ...cells].join(",");
    }),
  ];

  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const date = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = `stream-comparison-${date}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ── Difference detection ──────────────────────────────────────────────────────

function hasDifference(rowKey: Row["key"], selected: VestingStream[]): boolean {
  if (selected.length < 2) return false;
  const values = selected.map((s) => {
    const raw = s[rowKey as keyof VestingStream];
    return String(raw ?? "");
  });
  return new Set(values).size > 1;
}

// ── Mobile detection hook ─────────────────────────────────────────────────────

function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    setIsMobile(mq.matches);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);
  return isMobile;
}

// ── Stream selector ───────────────────────────────────────────────────────────

function StreamSelector({
  streams,
  selectedIds,
  onToggle,
}: {
  streams: VestingStream[];
  selectedIds: string[];
  onToggle: (id: string) => void;
}) {
  return (
    <div style={selectorStyles.container} role="group" aria-label="Select streams to compare">
      <p style={selectorStyles.hint}>
        Select up to {MAX_SELECTIONS} streams to compare:
      </p>
      <div style={selectorStyles.list}>
        {streams.map((s) => {
          const checked = selectedIds.includes(s.id);
          const disabled = !checked && selectedIds.length >= MAX_SELECTIONS;
          return (
            <label
              key={s.id}
              style={{
                ...selectorStyles.item,
                opacity: disabled ? 0.45 : 1,
                borderColor: checked
                  ? "var(--color-brand-primary, #7C3AED)"
                  : "var(--color-border, #334155)",
                background: checked
                  ? "rgba(124,58,237,0.12)"
                  : "var(--color-bg-elevated, #334155)",
                cursor: disabled ? "not-allowed" : "pointer",
              }}
            >
              <input
                type="checkbox"
                checked={checked}
                disabled={disabled}
                onChange={() => onToggle(s.id)}
                style={{ accentColor: "var(--color-brand-primary, #7C3AED)" }}
                aria-label={`Select stream for ${s.recipient}`}
              />
              <span style={selectorStyles.recipient}>{s.recipient}</span>
              <span style={selectorStyles.token}>{s.token}</span>
              <span
                style={{
                  ...selectorStyles.statusDot,
                  background: STATUS_COLORS[s.status] ?? "#94A3B8",
                }}
                aria-hidden="true"
              />
            </label>
          );
        })}
      </div>
    </div>
  );
}

const STATUS_COLORS: Record<string, string> = {
  active: "#10B981",
  "pre-cliff": "#F59E0B",
  completed: "#94A3B8",
  cancelled: "#EF4444",
};

const selectorStyles = {
  container: {
    display: "flex" as const,
    flexDirection: "column" as const,
    gap: "0.5rem",
  },
  hint: {
    margin: 0,
    fontSize: "0.8125rem",
    color: "var(--color-text-secondary, #94A3B8)",
  },
  list: {
    display: "flex" as const,
    flexWrap: "wrap" as const,
    gap: "0.5rem",
  },
  item: {
    display: "flex" as const,
    alignItems: "center",
    gap: "0.375rem",
    padding: "0.375rem 0.625rem",
    borderRadius: "0.5rem",
    border: "1px solid",
    fontSize: "0.8125rem",
    userSelect: "none" as const,
    transition: "border-color 150ms, background 150ms",
  },
  recipient: {
    color: "var(--color-text-primary, #F8FAFC)",
    fontFamily: "var(--font-family-mono, monospace)",
    fontSize: "0.75rem",
  },
  token: {
    color: "var(--color-text-secondary, #94A3B8)",
    fontSize: "0.75rem",
  },
  statusDot: {
    width: "7px",
    height: "7px",
    borderRadius: "50%",
    flexShrink: 0,
  },
};

export { ROWS, MAX_SELECTIONS, hasDifference, useIsMobile, exportCSV, STATUS_COLORS };

// ── Comparison table (desktop) ────────────────────────────────────────────────

function ComparisonTable({ selected }: { selected: VestingStream[] }) {
  if (selected.length === 0) return null;

  return (
    <div style={{ overflowX: "auto" }}>
      <table
        aria-label="Stream comparison table"
        style={tableStyles.table}
      >
        <caption style={tableStyles.caption}>
          Comparing {selected.length} vesting stream{selected.length > 1 ? "s" : ""}
        </caption>
        <thead>
          <tr>
            <th scope="col" style={tableStyles.cornerTh}>Field</th>
            {selected.map((s) => (
              <th
                key={s.id}
                scope="col"
                style={tableStyles.colTh}
                aria-label={`Stream for ${s.recipient}`}
              >
                <span style={tableStyles.colRecipient}>{s.recipient}</span>
                <span style={tableStyles.colToken}>{s.token}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {ROWS.map((row) => {
            const isDiff = hasDifference(row.key, selected);
            return (
              <tr
                key={row.key}
                style={isDiff ? tableStyles.diffRow : tableStyles.normalRow}
                aria-label={isDiff ? `${row.label} — values differ` : undefined}
              >
                <th scope="row" style={tableStyles.rowTh}>
                  {row.label}
                  {isDiff && (
                    <span
                      title="Values differ"
                      aria-label="Values differ"
                      style={tableStyles.diffBadge}
                    >
                      ≠
                    </span>
                  )}
                </th>
                {selected.map((s) => {
                  const raw = s[row.key as keyof VestingStream];
                  return (
                    <td
                      key={s.id}
                      style={{
                        ...tableStyles.cell,
                        background: isDiff
                          ? "rgba(245,158,11,0.1)"
                          : "transparent",
                        fontWeight: isDiff ? 500 : undefined,
                      }}
                    >
                      {row.key === "statusBadge" ? (
                        <StatusBadge status={s.status} />
                      ) : row.format ? (
                        row.format(raw, s)
                      ) : (
                        String(raw ?? "—")
                      )}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const tableStyles = {
  table: {
    width: "100%",
    borderCollapse: "collapse" as const,
    fontSize: "0.875rem",
    color: "var(--color-text-primary, #F8FAFC)",
  },
  caption: {
    textAlign: "left" as const,
    fontSize: "0.75rem",
    color: "var(--color-text-secondary, #94A3B8)",
    marginBottom: "0.5rem",
    captionSide: "top" as const,
    paddingBottom: "0.5rem",
  },
  cornerTh: {
    padding: "0.625rem 1rem",
    background: "var(--color-bg-elevated, #334155)",
    borderBottom: "1px solid var(--color-border, #334155)",
    textAlign: "left" as const,
    fontWeight: 600,
    color: "var(--color-text-secondary, #94A3B8)",
    fontSize: "0.75rem",
    textTransform: "uppercase" as const,
    letterSpacing: "0.05em",
    minWidth: "140px",
  },
  colTh: {
    padding: "0.625rem 1rem",
    background: "var(--color-bg-elevated, #334155)",
    borderBottom: "1px solid var(--color-border, #334155)",
    borderLeft: "1px solid var(--color-border, #334155)",
    textAlign: "left" as const,
    minWidth: "200px",
  },
  colRecipient: {
    display: "block",
    fontFamily: "var(--font-family-mono, monospace)",
    fontSize: "0.8125rem",
    color: "var(--color-text-primary, #F8FAFC)",
    fontWeight: 600,
  },
  colToken: {
    display: "block",
    fontSize: "0.75rem",
    color: "var(--color-text-secondary, #94A3B8)",
    fontWeight: 400,
  },
  rowTh: {
    padding: "0.5rem 1rem",
    textAlign: "left" as const,
    fontWeight: 500,
    color: "var(--color-text-secondary, #94A3B8)",
    background: "var(--color-bg-surface, #1E293B)",
    borderBottom: "1px solid var(--color-border, #334155)",
    whiteSpace: "nowrap" as const,
  },
  diffBadge: {
    marginLeft: "0.375rem",
    fontSize: "0.6875rem",
    color: "var(--color-warning, #F59E0B)",
    fontWeight: 700,
    verticalAlign: "middle",
  },
  cell: {
    padding: "0.5rem 1rem",
    borderBottom: "1px solid var(--color-border, #334155)",
    borderLeft: "1px solid var(--color-border, #334155)",
    verticalAlign: "middle",
    transition: "background 150ms",
  },
  normalRow: { background: "transparent" },
  diffRow: { background: "transparent" },
};

// ── Shared timeline (SVG) ─────────────────────────────────────────────────────

const TIMELINE_COLORS = ["#7C3AED", "#06B6D4", "#10B981"];

function SharedTimeline({ selected }: { selected: VestingStream[] }) {
  const hasLedgerData = selected.some(
    (s) => s.startLedger != null && s.endLedger != null
  );

  if (!hasLedgerData) {
    return (
      <p style={timelineStyles.noData}>
        Timeline requires ledger data — not available for all selected streams.
      </p>
    );
  }

  const allLedgers = selected.flatMap((s) =>
    [s.startLedger, s.cliffLedger, s.endLedger].filter(Boolean) as number[]
  );
  const minLedger = Math.min(...allLedgers);
  const maxLedger = Math.max(...allLedgers);
  const range = maxLedger - minLedger || 1;

  const svgWidth = 560;
  const barHeight = 22;
  const barGap = 12;
  const labelWidth = 80;
  const chartWidth = svgWidth - labelWidth - 16;
  const svgHeight = selected.length * (barHeight + barGap) + 40;

  function ledgerToX(ledger: number) {
    return labelWidth + ((ledger - minLedger) / range) * chartWidth;
  }

  return (
    <div style={timelineStyles.container}>
      <svg
        viewBox={`0 0 ${svgWidth} ${svgHeight}`}
        width="100%"
        aria-label="Shared stream timeline"
        role="img"
        style={{ display: "block" }}
      >
        {/* X-axis labels */}
        <text x={labelWidth} y={svgHeight - 6} fontSize="10" fill="#94A3B8">
          Ledger {minLedger.toLocaleString()}
        </text>
        <text
          x={svgWidth - 8}
          y={svgHeight - 6}
          fontSize="10"
          fill="#94A3B8"
          textAnchor="end"
        >
          {maxLedger.toLocaleString()}
        </text>

        {selected.map((s, i) => {
          const color = TIMELINE_COLORS[i % TIMELINE_COLORS.length];
          const y = i * (barHeight + barGap) + 16;
          const start = s.startLedger ?? minLedger;
          const cliff = s.cliffLedger ?? start;
          const end = s.endLedger ?? maxLedger;

          const x1 = ledgerToX(start);
          const xCliff = ledgerToX(cliff);
          const x2 = ledgerToX(end);

          return (
            <g key={s.id} aria-label={`Stream ${s.id}: ${s.recipient}`}>
              {/* Label */}
              <text
                x={labelWidth - 6}
                y={y + barHeight / 2 + 4}
                fontSize="10"
                fill="#94A3B8"
                textAnchor="end"
              >
                {s.recipient.length > 9
                  ? s.recipient.slice(0, 4) + "…" + s.recipient.slice(-4)
                  : s.recipient}
              </text>
              {/* Pre-cliff segment (grey/locked) */}
              <rect
                x={x1}
                y={y}
                width={Math.max(0, xCliff - x1)}
                height={barHeight}
                rx="3"
                fill="#475569"
                opacity="0.7"
              />
              {/* Post-cliff segment (colored/active) */}
              <rect
                x={xCliff}
                y={y}
                width={Math.max(0, x2 - xCliff)}
                height={barHeight}
                rx="3"
                fill={color}
                opacity="0.85"
              />
              {/* Cliff tick */}
              {cliff !== start && (
                <line
                  x1={xCliff}
                  y1={y - 2}
                  x2={xCliff}
                  y2={y + barHeight + 2}
                  stroke="#F59E0B"
                  strokeWidth="1.5"
                  strokeDasharray="3 2"
                />
              )}
            </g>
          );
        })}

        {/* Legend */}
        <rect x={labelWidth} y={svgHeight - 26} width={12} height={8} rx="2" fill="#475569" opacity="0.7" />
        <text x={labelWidth + 16} y={svgHeight - 20} fontSize="9" fill="#94A3B8">Locked (pre-cliff)</text>
        <rect x={labelWidth + 110} y={svgHeight - 26} width={12} height={8} rx="2" fill="#7C3AED" opacity="0.85" />
        <text x={labelWidth + 126} y={svgHeight - 20} fontSize="9" fill="#94A3B8">Active (drip)</text>
      </svg>
    </div>
  );
}

const timelineStyles = {
  container: {
    background: "var(--color-bg-elevated, #334155)",
    borderRadius: "0.5rem",
    padding: "1rem",
    overflowX: "auto" as const,
  },
  noData: {
    margin: 0,
    fontSize: "0.8125rem",
    color: "var(--color-text-secondary, #94A3B8)",
    fontStyle: "italic",
    padding: "1rem",
    background: "var(--color-bg-elevated, #334155)",
    borderRadius: "0.5rem",
    textAlign: "center" as const,
  },
};

// ── Mobile stacked cards ──────────────────────────────────────────────────────

function MobileCards({ selected }: { selected: VestingStream[] }) {
  if (selected.length === 0) return null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      {selected.map((s, i) => (
        <div key={s.id} style={cardStyles.card}>
          <div style={cardStyles.header}>
            <span style={cardStyles.recipient}>{s.recipient}</span>
            <StatusBadge status={s.status} />
          </div>
          <dl style={cardStyles.dl}>
            {ROWS.filter((r) => r.key !== "statusBadge").map((row) => {
              const raw = s[row.key as keyof VestingStream];
              const value = row.format ? row.format(raw, s) : String(raw ?? "—");
              const isDiff = hasDifference(row.key, selected);
              return (
                <div
                  key={row.key}
                  style={{
                    ...cardStyles.row,
                    background: isDiff ? "rgba(245,158,11,0.1)" : "transparent",
                    borderLeft: isDiff
                      ? "3px solid var(--color-warning, #F59E0B)"
                      : "3px solid transparent",
                  }}
                >
                  <dt style={cardStyles.dt}>
                    {row.label}
                    {isDiff && <span style={cardStyles.diffTag}>differs</span>}
                  </dt>
                  <dd style={cardStyles.dd}>{value}</dd>
                </div>
              );
            })}
          </dl>
        </div>
      ))}
    </div>
  );
}

const cardStyles = {
  card: {
    background: "var(--color-bg-surface, #1E293B)",
    border: "1px solid var(--color-border, #334155)",
    borderRadius: "0.75rem",
    overflow: "hidden",
  },
  header: {
    display: "flex" as const,
    alignItems: "center",
    justifyContent: "space-between",
    padding: "0.75rem 1rem",
    background: "var(--color-bg-elevated, #334155)",
    borderBottom: "1px solid var(--color-border, #334155)",
  },
  recipient: {
    fontFamily: "var(--font-family-mono, monospace)",
    fontSize: "0.8125rem",
    color: "var(--color-text-primary, #F8FAFC)",
    fontWeight: 600,
  },
  dl: {
    margin: 0,
    padding: 0,
  },
  row: {
    display: "flex" as const,
    justifyContent: "space-between",
    alignItems: "center",
    padding: "0.5rem 1rem",
    borderBottom: "1px solid var(--color-border, #334155)",
    gap: "1rem",
    paddingLeft: "0.75rem",
    transition: "background 150ms",
  },
  dt: {
    fontSize: "0.8125rem",
    color: "var(--color-text-secondary, #94A3B8)",
    fontWeight: 500,
    display: "flex" as const,
    alignItems: "center",
    gap: "0.375rem",
    flexShrink: 0,
  },
  dd: {
    margin: 0,
    fontSize: "0.8125rem",
    color: "var(--color-text-primary, #F8FAFC)",
    textAlign: "right" as const,
    fontFamily: "var(--font-family-mono, monospace)",
  },
  diffTag: {
    fontSize: "0.625rem",
    background: "var(--color-warning, #F59E0B)",
    color: "#000",
    borderRadius: "2px",
    padding: "1px 4px",
    fontWeight: 700,
    fontFamily: "sans-serif",
  },
};

// ── Main component ────────────────────────────────────────────────────────────

export function StreamComparisonView({ streams, onClose }: StreamComparisonViewProps) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const isMobile = useIsMobile();

  const toggle = useCallback((id: string) => {
    setSelectedIds((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= MAX_SELECTIONS) return prev;
      return [...prev, id];
    });
  }, []);

  const selected = streams.filter((s) => selectedIds.includes(s.id));

  return (
    <div style={rootStyles.backdrop} role="dialog" aria-modal="true" aria-label="Stream comparison">
      <div style={rootStyles.panel}>
        {/* Header */}
        <div style={rootStyles.header}>
          <div>
            <h2 style={rootStyles.title}>Compare Streams</h2>
            <p style={rootStyles.subtitle}>
              Select up to 3 streams. Highlighted rows show differences.
            </p>
          </div>
          <div style={rootStyles.headerActions}>
            {selected.length >= 2 && (
              <button
                type="button"
                onClick={() => exportCSV(selected)}
                style={rootStyles.exportBtn}
                aria-label="Export comparison as CSV"
              >
                Export CSV
              </button>
            )}
            {onClose && (
              <button
                type="button"
                onClick={onClose}
                style={rootStyles.closeBtn}
                aria-label="Close comparison view"
              >
                ✕
              </button>
            )}
          </div>
        </div>

        {/* Stream selector */}
        <StreamSelector
          streams={streams}
          selectedIds={selectedIds}
          onToggle={toggle}
        />

        {/* Empty state */}
        {selected.length === 0 && (
          <div style={rootStyles.emptyState} role="status">
            <span style={{ fontSize: "2rem" }} aria-hidden="true">📊</span>
            <p style={{ margin: 0, color: "var(--color-text-secondary, #94A3B8)", fontSize: "0.875rem" }}>
              Select two or more streams above to see a side-by-side comparison.
            </p>
          </div>
        )}

        {/* Comparison content */}
        {selected.length > 0 && (
          <>
            <section aria-label="Comparison details">
              {isMobile ? (
                <MobileCards selected={selected} />
              ) : (
                <ComparisonTable selected={selected} />
              )}
            </section>

            {/* Timeline */}
            <section aria-label="Shared timeline">
              <h3 style={rootStyles.sectionTitle}>Timeline</h3>
              <SharedTimeline selected={selected} />
            </section>
          </>
        )}
      </div>
    </div>
  );
}

const rootStyles = {
  backdrop: {
    position: "fixed" as const,
    inset: 0,
    background: "rgba(0,0,0,0.55)",
    zIndex: 200,
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "center",
    padding: "2rem 1rem",
    overflowY: "auto" as const,
  },
  panel: {
    background: "var(--color-bg-surface, #1E293B)",
    borderRadius: "1rem",
    border: "1px solid var(--color-border, #334155)",
    width: "100%",
    maxWidth: "900px",
    display: "flex" as const,
    flexDirection: "column" as const,
    gap: "1.5rem",
    padding: "1.5rem",
    boxShadow: "0 20px 40px rgba(0,0,0,0.5)",
  },
  header: {
    display: "flex" as const,
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: "1rem",
  },
  title: {
    margin: 0,
    fontSize: "1.25rem",
    fontWeight: 700,
    color: "var(--color-text-primary, #F8FAFC)",
    lineHeight: 1.25,
  },
  subtitle: {
    margin: "0.25rem 0 0",
    fontSize: "0.8125rem",
    color: "var(--color-text-secondary, #94A3B8)",
  },
  headerActions: {
    display: "flex" as const,
    gap: "0.5rem",
    alignItems: "center",
    flexShrink: 0,
  },
  exportBtn: {
    padding: "0.375rem 0.875rem",
    background: "var(--color-brand-primary, #7C3AED)",
    color: "#fff",
    border: "none",
    borderRadius: "0.5rem",
    fontSize: "0.8125rem",
    fontWeight: 500,
    cursor: "pointer",
  },
  closeBtn: {
    padding: "0.375rem 0.625rem",
    background: "transparent",
    color: "var(--color-text-secondary, #94A3B8)",
    border: "1px solid var(--color-border, #334155)",
    borderRadius: "0.5rem",
    fontSize: "1rem",
    cursor: "pointer",
    lineHeight: 1,
  },
  emptyState: {
    display: "flex" as const,
    flexDirection: "column" as const,
    alignItems: "center",
    justifyContent: "center",
    gap: "0.75rem",
    padding: "3rem 1.5rem",
    textAlign: "center" as const,
    background: "var(--color-bg-elevated, #334155)",
    borderRadius: "0.75rem",
  },
  sectionTitle: {
    margin: "0 0 0.75rem",
    fontSize: "0.875rem",
    fontWeight: 600,
    color: "var(--color-text-secondary, #94A3B8)",
    textTransform: "uppercase" as const,
    letterSpacing: "0.05em",
  },
};
