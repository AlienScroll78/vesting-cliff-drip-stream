"use client";
import {
  useState,
  useMemo,
  useCallback,
  useRef,
  useEffect,
  useId,
} from "react";
import { motion, AnimatePresence } from "framer-motion";

// ─── Types ────────────────────────────────────────────────────────────────────

export type StreamStatus = "active" | "cancelled" | "expired" | "pre-cliff";

export interface SponsorStream {
  id: string;
  recipient: string;
  token: string;
  tokenSymbol: string;
  ratePerLedger: number;
  cliffDate: string;   // ISO date string
  endDate: string;     // ISO date string
  status: StreamStatus;
  claimedPercent: number; // 0–100
  totalAmount: number;
  claimedAmount: number;
  createdAt: string;   // ISO date string
}

type SortKey = "createdAt" | "endDate" | "claimedPercent";
type SortDir = "asc" | "desc";

interface FilterState {
  status: StreamStatus | "all";
  token: string;
  dateFrom: string;
  dateTo: string;
  search: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function truncateAddr(addr: string): string {
  if (addr.length <= 12) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function fmtDate(iso: string): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function fmtNumber(n: number): string {
  return n.toLocaleString();
}

function exportCsv(streams: SponsorStream[]) {
  const headers = [
    "ID",
    "Recipient",
    "Token",
    "Rate/Ledger",
    "Cliff Date",
    "End Date",
    "Status",
    "Claimed %",
    "Total Amount",
    "Claimed Amount",
    "Created At",
  ];
  const rows = streams.map((s) => [
    s.id,
    s.recipient,
    s.tokenSymbol,
    s.ratePerLedger,
    s.cliffDate,
    s.endDate,
    s.status,
    s.claimedPercent.toFixed(1),
    s.totalAmount,
    s.claimedAmount,
    s.createdAt,
  ]);
  const csv = [headers, ...rows]
    .map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","))
    .join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "sponsor-streams.csv";
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Status badge ─────────────────────────────────────────────────────────────

const STATUS_COLORS: Record<StreamStatus, { bg: string; color: string; dot: string }> = {
  active:      { bg: "#eff6ff", color: "#1d6ae5", dot: "#1d6ae5" },
  "pre-cliff": { bg: "#fffbeb", color: "#b45309", dot: "#b45309" },
  expired:     { bg: "#f0fdf4", color: "#15803d", dot: "#15803d" },
  cancelled:   { bg: "#fef2f2", color: "#b91c1c", dot: "#b91c1c" },
};

function StatusBadge({ status }: { status: StreamStatus }) {
  const c = STATUS_COLORS[status];
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "5px",
        padding: "3px 9px",
        borderRadius: "9999px",
        background: c.bg,
        color: c.color,
        fontSize: "12px",
        fontWeight: 600,
        border: `1.5px solid ${c.color}`,
        whiteSpace: "nowrap",
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: "6px",
          height: "6px",
          borderRadius: "50%",
          background: c.dot,
          flexShrink: 0,
        }}
      />
      {status.charAt(0).toUpperCase() + status.slice(1).replace("-", "-")}
    </span>
  );
}

// ─── Claimed progress bar ─────────────────────────────────────────────────────

function ClaimedBar({ pct }: { pct: number }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
      <div
        style={{
          flex: 1,
          height: "6px",
          borderRadius: "9999px",
          background: "#e5e7eb",
          overflow: "hidden",
          minWidth: "60px",
        }}
      >
        <div
          style={{
            width: `${Math.min(100, pct)}%`,
            height: "100%",
            background: "#15803d",
            borderRadius: "9999px",
            transition: "width 0.3s ease",
          }}
        />
      </div>
      <span style={{ fontSize: "12px", color: "#374151", minWidth: "36px" }}>
        {pct.toFixed(0)}%
      </span>
    </div>
  );
}

// ─── Confirm cancel modal ─────────────────────────────────────────────────────

function CancelModal({
  streamId,
  recipient,
  onConfirm,
  onCancel,
}: {
  streamId: string;
  recipient: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const titleId = useId();
  // Trap focus
  const confirmRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    confirmRef.current?.focus();
  }, []);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 50,
        padding: "16px",
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        transition={{ duration: 0.15 }}
        style={{
          background: "#fff",
          borderRadius: "12px",
          padding: "24px",
          maxWidth: "440px",
          width: "100%",
          boxShadow: "0 20px 40px rgba(0,0,0,0.3)",
        }}
      >
        <h2
          id={titleId}
          style={{ margin: "0 0 8px", fontSize: "18px", fontWeight: 700, color: "#111827" }}
        >
          Cancel stream?
        </h2>
        <p style={{ margin: "0 0 6px", fontSize: "14px", color: "#374151" }}>
          This will permanently cancel stream{" "}
          <strong style={{ fontFamily: "monospace" }}>{streamId}</strong> for{" "}
          <strong style={{ fontFamily: "monospace" }}>{truncateAddr(recipient)}</strong>.
        </p>
        <p style={{ margin: "0 0 20px", fontSize: "13px", color: "#6b7280" }}>
          ⚠ This action is <strong>irreversible</strong>. If the cliff has passed,
          the recipient keeps all accrued tokens; you receive the remainder.
        </p>
        <div style={{ display: "flex", gap: "12px", justifyContent: "flex-end" }}>
          <button
            type="button"
            onClick={onCancel}
            style={{
              padding: "8px 16px",
              borderRadius: "8px",
              border: "1.5px solid #d1d5db",
              background: "#fff",
              color: "#374151",
              fontWeight: 600,
              cursor: "pointer",
              fontSize: "14px",
            }}
          >
            Keep stream
          </button>
          <button
            type="button"
            ref={confirmRef}
            onClick={onConfirm}
            style={{
              padding: "8px 16px",
              borderRadius: "8px",
              border: "none",
              background: "#b91c1c",
              color: "#fff",
              fontWeight: 600,
              cursor: "pointer",
              fontSize: "14px",
            }}
          >
            Cancel stream
          </button>
        </div>
      </motion.div>
    </div>
  );
}

// ─── Table row (virtualised) ──────────────────────────────────────────────────

interface RowProps {
  stream: SponsorStream;
  selected: boolean;
  onSelect: (id: string, checked: boolean) => void;
  onCancel: (stream: SponsorStream) => void;
  onView: (stream: SponsorStream) => void;
}

function StreamRow({ stream, selected, onSelect, onCancel, onView }: RowProps) {
  return (
    <tr
      style={{
        background: selected ? "#eff6ff" : "transparent",
        transition: "background 0.1s",
      }}
    >
      <td style={tdStyle}>
        <input
          type="checkbox"
          checked={selected}
          aria-label={`Select stream ${stream.id}`}
          onChange={(e) => onSelect(stream.id, e.target.checked)}
        />
      </td>
      <td style={{ ...tdStyle, fontFamily: "monospace", fontSize: "12px" }}>
        {truncateAddr(stream.recipient)}
      </td>
      <td style={tdStyle}>
        <span
          style={{
            background: "#f3f4f6",
            borderRadius: "4px",
            padding: "2px 7px",
            fontSize: "12px",
            fontWeight: 600,
          }}
        >
          {stream.tokenSymbol}
        </span>
      </td>
      <td style={{ ...tdStyle, fontFamily: "monospace" }}>
        {fmtNumber(stream.ratePerLedger)}
      </td>
      <td style={tdStyle}>{fmtDate(stream.cliffDate)}</td>
      <td style={tdStyle}>{fmtDate(stream.endDate)}</td>
      <td style={tdStyle}>
        <StatusBadge status={stream.status} />
      </td>
      <td style={{ ...tdStyle, minWidth: "120px" }}>
        <ClaimedBar pct={stream.claimedPercent} />
      </td>
      <td style={tdStyle}>
        <div style={{ display: "flex", gap: "6px" }}>
          <button
            type="button"
            onClick={() => onView(stream)}
            aria-label={`View stream ${stream.id}`}
            style={actionBtnStyle}
          >
            View
          </button>
          {stream.status !== "cancelled" && stream.status !== "expired" && (
            <button
              type="button"
              onClick={() => onCancel(stream)}
              aria-label={`Cancel stream ${stream.id}`}
              style={{ ...actionBtnStyle, color: "#b91c1c", borderColor: "#fca5a5" }}
            >
              Cancel
            </button>
          )}
        </div>
      </td>
    </tr>
  );
}

const tdStyle: React.CSSProperties = {
  padding: "10px 12px",
  borderBottom: "1px solid #f3f4f6",
  fontSize: "13px",
  color: "#374151",
  verticalAlign: "middle",
};

const actionBtnStyle: React.CSSProperties = {
  padding: "4px 10px",
  borderRadius: "6px",
  border: "1.5px solid #d1d5db",
  background: "#fff",
  color: "#374151",
  fontSize: "12px",
  fontWeight: 600,
  cursor: "pointer",
};

// ─── Main Component ───────────────────────────────────────────────────────────

export interface SponsorDashboardProps {
  /** Sponsor wallet address */
  sponsorAddress: string;
  /** Stream data — in production, fetched from GET /api/streams?sponsor=:address */
  streams: SponsorStream[];
  /** Called after optimistic cancel; should call the contract then return updated stream */
  onCancelStream?: (streamId: string) => Promise<void>;
  /** Called when view is clicked */
  onViewStream?: (streamId: string) => void;
}

/**
 * SponsorDashboard — full table view of all streams created by the sponsor.
 *
 * Features:
 * - Filter by status, token, date range, free-text search
 * - Sort by created date, end date, claimed %
 * - Bulk select + cancel
 * - Optimistic UI updates with rollback on error
 * - CSV export of visible streams
 * - Virtual scrolling (100-row window) via windowed rendering
 */
export function SponsorDashboard({
  sponsorAddress,
  streams: initialStreams,
  onCancelStream,
  onViewStream,
}: SponsorDashboardProps) {
  const [streams, setStreams] = useState<SponsorStream[]>(initialStreams);
  const [filters, setFilters] = useState<FilterState>({
    status: "all",
    token: "",
    dateFrom: "",
    dateTo: "",
    search: "",
  });
  const [sortKey, setSortKey] = useState<SortKey>("createdAt");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [cancelTarget, setCancelTarget] = useState<SponsorStream | null>(null);
  const [pendingCancels, setPendingCancels] = useState<Set<string>>(new Set());
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Virtual scroll: show 100 rows at a time
  const WINDOW_SIZE = 100;
  const [windowStart, setWindowStart] = useState(0);

  // ── Derived data ──────────────────────────────────────────────────────────

  const uniqueTokens = useMemo(
    () => [...new Set(streams.map((s) => s.tokenSymbol))],
    [streams]
  );

  const filtered = useMemo(() => {
    let result = [...streams];
    if (filters.status !== "all") {
      result = result.filter((s) => s.status === filters.status);
    }
    if (filters.token) {
      result = result.filter((s) => s.tokenSymbol === filters.token);
    }
    if (filters.dateFrom) {
      result = result.filter((s) => s.endDate >= filters.dateFrom);
    }
    if (filters.dateTo) {
      result = result.filter((s) => s.endDate <= filters.dateTo);
    }
    if (filters.search) {
      const q = filters.search.toLowerCase();
      result = result.filter(
        (s) =>
          s.recipient.toLowerCase().includes(q) ||
          s.id.toLowerCase().includes(q) ||
          s.tokenSymbol.toLowerCase().includes(q)
      );
    }
    return result;
  }, [streams, filters]);

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      let aVal: number | string;
      let bVal: number | string;
      if (sortKey === "claimedPercent") {
        aVal = a.claimedPercent;
        bVal = b.claimedPercent;
      } else {
        aVal = a[sortKey];
        bVal = b[sortKey];
      }
      const cmp = aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [filtered, sortKey, sortDir]);

  const visible = useMemo(
    () => sorted.slice(windowStart, windowStart + WINDOW_SIZE),
    [sorted, windowStart]
  );

  // ── Sort handler ──────────────────────────────────────────────────────────

  const toggleSort = useCallback(
    (key: SortKey) => {
      if (sortKey === key) {
        setSortDir((d) => (d === "asc" ? "desc" : "asc"));
      } else {
        setSortKey(key);
        setSortDir("desc");
      }
    },
    [sortKey]
  );

  // ── Select handlers ───────────────────────────────────────────────────────

  const handleSelectOne = useCallback((id: string, checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      checked ? next.add(id) : next.delete(id);
      return next;
    });
  }, []);

  const handleSelectAll = useCallback(
    (checked: boolean) => {
      setSelected(checked ? new Set(visible.map((s) => s.id)) : new Set());
    },
    [visible]
  );

  const allSelected =
    visible.length > 0 && visible.every((s) => selected.has(s.id));

  // ── Cancel handlers ───────────────────────────────────────────────────────

  const executeCancel = useCallback(
    async (streamId: string) => {
      // Optimistic update
      setStreams((prev) =>
        prev.map((s) =>
          s.id === streamId ? { ...s, status: "cancelled" as StreamStatus } : s
        )
      );
      setPendingCancels((prev) => {
        const next = new Set(prev);
        next.add(streamId);
        return next;
      });
      setSelected((prev) => {
        const next = new Set(prev);
        next.delete(streamId);
        return next;
      });
      setCancelTarget(null);

      try {
        await onCancelStream?.(streamId);
      } catch (err) {
        // Rollback
        setStreams(initialStreams);
        setErrorMsg(
          `Failed to cancel stream ${streamId}: ${err instanceof Error ? err.message : "Unknown error"}`
        );
      } finally {
        setPendingCancels((prev) => {
          const next = new Set(prev);
          next.delete(streamId);
          return next;
        });
      }
    },
    [onCancelStream, initialStreams]
  );

  const handleBulkCancel = useCallback(async () => {
    const ids = [...selected].filter((id) => {
      const s = streams.find((x) => x.id === id);
      return s && s.status !== "cancelled" && s.status !== "expired";
    });
    for (const id of ids) {
      await executeCancel(id);
    }
  }, [selected, streams, executeCancel]);

  // ── Filter helpers ────────────────────────────────────────────────────────

  const setFilter = useCallback(
    <K extends keyof FilterState>(key: K, value: FilterState[K]) => {
      setFilters((prev) => ({ ...prev, [key]: value }));
      setWindowStart(0);
    },
    []
  );

  const clearFilters = useCallback(() => {
    setFilters({ status: "all", token: "", dateFrom: "", dateTo: "", search: "" });
    setWindowStart(0);
  }, []);

  const hasActiveFilters =
    filters.status !== "all" ||
    filters.token !== "" ||
    filters.dateFrom !== "" ||
    filters.dateTo !== "" ||
    filters.search !== "";

  // ── Render ────────────────────────────────────────────────────────────────

  const sortIndicator = (key: SortKey) =>
    sortKey === key ? (sortDir === "asc" ? " ↑" : " ↓") : "";

  return (
    <div
      style={{
        fontFamily: "system-ui, sans-serif",
        color: "#111827",
        maxWidth: "1200px",
        margin: "0 auto",
        padding: "0 0 40px",
      }}
    >
      {/* Error banner */}
      <AnimatePresence>
        {errorMsg && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            role="alert"
            style={{
              background: "#fef2f2",
              border: "1px solid #fca5a5",
              borderRadius: "8px",
              padding: "10px 16px",
              color: "#b91c1c",
              fontSize: "13px",
              marginBottom: "16px",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            {errorMsg}
            <button
              type="button"
              onClick={() => setErrorMsg(null)}
              aria-label="Dismiss error"
              style={{
                background: "none",
                border: "none",
                color: "#b91c1c",
                cursor: "pointer",
                fontSize: "16px",
                padding: "0 4px",
              }}
            >
              ×
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          marginBottom: "20px",
          flexWrap: "wrap",
          gap: "12px",
        }}
      >
        <div>
          <h1 style={{ margin: "0 0 4px", fontSize: "22px", fontWeight: 700 }}>
            Sponsor Dashboard
          </h1>
          <p style={{ margin: 0, fontSize: "13px", color: "#6b7280" }}>
            Streams created by{" "}
            <code
              style={{
                fontFamily: "monospace",
                background: "#f3f4f6",
                borderRadius: "4px",
                padding: "1px 6px",
              }}
            >
              {truncateAddr(sponsorAddress)}
            </code>
            {" · "}
            {filtered.length} stream{filtered.length !== 1 ? "s" : ""}
            {hasActiveFilters && " (filtered)"}
          </p>
        </div>
        <button
          type="button"
          onClick={() => exportCsv(sorted)}
          aria-label="Export to CSV"
          style={{
            padding: "8px 14px",
            borderRadius: "8px",
            border: "1.5px solid #d1d5db",
            background: "#fff",
            color: "#374151",
            fontSize: "13px",
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          ⬇ Export CSV
        </button>
      </div>

      {/* Filters */}
      <div
        style={{
          display: "flex",
          gap: "10px",
          flexWrap: "wrap",
          marginBottom: "16px",
          padding: "12px",
          background: "#f9fafb",
          borderRadius: "10px",
          border: "1px solid #e5e7eb",
        }}
      >
        {/* Search */}
        <input
          type="search"
          placeholder="Search address or ID…"
          value={filters.search}
          onChange={(e) => setFilter("search", e.target.value)}
          aria-label="Search streams"
          style={inputStyle}
        />

        {/* Status */}
        <select
          value={filters.status}
          onChange={(e) =>
            setFilter("status", e.target.value as FilterState["status"])
          }
          aria-label="Filter by status"
          style={inputStyle}
        >
          <option value="all">All statuses</option>
          <option value="active">Active</option>
          <option value="pre-cliff">Pre-cliff</option>
          <option value="expired">Expired</option>
          <option value="cancelled">Cancelled</option>
        </select>

        {/* Token */}
        <select
          value={filters.token}
          onChange={(e) => setFilter("token", e.target.value)}
          aria-label="Filter by token"
          style={inputStyle}
        >
          <option value="">All tokens</option>
          {uniqueTokens.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>

        {/* Date range */}
        <label style={{ display: "flex", alignItems: "center", gap: "4px", fontSize: "12px", color: "#6b7280" }}>
          End from
          <input
            type="date"
            value={filters.dateFrom}
            onChange={(e) => setFilter("dateFrom", e.target.value)}
            aria-label="End date from"
            style={{ ...inputStyle, width: "130px" }}
          />
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: "4px", fontSize: "12px", color: "#6b7280" }}>
          to
          <input
            type="date"
            value={filters.dateTo}
            onChange={(e) => setFilter("dateTo", e.target.value)}
            aria-label="End date to"
            style={{ ...inputStyle, width: "130px" }}
          />
        </label>

        {hasActiveFilters && (
          <button
            type="button"
            onClick={clearFilters}
            style={{
              ...inputStyle,
              background: "#fff",
              color: "#6b7280",
              cursor: "pointer",
              border: "1.5px solid #d1d5db",
            }}
          >
            Clear filters
          </button>
        )}
      </div>

      {/* Bulk action bar */}
      <AnimatePresence>
        {selected.size > 0 && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "12px",
              padding: "10px 14px",
              background: "#eff6ff",
              border: "1px solid #bfdbfe",
              borderRadius: "8px",
              marginBottom: "12px",
              fontSize: "13px",
            }}
          >
            <span style={{ fontWeight: 600, color: "#1d6ae5" }}>
              {selected.size} selected
            </span>
            <button
              type="button"
              onClick={handleBulkCancel}
              style={{
                padding: "5px 12px",
                borderRadius: "6px",
                border: "none",
                background: "#b91c1c",
                color: "#fff",
                fontWeight: 600,
                cursor: "pointer",
                fontSize: "12px",
              }}
            >
              Cancel selected
            </button>
            <button
              type="button"
              onClick={() => setSelected(new Set())}
              style={{
                padding: "5px 10px",
                borderRadius: "6px",
                border: "1.5px solid #d1d5db",
                background: "#fff",
                color: "#374151",
                fontWeight: 600,
                cursor: "pointer",
                fontSize: "12px",
              }}
            >
              Deselect all
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Table */}
      {sorted.length === 0 ? (
        <div
          style={{
            textAlign: "center",
            padding: "60px 20px",
            color: "#9ca3af",
            background: "#f9fafb",
            borderRadius: "10px",
            border: "1px dashed #d1d5db",
          }}
        >
          <p style={{ fontSize: "16px", margin: "0 0 8px" }}>No streams found</p>
          <p style={{ fontSize: "13px", margin: 0 }}>
            {hasActiveFilters
              ? "Try adjusting your filters."
              : "Create your first vesting stream to see it here."}
          </p>
        </div>
      ) : (
        <div
          style={{
            border: "1px solid #e5e7eb",
            borderRadius: "10px",
            overflow: "auto",
          }}
        >
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              fontSize: "13px",
            }}
            aria-label="Sponsor streams"
          >
            <thead>
              <tr style={{ background: "#f9fafb" }}>
                <th style={thStyle}>
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={(e) => handleSelectAll(e.target.checked)}
                    aria-label="Select all visible streams"
                  />
                </th>
                <th style={thStyle}>Recipient</th>
                <th style={thStyle}>Token</th>
                <th
                  style={{ ...thStyle, cursor: "pointer" }}
                  onClick={() => toggleSort("createdAt")}
                  aria-sort={sortKey === "createdAt" ? (sortDir === "asc" ? "ascending" : "descending") : "none"}
                >
                  Rate / Ledger
                </th>
                <th style={thStyle}>Cliff Date</th>
                <th
                  style={{ ...thStyle, cursor: "pointer" }}
                  onClick={() => toggleSort("endDate")}
                  aria-sort={sortKey === "endDate" ? (sortDir === "asc" ? "ascending" : "descending") : "none"}
                >
                  End Date{sortIndicator("endDate")}
                </th>
                <th style={thStyle}>Status</th>
                <th
                  style={{ ...thStyle, cursor: "pointer" }}
                  onClick={() => toggleSort("claimedPercent")}
                  aria-sort={sortKey === "claimedPercent" ? (sortDir === "asc" ? "ascending" : "descending") : "none"}
                >
                  Claimed%{sortIndicator("claimedPercent")}
                </th>
                <th style={thStyle}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((stream) => (
                <StreamRow
                  key={stream.id}
                  stream={stream}
                  selected={selected.has(stream.id)}
                  onSelect={handleSelectOne}
                  onCancel={setCancelTarget}
                  onView={(s) => onViewStream?.(s.id)}
                />
              ))}
            </tbody>
          </table>

          {/* Virtual scroll pagination */}
          {sorted.length > WINDOW_SIZE && (
            <div
              style={{
                display: "flex",
                justifyContent: "center",
                alignItems: "center",
                gap: "12px",
                padding: "12px",
                borderTop: "1px solid #e5e7eb",
                fontSize: "13px",
                color: "#6b7280",
              }}
            >
              <button
                type="button"
                disabled={windowStart === 0}
                onClick={() => setWindowStart((w) => Math.max(0, w - WINDOW_SIZE))}
                style={{
                  ...actionBtnStyle,
                  opacity: windowStart === 0 ? 0.4 : 1,
                  cursor: windowStart === 0 ? "not-allowed" : "pointer",
                }}
              >
                ← Previous
              </button>
              <span>
                {windowStart + 1}–
                {Math.min(windowStart + WINDOW_SIZE, sorted.length)} of{" "}
                {sorted.length}
              </span>
              <button
                type="button"
                disabled={windowStart + WINDOW_SIZE >= sorted.length}
                onClick={() =>
                  setWindowStart((w) =>
                    Math.min(w + WINDOW_SIZE, sorted.length - 1)
                  )
                }
                style={{
                  ...actionBtnStyle,
                  opacity: windowStart + WINDOW_SIZE >= sorted.length ? 0.4 : 1,
                  cursor:
                    windowStart + WINDOW_SIZE >= sorted.length
                      ? "not-allowed"
                      : "pointer",
                }}
              >
                Next →
              </button>
            </div>
          )}
        </div>
      )}

      {/* Cancel confirm modal */}
      <AnimatePresence>
        {cancelTarget && (
          <CancelModal
            streamId={cancelTarget.id}
            recipient={cancelTarget.recipient}
            onConfirm={() => executeCancel(cancelTarget.id)}
            onCancel={() => setCancelTarget(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

const thStyle: React.CSSProperties = {
  padding: "10px 12px",
  textAlign: "left",
  fontWeight: 600,
  fontSize: "12px",
  color: "#6b7280",
  borderBottom: "1px solid #e5e7eb",
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  whiteSpace: "nowrap",
};

const inputStyle: React.CSSProperties = {
  padding: "7px 10px",
  borderRadius: "7px",
  border: "1.5px solid #d1d5db",
  background: "#fff",
  color: "#374151",
  fontSize: "13px",
  outline: "none",
};
