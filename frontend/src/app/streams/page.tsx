"use client";
/**
 * Sponsor Streams Page (#277)
 *
 * Extended dashboard for sponsors managing many streams simultaneously.
 * Features:
 * - Toggle between card view and table view (persisted in localStorage)
 * - Sort by: claimable amount, cliff date, end date, recipient address
 * - Filter by: stream status (pre-cliff, active, expired), token
 * - Bulk select streams for batch cancel (sponsor only)
 * - Keyboard-accessible sort/filter controls
 */

import { useState, useCallback, useEffect, useMemo } from "react";
import { StatusBadge } from "@/components/StatusBadge";
import {
  SponsorStreamListEmpty,
  SearchResultsEmpty,
  SponsorDashboardEmpty,
} from "@/components/EmptyStates";
import { StreamListSkeleton } from "@/components/Skeletons";
import { CancelConfirmModal } from "@/components/CancelConfirmModal";
import { useStreams, StreamFilter } from "@/hooks/useStreams";
import { VestingStream, StreamStatus } from "@/types";
import { abbreviateAmount } from "@/utils/formatAmount";

// ── Types ─────────────────────────────────────────────────────────────────────

type ViewMode = "card" | "table";

type SortField = "claimableAmount" | "cliffLedger" | "endLedger" | "recipient";
type SortDir = "asc" | "desc";

interface SortState {
  field: SortField;
  dir: SortDir;
}

// ── localStorage key ──────────────────────────────────────────────────────────

const VIEW_PREF_KEY = "vesting-stream-view";

function loadViewPref(): ViewMode {
  try {
    const v = localStorage.getItem(VIEW_PREF_KEY);
    return v === "table" ? "table" : "card";
  } catch {
    return "card";
  }
}

function saveViewPref(v: ViewMode) {
  try {
    localStorage.setItem(VIEW_PREF_KEY, v);
  } catch { /* ignore */ }
}

// ── CSV export ────────────────────────────────────────────────────────────────

function exportCsv(streams: VestingStream[]) {
  const header = ["ID", "Recipient", "Token", "Rate", "Cliff Ledger", "End Ledger", "Status"];
  const rows = streams.map((s) => [
    s.id,
    s.recipient,
    s.token,
    String(s.rate),
    String(s.cliffLedger ?? ""),
    String(s.endLedger ?? ""),
    s.status,
  ]);
  const csv = [header, ...rows].map((r) => r.map((v) => `"${v}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "streams.csv";
  a.click();
  URL.revokeObjectURL(url);
}

// ── Cancel amounts helper ─────────────────────────────────────────────────────

function computeCancelAmounts(s: VestingStream) {
  const cliffReached = s.status === "active";
  const recipientAmount = cliffReached ? s.claimableAmount : 0;
  const total = s.totalDeposit ?? s.rate * 300;
  const sponsorRefund = Math.max(0, total - recipientAmount);
  return { recipientAmount, sponsorRefund, cliffReached };
}

// ── Status filter options ──────────────────────────────────────────────────────

const STATUS_FILTERS: { value: StreamFilter; label: string }[] = [
  { value: "all",       label: "All" },
  { value: "active",    label: "Active" },
  { value: "pre-cliff", label: "Pre-cliff" },
  { value: "completed", label: "Completed" },
  { value: "cancelled", label: "Cancelled" },
];

// ── Sort options ──────────────────────────────────────────────────────────────

const SORT_OPTIONS: { value: SortField; label: string }[] = [
  { value: "claimableAmount", label: "Claimable" },
  { value: "cliffLedger",    label: "Cliff date" },
  { value: "endLedger",      label: "End date" },
  { value: "recipient",      label: "Recipient" },
];

// ── Sort logic ────────────────────────────────────────────────────────────────

function sortStreams(streams: VestingStream[], sort: SortState): VestingStream[] {
  return [...streams].sort((a, b) => {
    let cmp = 0;
    switch (sort.field) {
      case "claimableAmount":
        cmp = a.claimableAmount - b.claimableAmount;
        break;
      case "cliffLedger":
        cmp = (a.cliffLedger ?? Infinity) - (b.cliffLedger ?? Infinity);
        break;
      case "endLedger":
        cmp = (a.endLedger ?? Infinity) - (b.endLedger ?? Infinity);
        break;
      case "recipient":
        cmp = a.recipient.localeCompare(b.recipient);
        break;
    }
    return sort.dir === "asc" ? cmp : -cmp;
  });
}

// ── Table styles ──────────────────────────────────────────────────────────────

const thStyle: React.CSSProperties = {
  padding: "0.6rem 0.75rem",
  fontWeight: 700,
  whiteSpace: "nowrap",
  textAlign: "left",
};

const tdStyle: React.CSSProperties = {
  padding: "0.65rem 0.75rem",
  verticalAlign: "middle",
};

// ── Sort header button ────────────────────────────────────────────────────────

function SortButton({
  field,
  label,
  sort,
  onSort,
}: {
  field: SortField;
  label: string;
  sort: SortState;
  onSort: (f: SortField) => void;
}) {
  const active = sort.field === field;
  return (
    <button
      type="button"
      onClick={() => onSort(field)}
      aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
      style={{
        background: "none",
        border: "none",
        cursor: "pointer",
        fontWeight: 700,
        fontSize: "inherit",
        padding: 0,
        color: active ? "var(--color-active)" : "inherit",
        display: "flex",
        alignItems: "center",
        gap: "0.25rem",
        whiteSpace: "nowrap",
      }}
    >
      {label}
      {active && <span aria-hidden="true">{sort.dir === "asc" ? " ↑" : " ↓"}</span>}
    </button>
  );
}

// ── Bulk cancel confirmation ───────────────────────────────────────────────────

function BulkCancelBar({
  count,
  onConfirm,
  onClear,
}: {
  count: number;
  onConfirm: () => void;
  onClear: () => void;
}) {
  if (count === 0) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        display: "flex",
        alignItems: "center",
        gap: "0.75rem",
        padding: "0.6rem 1rem",
        background: "#fef2f2",
        border: "1px solid #fecaca",
        borderRadius: "var(--radius)",
        marginBottom: "1rem",
        flexWrap: "wrap",
      }}
    >
      <span style={{ fontWeight: 600, color: "#991b1b" }}>
        {count} stream{count !== 1 ? "s" : ""} selected
      </span>
      <button
        type="button"
        className="btn btn-outline"
        style={{
          padding: "0.25rem 0.875rem",
          fontSize: "0.875rem",
          borderColor: "var(--color-cancelled)",
          color: "var(--color-cancelled)",
        }}
        onClick={onConfirm}
      >
        Cancel selected
      </button>
      <button
        type="button"
        className="btn btn-ghost"
        style={{ padding: "0.25rem 0.5rem", fontSize: "0.875rem" }}
        onClick={onClear}
      >
        Clear selection
      </button>
    </div>
  );
}

// ── Card view ─────────────────────────────────────────────────────────────────

function StreamCardView({
  streams,
  selected,
  onToggleSelect,
  onCancel,
}: {
  streams: VestingStream[];
  selected: Set<string>;
  onToggleSelect: (id: string) => void;
  onCancel: (s: VestingStream) => void;
}) {
  return (
    <ul className="stream-list" aria-label="Streams" style={{ marginTop: "1rem" }}>
      {streams.map((s) => {
        const isSelectable = s.status === "active" || s.status === "pre-cliff";
        const isSelected = selected.has(s.id);
        return (
          <li
            key={s.id}
            className="stream-card"
            style={{
              outline: isSelected ? "2px solid var(--color-active)" : undefined,
              outlineOffset: isSelected ? 2 : undefined,
            }}
            data-testid={`stream-card-${s.id}`}
          >
            <div className="stream-card-row" style={{ alignItems: "flex-start" }}>
              {/* Checkbox */}
              {isSelectable && (
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => onToggleSelect(s.id)}
                  aria-label={`Select stream for ${s.recipient}`}
                  style={{ marginTop: "0.2rem", flexShrink: 0 }}
                />
              )}
              <div style={{ flex: 1 }}>
                <div style={{ fontFamily: "monospace", fontSize: "0.85rem" }}>{s.recipient}</div>
                <div style={{ marginTop: "0.25rem" }}>
                  <StatusBadge status={s.status as StreamStatus} />
                  <span style={{ marginLeft: "0.5rem", fontSize: "0.8rem", color: "#6b7280" }}>
                    {s.token}
                  </span>
                </div>
                <div style={{ fontSize: "0.8rem", color: "#6b7280", marginTop: "0.25rem" }}>
                  {s.cliffLedger && <>Cliff: {s.cliffLedger.toLocaleString()}</>}
                  {s.cliffLedger && s.endLedger && <span aria-hidden="true"> · </span>}
                  {s.endLedger && <>End: {s.endLedger.toLocaleString()}</>}
                </div>
              </div>
              <div style={{ textAlign: "right", flexShrink: 0 }}>
                <div style={{ fontWeight: 700 }}>
                  {abbreviateAmount(s.claimableAmount)} {s.token}
                </div>
                {isSelectable && (
                  <button
                    type="button"
                    className="btn btn-outline"
                    style={{
                      marginTop: "0.5rem",
                      padding: "0.25rem 0.75rem",
                      fontSize: "0.8rem",
                      borderColor: "var(--color-cancelled)",
                      color: "var(--color-cancelled)",
                    }}
                    onClick={() => onCancel(s)}
                    data-testid={`cancel-btn-${s.id}`}
                    aria-label={`Cancel stream for ${s.recipient}`}
                  >
                    Cancel
                  </button>
                )}
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

// ── Table view ────────────────────────────────────────────────────────────────

function StreamTableView({
  streams,
  selected,
  sort,
  onSort,
  onToggleSelect,
  onToggleAll,
  onCancel,
}: {
  streams: VestingStream[];
  selected: Set<string>;
  sort: SortState;
  onSort: (f: SortField) => void;
  onToggleSelect: (id: string) => void;
  onToggleAll: (selectAll: boolean) => void;
  onCancel: (s: VestingStream) => void;
}) {
  const selectableStreams = streams.filter(
    (s) => s.status === "active" || s.status === "pre-cliff"
  );
  const allSelected =
    selectableStreams.length > 0 && selectableStreams.every((s) => selected.has(s.id));

  return (
    <div style={{ overflowX: "auto" }}>
      <table
        style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.875rem" }}
        aria-label="Sponsor streams"
        data-testid="streams-table"
      >
        <thead>
          <tr style={{ borderBottom: "2px solid var(--color-border)" }}>
            <th style={{ ...thStyle, width: "2.5rem" }}>
              <input
                type="checkbox"
                checked={allSelected}
                onChange={(e) => onToggleAll(e.target.checked)}
                aria-label="Select all cancellable streams"
                disabled={selectableStreams.length === 0}
              />
            </th>
            <th style={thStyle}>
              <SortButton field="recipient" label="Recipient" sort={sort} onSort={onSort} />
            </th>
            <th style={thStyle}>Token</th>
            <th style={thStyle}>Rate / ledger</th>
            <th style={thStyle}>
              <SortButton field="cliffLedger" label="Cliff ledger" sort={sort} onSort={onSort} />
            </th>
            <th style={thStyle}>
              <SortButton field="endLedger" label="End ledger" sort={sort} onSort={onSort} />
            </th>
            <th style={thStyle}>Status</th>
            <th style={thStyle}>
              <SortButton
                field="claimableAmount"
                label="Claimable"
                sort={sort}
                onSort={onSort}
              />
            </th>
            <th style={thStyle}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {streams.map((s) => {
            const isSelectable = s.status === "active" || s.status === "pre-cliff";
            return (
              <tr
                key={s.id}
                style={{
                  borderBottom: "1px solid var(--color-border)",
                  background: selected.has(s.id) ? "#eff6ff" : undefined,
                }}
                data-testid={`stream-row-${s.id}`}
              >
                <td style={tdStyle}>
                  {isSelectable && (
                    <input
                      type="checkbox"
                      checked={selected.has(s.id)}
                      onChange={() => onToggleSelect(s.id)}
                      aria-label={`Select stream for ${s.recipient}`}
                    />
                  )}
                </td>
                <td style={{ ...tdStyle, fontFamily: "monospace", fontSize: "0.8rem" }}>
                  {s.recipient}
                </td>
                <td style={tdStyle}>{s.token}</td>
                <td style={tdStyle}>{abbreviateAmount(s.rate)}</td>
                <td style={tdStyle}>{s.cliffLedger?.toLocaleString() ?? "—"}</td>
                <td style={tdStyle}>{s.endLedger?.toLocaleString() ?? "—"}</td>
                <td style={tdStyle}>
                  <StatusBadge status={s.status as StreamStatus} />
                </td>
                <td style={{ ...tdStyle, fontWeight: 600 }}>
                  {abbreviateAmount(s.claimableAmount)} {s.token}
                </td>
                <td style={tdStyle}>
                  {isSelectable ? (
                    <button
                      className="btn btn-outline"
                      style={{
                        padding: "0.25rem 0.75rem",
                        fontSize: "0.8rem",
                        borderColor: "var(--color-cancelled)",
                        color: "var(--color-cancelled)",
                      }}
                      onClick={() => onCancel(s)}
                      data-testid={`cancel-btn-${s.id}`}
                      aria-label={`Cancel stream for ${s.recipient}`}
                    >
                      Cancel
                    </button>
                  ) : (
                    <span style={{ color: "#9ca3af", fontSize: "0.8rem" }}>—</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Page component ────────────────────────────────────────────────────────────

export default function SponsorStreamsPage() {
  const { streams: rawStreams, total, page, pageSize, loading, error, filter, setPage, setFilter } =
    useStreams();

  // View mode (card / table) — persisted in localStorage
  const [viewMode, setViewMode] = useState<ViewMode>(loadViewPref);

  // Sort state
  const [sort, setSort] = useState<SortState>({ field: "claimableAmount", dir: "desc" });

  // Token filter
  const [tokenFilter, setTokenFilter] = useState<string>("all");

  // Bulk selection
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Cancel modal targets
  const [cancelTarget, setCancelTarget] = useState<VestingStream | null>(null);
  const [bulkCancelPending, setBulkCancelPending] = useState(false);

  // Derive unique token list from all streams
  const allTokens = useMemo(() => {
    const tokens = new Set(rawStreams.map((s) => s.token));
    return Array.from(tokens).sort();
  }, [rawStreams]);

  // Apply token filter on top of status filter
  const filteredStreams = useMemo(() => {
    const base = tokenFilter === "all" ? rawStreams : rawStreams.filter((s) => s.token === tokenFilter);
    return sortStreams(base, sort);
  }, [rawStreams, tokenFilter, sort]);

  const totalPages = Math.ceil(total / pageSize);

  // ── Handlers ─────────────────────────────────────────────────────────────────

  function handleViewToggle(mode: ViewMode) {
    setViewMode(mode);
    saveViewPref(mode);
  }

  function handleSort(field: SortField) {
    setSort((prev) =>
      prev.field === field
        ? { field, dir: prev.dir === "asc" ? "desc" : "asc" }
        : { field, dir: "desc" }
    );
  }

  function handleToggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleToggleAll(selectAll: boolean) {
    if (selectAll) {
      const ids = filteredStreams
        .filter((s) => s.status === "active" || s.status === "pre-cliff")
        .map((s) => s.id);
      setSelected(new Set(ids));
    } else {
      setSelected(new Set());
    }
  }

  function handleBulkCancelConfirm() {
    setBulkCancelPending(false);
    setSelected(new Set());
    // TODO: submit bulk cancel txs
  }

  async function handleCancel() {
    setCancelTarget(null);
    // TODO: submit cancel tx
    await Promise.resolve();
  }

  return (
    <main id="main-content" className="page">
      <header className="header">
        <h1>My Streams</h1>
        <a href="/" className="btn btn-outline" style={{ fontSize: "0.875rem" }}>
          ← Back
        </a>
      </header>

      {/* ── Toolbar ─────────────────────────────────────────────────────────── */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: "0.75rem",
          marginBottom: "1rem",
        }}
      >
        {/* Status filter */}
        <div
          role="group"
          aria-label="Filter by status"
          style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}
        >
          {STATUS_FILTERS.map(({ value, label }) => (
            <button
              key={value}
              onClick={() => { setFilter(value); setSelected(new Set()); }}
              className={`btn ${filter === value ? "btn-primary" : "btn-outline"}`}
              style={{ padding: "0.35rem 1rem", fontSize: "0.875rem" }}
              aria-pressed={filter === value}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Right-side controls */}
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
          {/* Token filter */}
          <label htmlFor="token-filter" className="sr-only">
            Filter by token
          </label>
          <select
            id="token-filter"
            value={tokenFilter}
            onChange={(e) => setTokenFilter(e.target.value)}
            style={{
              padding: "0.35rem 0.6rem",
              border: "1px solid var(--color-border)",
              borderRadius: "var(--radius)",
              background: "var(--color-surface)",
              color: "var(--color-text)",
              fontSize: "0.875rem",
              cursor: "pointer",
            }}
            aria-label="Filter by token"
          >
            <option value="all">All tokens</option>
            {allTokens.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>

          {/* Sort (mobile-friendly select for when toolbar wraps) */}
          <label htmlFor="sort-select" className="sr-only">
            Sort by
          </label>
          <select
            id="sort-select"
            value={`${sort.field}-${sort.dir}`}
            onChange={(e) => {
              const [field, dir] = e.target.value.split("-") as [SortField, SortDir];
              setSort({ field, dir });
            }}
            style={{
              padding: "0.35rem 0.6rem",
              border: "1px solid var(--color-border)",
              borderRadius: "var(--radius)",
              background: "var(--color-surface)",
              color: "var(--color-text)",
              fontSize: "0.875rem",
              cursor: "pointer",
            }}
            aria-label="Sort streams"
          >
            {SORT_OPTIONS.flatMap(({ value, label }) => [
              <option key={`${value}-desc`} value={`${value}-desc`}>
                {label} ↓
              </option>,
              <option key={`${value}-asc`} value={`${value}-asc`}>
                {label} ↑
              </option>,
            ])}
          </select>

          {/* View toggle */}
          <div role="group" aria-label="View mode" style={{ display: "flex" }}>
            <button
              type="button"
              onClick={() => handleViewToggle("card")}
              className={`btn ${viewMode === "card" ? "btn-primary" : "btn-outline"}`}
              style={{
                padding: "0.35rem 0.75rem",
                fontSize: "0.875rem",
                borderRadius: "var(--radius) 0 0 var(--radius)",
              }}
              aria-pressed={viewMode === "card"}
              title="Card view"
              aria-label="Card view"
            >
              ▦
            </button>
            <button
              type="button"
              onClick={() => handleViewToggle("table")}
              className={`btn ${viewMode === "table" ? "btn-primary" : "btn-outline"}`}
              style={{
                padding: "0.35rem 0.75rem",
                fontSize: "0.875rem",
                borderRadius: "0 var(--radius) var(--radius) 0",
                borderLeft: "none",
              }}
              aria-pressed={viewMode === "table"}
              title="Table view"
              aria-label="Table view"
            >
              ☰
            </button>
          </div>

          {/* Export */}
          <button
            className="btn btn-outline"
            style={{ fontSize: "0.875rem" }}
            onClick={() => exportCsv(filteredStreams)}
            disabled={filteredStreams.length === 0}
            aria-label="Export streams to CSV"
            data-testid="export-csv-btn"
          >
            ↓ Export CSV
          </button>
        </div>
      </div>

      {/* ── Bulk cancel bar ──────────────────────────────────────────────────── */}
      <BulkCancelBar
        count={selected.size}
        onConfirm={() => setBulkCancelPending(true)}
        onClear={() => setSelected(new Set())}
      />

      {/* Bulk cancel confirmation */}
      {bulkCancelPending && (
        <div
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="bulk-cancel-title"
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.4)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 200,
            padding: "1rem",
          }}
        >
          <div
            style={{
              background: "var(--color-surface)",
              border: "1px solid var(--color-border)",
              borderRadius: "var(--radius)",
              padding: "1.5rem",
              maxWidth: 400,
              width: "100%",
            }}
          >
            <h2 id="bulk-cancel-title" style={{ marginBottom: "1rem" }}>
              Cancel {selected.size} stream{selected.size !== 1 ? "s" : ""}?
            </h2>
            <p style={{ marginBottom: "1.25rem", fontSize: "0.9rem", color: "#6b7280" }}>
              This action will cancel all selected streams. Claimable tokens (post-cliff) will
              be sent to recipients; the remainder will be refunded to you.
            </p>
            <div style={{ display: "flex", gap: "0.75rem", justifyContent: "flex-end" }}>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setBulkCancelPending(false)}
              >
                Back
              </button>
              <button
                type="button"
                className="btn btn-outline"
                style={{ borderColor: "var(--color-cancelled)", color: "var(--color-cancelled)" }}
                onClick={handleBulkCancelConfirm}
              >
                Confirm cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {error && (
        <p role="alert" style={{ color: "var(--color-cancelled)", marginBottom: "1rem" }}>
          {error}
        </p>
      )}

      {/* ── Content ──────────────────────────────────────────────────────────── */}
      {loading ? (
        <StreamListSkeleton count={5} />
      ) : filteredStreams.length === 0 && filter !== "all" ? (
        <SearchResultsEmpty onResetFilter={() => { setFilter("all"); setTokenFilter("all"); }} />
      ) : filteredStreams.length === 0 ? (
        <SponsorDashboardEmpty />
      ) : viewMode === "table" ? (
        <StreamTableView
          streams={filteredStreams}
          selected={selected}
          sort={sort}
          onSort={handleSort}
          onToggleSelect={handleToggleSelect}
          onToggleAll={handleToggleAll}
          onCancel={setCancelTarget}
        />
      ) : (
        <StreamCardView
          streams={filteredStreams}
          selected={selected}
          onToggleSelect={handleToggleSelect}
          onCancel={setCancelTarget}
        />
      )}

      {/* ── Pagination ───────────────────────────────────────────────────────── */}
      {totalPages > 1 && (
        <nav
          aria-label="Pagination"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "0.75rem",
            marginTop: "1.5rem",
          }}
        >
          <button
            className="btn btn-outline"
            style={{ padding: "0.35rem 0.875rem" }}
            onClick={() => setPage(page - 1)}
            disabled={page === 1}
            aria-label="Previous page"
          >
            ‹
          </button>
          <span style={{ fontSize: "0.875rem" }}>
            Page {page} of {totalPages}
          </span>
          <button
            className="btn btn-outline"
            style={{ padding: "0.35rem 0.875rem" }}
            onClick={() => setPage(page + 1)}
            disabled={page === totalPages}
            aria-label="Next page"
          >
            ›
          </button>
        </nav>
      )}

      {cancelTarget && (
        <CancelConfirmModal
          stream={cancelTarget}
          amounts={computeCancelAmounts(cancelTarget)}
          onConfirm={handleCancel}
          onClose={() => setCancelTarget(null)}
        />
      )}
    </main>
  );
}
