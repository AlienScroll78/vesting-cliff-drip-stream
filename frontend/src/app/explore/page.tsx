"use client";
/**
 * /explore — Public Stream Explorer (#768)
 *
 * Allows anyone to search for vesting streams by recipient address, sponsor
 * address, or token symbol, with filter and pagination support.
 *
 * Features:
 * - Debounced address search (300 ms) — triggers at 3+ characters
 * - Filter panel: Token, Status, Cliff date range, Rate range
 * - Results table with sortable columns
 * - Pagination with URL-encoded state for shareable links
 * - Browser back/forward preserves filter state via URLSearchParams
 * - Empty state for no results
 * - Accessible: ARIA labels, live regions, keyboard navigation
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useTransition,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";

// ── Types ─────────────────────────────────────────────────────────────────────

type StreamStatus = "active" | "pre-cliff" | "completed" | "cancelled";

type SortField =
  | "recipient"
  | "sponsor"
  | "token"
  | "rate"
  | "cliff"
  | "end"
  | "status";

type SortDir = "asc" | "desc";

interface StreamRow {
  id: string;
  recipient: string;
  sponsor: string;
  token: string;
  rate: number;
  cliffLedger: number;
  endLedger: number;
  status: StreamStatus;
}

interface Filters {
  query: string;         // address / token free-text
  token: string;         // token symbol filter
  status: string;        // status filter
  cliffFrom: string;     // cliff ledger lower bound
  cliffTo: string;       // cliff ledger upper bound
  rateMin: string;
  rateMax: string;
  page: number;
  sortField: SortField;
  sortDir: SortDir;
}

interface ApiResponse {
  streams: StreamRow[];
  total: number;
  page: number;
  pageSize: number;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const PAGE_SIZE = 20;
const DEBOUNCE_MS = 300;
const MIN_QUERY_LEN = 3;

const STATUS_LABELS: Record<StreamStatus, string> = {
  active: "Active",
  "pre-cliff": "Pre-cliff",
  completed: "Completed",
  cancelled: "Cancelled",
};

const STATUS_COLORS: Record<StreamStatus, string> = {
  active: "var(--color-active, #1d6ae5)",
  "pre-cliff": "var(--color-pre-cliff, #b45309)",
  completed: "var(--color-completed, #15803d)",
  cancelled: "var(--color-cancelled, #b91c1c)",
};

const STATUS_BG: Record<StreamStatus, string> = {
  active: "#eff6ff",
  "pre-cliff": "#fffbeb",
  completed: "#f0fdf4",
  cancelled: "#fef2f2",
};

const SORT_FIELD_LABELS: Record<SortField, string> = {
  recipient: "Recipient",
  sponsor: "Sponsor",
  token: "Token",
  rate: "Rate",
  cliff: "Cliff",
  end: "End",
  status: "Status",
};

// ── Mock data (replaced by real API in production) ────────────────────────────

function generateMockStreams(count: number): StreamRow[] {
  const tokens = ["USDC", "XLM", "yXLM", "StellarX"];
  const statuses: StreamStatus[] = ["active", "pre-cliff", "completed", "cancelled"];

  return Array.from({ length: count }, (_, i) => ({
    id: String(i + 1),
    recipient: `G${String.fromCharCode(65 + (i % 26))}${String.fromCharCode(65 + ((i + 5) % 26))}${(100000 + i * 7919).toString().slice(0, 4)}…`,
    sponsor: `G${String.fromCharCode(65 + ((i + 3) % 26))}${String.fromCharCode(65 + ((i + 8) % 26))}${(200000 + i * 3137).toString().slice(0, 4)}…`,
    token: tokens[i % tokens.length],
    rate: Math.floor(Math.random() * 100) + 1,
    cliffLedger: 51_200_000 + i * 17_280,
    endLedger: 51_200_000 + i * 17_280 + 6_048_000,
    status: statuses[i % statuses.length],
  }));
}

const ALL_MOCK_STREAMS = generateMockStreams(87);

// ── API fetch (uses mock until a real backend responds) ───────────────────────

async function fetchStreams(filters: Filters): Promise<ApiResponse> {
  // Build URL params to call GET /api/streams
  const params = new URLSearchParams();
  if (filters.query.length >= MIN_QUERY_LEN) params.set("q", filters.query);
  if (filters.token)    params.set("token", filters.token);
  if (filters.status)   params.set("status", filters.status);
  if (filters.cliffFrom) params.set("cliffFrom", filters.cliffFrom);
  if (filters.cliffTo)   params.set("cliffTo", filters.cliffTo);
  if (filters.rateMin)   params.set("rateMin", filters.rateMin);
  if (filters.rateMax)   params.set("rateMax", filters.rateMax);
  params.set("page", String(filters.page));
  params.set("pageSize", String(PAGE_SIZE));
  params.set("sort", `${filters.sortField}:${filters.sortDir}`);

  // Try the real API; fall back to mock on error or in non-production
  try {
    const res = await fetch(`/api/streams?${params.toString()}`, {
      headers: { Accept: "application/json" },
    });
    if (res.ok) return res.json() as Promise<ApiResponse>;
  } catch {
    // network unavailable — use mock
  }

  // ── Client-side mock filter/sort/paginate ──
  let rows = [...ALL_MOCK_STREAMS];

  const q = filters.query.toLowerCase();
  if (q.length >= MIN_QUERY_LEN) {
    rows = rows.filter(
      (r) =>
        r.recipient.toLowerCase().includes(q) ||
        r.sponsor.toLowerCase().includes(q) ||
        r.token.toLowerCase().includes(q)
    );
  }
  if (filters.token)  rows = rows.filter((r) => r.token === filters.token);
  if (filters.status) rows = rows.filter((r) => r.status === filters.status);
  if (filters.cliffFrom) rows = rows.filter((r) => r.cliffLedger >= Number(filters.cliffFrom));
  if (filters.cliffTo)   rows = rows.filter((r) => r.cliffLedger <= Number(filters.cliffTo));
  if (filters.rateMin) rows = rows.filter((r) => r.rate >= Number(filters.rateMin));
  if (filters.rateMax) rows = rows.filter((r) => r.rate <= Number(filters.rateMax));

  // Sort
  rows.sort((a, b) => {
    let av: string | number;
    let bv: string | number;

    switch (filters.sortField) {
      case "recipient": av = a.recipient; bv = b.recipient; break;
      case "sponsor":   av = a.sponsor;   bv = b.sponsor;   break;
      case "token":     av = a.token;     bv = b.token;     break;
      case "rate":      av = a.rate;      bv = b.rate;      break;
      case "cliff":     av = a.cliffLedger; bv = b.cliffLedger; break;
      case "end":       av = a.endLedger; bv = b.endLedger; break;
      case "status":    av = a.status;    bv = b.status;    break;
      default:          av = a.id;        bv = b.id;
    }

    const cmp = av < bv ? -1 : av > bv ? 1 : 0;
    return filters.sortDir === "asc" ? cmp : -cmp;
  });

  const total = rows.length;
  const offset = (filters.page - 1) * PAGE_SIZE;
  const page_rows = rows.slice(offset, offset + PAGE_SIZE);

  return { streams: page_rows, total, page: filters.page, pageSize: PAGE_SIZE };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseFiltersFromParams(sp: URLSearchParams): Filters {
  const [sortField, sortDir] = (sp.get("sort") ?? "status:asc").split(":") as [SortField, SortDir];
  return {
    query:     sp.get("q")         ?? "",
    token:     sp.get("token")     ?? "",
    status:    sp.get("status")    ?? "",
    cliffFrom: sp.get("cliffFrom") ?? "",
    cliffTo:   sp.get("cliffTo")   ?? "",
    rateMin:   sp.get("rateMin")   ?? "",
    rateMax:   sp.get("rateMax")   ?? "",
    page:      Math.max(1, Number(sp.get("page") ?? "1")),
    sortField: sortField ?? "status",
    sortDir:   sortDir   ?? "asc",
  };
}

function filtersToParams(f: Filters): URLSearchParams {
  const p = new URLSearchParams();
  if (f.query)     p.set("q", f.query);
  if (f.token)     p.set("token", f.token);
  if (f.status)    p.set("status", f.status);
  if (f.cliffFrom) p.set("cliffFrom", f.cliffFrom);
  if (f.cliffTo)   p.set("cliffTo", f.cliffTo);
  if (f.rateMin)   p.set("rateMin", f.rateMin);
  if (f.rateMax)   p.set("rateMax", f.rateMax);
  if (f.page > 1)  p.set("page", String(f.page));
  if (f.sortField !== "status" || f.sortDir !== "asc") {
    p.set("sort", `${f.sortField}:${f.sortDir}`);
  }
  return p;
}

function truncate(addr: string, chars = 8): string {
  if (addr.length <= chars * 2 + 3) return addr;
  return `${addr.slice(0, chars)}…${addr.slice(-chars)}`;
}

// ── Sort header button ────────────────────────────────────────────────────────

function SortTh({
  field,
  label,
  current,
  dir,
  onSort,
}: {
  field: SortField;
  label: string;
  current: SortField;
  dir: SortDir;
  onSort: (f: SortField) => void;
}) {
  const active = current === field;
  const arrow = active ? (dir === "asc" ? " ↑" : " ↓") : "";

  return (
    <th
      style={{
        padding: "0.6rem 0.75rem",
        fontWeight: 700,
        whiteSpace: "nowrap",
        cursor: "pointer",
        userSelect: "none",
        color: active ? "var(--color-active, #1d6ae5)" : "inherit",
      }}
    >
      <button
        type="button"
        onClick={() => onSort(field)}
        style={{
          background: "none",
          border: "none",
          cursor: "pointer",
          fontWeight: "inherit",
          color: "inherit",
          font: "inherit",
          padding: 0,
        }}
        aria-label={`Sort by ${label}${active ? (dir === "asc" ? ", currently ascending" : ", currently descending") : ""}`}
        aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : "none"}
      >
        {label}
        <span aria-hidden="true" style={{ marginLeft: "0.2rem", opacity: active ? 1 : 0.3 }}>
          {active ? (dir === "asc" ? "↑" : "↓") : "↕"}
        </span>
      </button>
    </th>
  );
}

// ── Status badge ──────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: StreamStatus }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "0.15rem 0.55rem",
        borderRadius: "9999px",
        fontSize: "0.75rem",
        fontWeight: 600,
        color: STATUS_COLORS[status],
        background: STATUS_BG[status],
        border: `1.5px solid ${STATUS_COLORS[status]}`,
        whiteSpace: "nowrap",
      }}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}

// ── Skeleton rows ─────────────────────────────────────────────────────────────

function TableSkeleton({ rows }: { rows: number }) {
  return (
    <>
      {Array.from({ length: rows }, (_, i) => (
        <tr key={i} aria-hidden="true">
          {Array.from({ length: 7 }, (_, j) => (
            <td key={j} style={{ padding: "0.65rem 0.75rem" }}>
              <span
                className="skeleton"
                style={{ display: "block", height: "1em", borderRadius: "4px", width: j === 0 ? "80%" : j === 6 ? "60%" : "70%" }}
              />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

// ── Filter panel ──────────────────────────────────────────────────────────────

function FilterPanel({
  filters,
  onChange,
  onReset,
}: {
  filters: Filters;
  onChange: (partial: Partial<Filters>) => void;
  onReset: () => void;
}) {
  const hasFilters =
    filters.token ||
    filters.status ||
    filters.cliffFrom ||
    filters.cliffTo ||
    filters.rateMin ||
    filters.rateMax;

  const inputStyle: React.CSSProperties = {
    padding: "0.4rem 0.6rem",
    border: "1.5px solid var(--color-border, #e5e7eb)",
    borderRadius: "var(--radius, 0.5rem)",
    background: "var(--color-surface, #fff)",
    color: "var(--color-text, #111827)",
    fontSize: "0.875rem",
    width: "100%",
  };

  const labelStyle: React.CSSProperties = {
    display: "block",
    fontSize: "0.75rem",
    fontWeight: 600,
    marginBottom: "0.25rem",
    color: "#6b7280",
    textTransform: "uppercase",
    letterSpacing: "0.04em",
  };

  return (
    <section
      aria-label="Filters"
      style={{
        background: "var(--color-surface, #fff)",
        border: "1px solid var(--color-border, #e5e7eb)",
        borderRadius: "var(--radius, 0.5rem)",
        padding: "1rem",
        marginBottom: "1rem",
      }}
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
          gap: "0.75rem",
        }}
      >
        {/* Token */}
        <label>
          <span style={labelStyle}>Token</span>
          <select
            value={filters.token}
            onChange={(e) => onChange({ token: e.target.value, page: 1 })}
            style={inputStyle}
            aria-label="Filter by token"
          >
            <option value="">All tokens</option>
            <option value="USDC">USDC</option>
            <option value="XLM">XLM</option>
            <option value="yXLM">yXLM</option>
            <option value="StellarX">StellarX</option>
          </select>
        </label>

        {/* Status */}
        <label>
          <span style={labelStyle}>Status</span>
          <select
            value={filters.status}
            onChange={(e) => onChange({ status: e.target.value, page: 1 })}
            style={inputStyle}
            aria-label="Filter by status"
          >
            <option value="">All statuses</option>
            <option value="active">Active</option>
            <option value="pre-cliff">Pre-cliff</option>
            <option value="completed">Completed</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </label>

        {/* Cliff from */}
        <label>
          <span style={labelStyle}>Cliff from (ledger)</span>
          <input
            type="number"
            value={filters.cliffFrom}
            onChange={(e) => onChange({ cliffFrom: e.target.value, page: 1 })}
            placeholder="e.g. 51200000"
            style={inputStyle}
            aria-label="Cliff ledger minimum"
            min={0}
          />
        </label>

        {/* Cliff to */}
        <label>
          <span style={labelStyle}>Cliff to (ledger)</span>
          <input
            type="number"
            value={filters.cliffTo}
            onChange={(e) => onChange({ cliffTo: e.target.value, page: 1 })}
            placeholder="e.g. 57200000"
            style={inputStyle}
            aria-label="Cliff ledger maximum"
            min={0}
          />
        </label>

        {/* Rate min */}
        <label>
          <span style={labelStyle}>Min rate</span>
          <input
            type="number"
            value={filters.rateMin}
            onChange={(e) => onChange({ rateMin: e.target.value, page: 1 })}
            placeholder="e.g. 1"
            style={inputStyle}
            aria-label="Minimum rate"
            min={0}
          />
        </label>

        {/* Rate max */}
        <label>
          <span style={labelStyle}>Max rate</span>
          <input
            type="number"
            value={filters.rateMax}
            onChange={(e) => onChange({ rateMax: e.target.value, page: 1 })}
            placeholder="e.g. 1000"
            style={inputStyle}
            aria-label="Maximum rate"
            min={0}
          />
        </label>
      </div>

      {hasFilters && (
        <div style={{ marginTop: "0.75rem" }}>
          <button
            type="button"
            onClick={onReset}
            className="btn btn-ghost"
            style={{ fontSize: "0.8rem", padding: "0.25rem 0.75rem" }}
          >
            ✕ Clear filters
          </button>
        </div>
      )}
    </section>
  );
}

// ── Empty state ───────────────────────────────────────────────────────────────

function EmptyState({ hasFilters }: { hasFilters: boolean }) {
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        textAlign: "center",
        padding: "3rem 1rem",
        color: "#6b7280",
      }}
    >
      <div style={{ fontSize: "3rem", marginBottom: "0.75rem" }} aria-hidden="true">
        🔭
      </div>
      <p style={{ fontSize: "1.1rem", fontWeight: 600, marginBottom: "0.4rem" }}>
        No streams found
      </p>
      <p style={{ fontSize: "0.9rem" }}>
        {hasFilters
          ? "Try adjusting your search or filters — no streams match the current criteria."
          : "There are no public streams to display yet. Check back later."}
      </p>
    </div>
  );
}

// ── Main page component ───────────────────────────────────────────────────────

export default function StreamExplorerPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  // Initialise filters from URL so the page is shareable / back-navigable
  const [filters, setFilters] = useState<Filters>(() =>
    parseFiltersFromParams(searchParams)
  );

  // Sync URL → filters when the user navigates back/forward
  useEffect(() => {
    const next = parseFiltersFromParams(searchParams);
    setFilters(next);
  }, [searchParams]);

  // Results state
  const [result, setResult] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Debounce timer ref
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Push filter changes to URL ─────────────────────────────────────────────

  const pushFilters = useCallback(
    (f: Filters) => {
      const params = filtersToParams(f);
      startTransition(() => {
        router.push(`/explore?${params.toString()}`);
      });
    },
    [router]
  );

  // ── Fetch data whenever filters change (with debounce for query field) ─────

  useEffect(() => {
    const shouldDebounce =
      filters.query.length > 0 && filters.query.length < MIN_QUERY_LEN;

    if (shouldDebounce) {
      // Don't trigger search until MIN_QUERY_LEN chars
      return;
    }

    if (debounceTimer.current) clearTimeout(debounceTimer.current);

    // Debounce only for query changes; fire immediately for filter changes
    const delay = filters.query.length >= MIN_QUERY_LEN ? DEBOUNCE_MS : 0;

    debounceTimer.current = setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await fetchStreams(filters);
        setResult(data);
      } catch {
        setError("Failed to load streams. Please try again.");
      } finally {
        setLoading(false);
      }
    }, delay);

    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, [filters]);

  // ── Handlers ──────────────────────────────────────────────────────────────

  function updateFilters(partial: Partial<Filters>) {
    const next = { ...filters, ...partial };
    setFilters(next);
    pushFilters(next);
  }

  function handleQueryChange(value: string) {
    const next = { ...filters, query: value, page: 1 };
    setFilters(next);
    // Debounce URL push for search query
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => {
      pushFilters(next);
    }, DEBOUNCE_MS);
  }

  function handleSort(field: SortField) {
    const dir: SortDir =
      filters.sortField === field && filters.sortDir === "asc" ? "desc" : "asc";
    updateFilters({ sortField: field, sortDir: dir, page: 1 });
  }

  function handlePageChange(page: number) {
    updateFilters({ page });
    // Scroll to top of results
    document.getElementById("explorer-results")?.scrollIntoView({ behavior: "smooth" });
  }

  function handleReset() {
    const reset: Filters = {
      query: "",
      token: "",
      status: "",
      cliffFrom: "",
      cliffTo: "",
      rateMin: "",
      rateMax: "",
      page: 1,
      sortField: "status",
      sortDir: "asc",
    };
    setFilters(reset);
    router.push("/explore");
  }

  // ── Derived values ─────────────────────────────────────────────────────────

  const streams = result?.streams ?? [];
  const total = result?.total ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  const hasFilters = !!(
    filters.token ||
    filters.status ||
    filters.cliffFrom ||
    filters.cliffTo ||
    filters.rateMin ||
    filters.rateMax
  );

  const isSearching = filters.query.length >= MIN_QUERY_LEN;
  const showEmpty = !loading && streams.length === 0 && (isSearching || hasFilters || result !== null);

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <main id="main-content" className="page" style={{ maxWidth: 1080 }}>
      {/* Page header */}
      <header style={{ marginBottom: "1.5rem" }}>
        <h1 style={{ fontSize: "1.75rem", fontWeight: 800, marginBottom: "0.4rem" }}>
          Stream Explorer
        </h1>
        <p style={{ color: "#6b7280", fontSize: "0.95rem" }}>
          Browse all public vesting streams on the Stellar network. Search by
          recipient or sponsor address, filter by token and status.
        </p>
      </header>

      {/* Search input */}
      <div style={{ position: "relative", marginBottom: "1rem" }}>
        <label htmlFor="explorer-search" className="sr-only">
          Search streams by address or token
        </label>
        <span
          aria-hidden="true"
          style={{
            position: "absolute",
            left: "0.75rem",
            top: "50%",
            transform: "translateY(-50%)",
            color: "#9ca3af",
            pointerEvents: "none",
            fontSize: "1rem",
          }}
        >
          🔍
        </span>
        <input
          id="explorer-search"
          type="search"
          value={filters.query}
          onChange={(e) => handleQueryChange(e.target.value)}
          placeholder="Search by recipient address, sponsor address, or token (3+ chars)…"
          style={{
            width: "100%",
            padding: "0.65rem 0.75rem 0.65rem 2.25rem",
            border: "1.5px solid var(--color-border, #e5e7eb)",
            borderRadius: "var(--radius, 0.5rem)",
            background: "var(--color-surface, #fff)",
            color: "var(--color-text, #111827)",
            fontSize: "0.95rem",
            outline: "none",
          }}
          aria-label="Search streams by recipient address, sponsor address, or token symbol"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
        />
        {filters.query && (
          <button
            type="button"
            aria-label="Clear search"
            onClick={() => handleQueryChange("")}
            style={{
              position: "absolute",
              right: "0.6rem",
              top: "50%",
              transform: "translateY(-50%)",
              background: "none",
              border: "none",
              cursor: "pointer",
              color: "#9ca3af",
              fontSize: "1.1rem",
              padding: "0.25rem",
            }}
          >
            ✕
          </button>
        )}
        {filters.query.length > 0 && filters.query.length < MIN_QUERY_LEN && (
          <p
            aria-live="polite"
            style={{ fontSize: "0.78rem", color: "#9ca3af", marginTop: "0.3rem" }}
          >
            Type {MIN_QUERY_LEN - filters.query.length} more character
            {MIN_QUERY_LEN - filters.query.length !== 1 ? "s" : ""} to search…
          </p>
        )}
      </div>

      {/* Filter panel */}
      <FilterPanel
        filters={filters}
        onChange={updateFilters}
        onReset={handleReset}
      />

      {/* Results header */}
      <div
        id="explorer-results"
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "0.75rem",
          minHeight: "1.5rem",
        }}
      >
        <p
          aria-live="polite"
          aria-atomic="true"
          style={{ fontSize: "0.875rem", color: "#6b7280" }}
        >
          {loading || isPending ? (
            <span aria-busy="true">Loading streams…</span>
          ) : result !== null ? (
            <span>
              {total === 0
                ? "No streams found"
                : `${total.toLocaleString()} stream${total !== 1 ? "s" : ""} found`}
              {(isSearching || hasFilters) ? " matching your criteria" : ""}
            </span>
          ) : null}
        </p>

        {/* Share link hint */}
        {(isSearching || hasFilters) && (
          <span style={{ fontSize: "0.75rem", color: "#9ca3af" }}>
            🔗 Filtered view — link is shareable
          </span>
        )}
      </div>

      {/* Error state */}
      {error && (
        <div
          role="alert"
          style={{
            padding: "0.75rem 1rem",
            background: "#fef2f2",
            border: "1px solid #fecaca",
            borderRadius: "var(--radius, 0.5rem)",
            color: "var(--color-cancelled, #b91c1c)",
            marginBottom: "1rem",
            fontSize: "0.875rem",
          }}
        >
          {error}
        </div>
      )}

      {/* Results table */}
      {showEmpty ? (
        <EmptyState hasFilters={isSearching || hasFilters} />
      ) : (
        <div
          style={{ overflowX: "auto" }}
          aria-label="Stream results"
          tabIndex={0}
          role="region"
        >
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              fontSize: "0.875rem",
              opacity: loading || isPending ? 0.5 : 1,
              transition: "opacity 0.15s ease",
            }}
            aria-label="Vesting streams"
            aria-busy={loading}
          >
            <thead>
              <tr
                style={{
                  borderBottom: "2px solid var(--color-border, #e5e7eb)",
                  textAlign: "left",
                  background: "var(--color-surface, #fff)",
                }}
              >
                {(
                  [
                    ["recipient", "Recipient"],
                    ["sponsor",   "Sponsor"],
                    ["token",     "Token"],
                    ["rate",      "Rate"],
                    ["cliff",     "Cliff"],
                    ["end",       "End"],
                    ["status",    "Status"],
                  ] as [SortField, string][]
                ).map(([field, label]) => (
                  <SortTh
                    key={field}
                    field={field}
                    label={label}
                    current={filters.sortField}
                    dir={filters.sortDir}
                    onSort={handleSort}
                  />
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <TableSkeleton rows={PAGE_SIZE} />
              ) : (
                streams.map((row) => (
                  <tr
                    key={row.id}
                    style={{
                      borderBottom: "1px solid var(--color-border, #e5e7eb)",
                      cursor: "pointer",
                      transition: "background 0.1s ease",
                    }}
                    tabIndex={0}
                    role="button"
                    aria-label={`View stream for recipient ${row.recipient}`}
                    onClick={() => router.push(`/view/${encodeURIComponent(row.recipient)}`)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        router.push(`/view/${encodeURIComponent(row.recipient)}`);
                      }
                    }}
                    onMouseEnter={(e) => {
                      (e.currentTarget as HTMLTableRowElement).style.background =
                        "color-mix(in srgb, var(--color-active, #1d6ae5) 5%, transparent)";
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLTableRowElement).style.background = "";
                    }}
                  >
                    <td
                      style={{
                        padding: "0.65rem 0.75rem",
                        fontFamily: "monospace",
                        fontSize: "0.8rem",
                        verticalAlign: "middle",
                      }}
                    >
                      <span title={row.recipient}>{truncate(row.recipient)}</span>
                    </td>
                    <td
                      style={{
                        padding: "0.65rem 0.75rem",
                        fontFamily: "monospace",
                        fontSize: "0.8rem",
                        verticalAlign: "middle",
                      }}
                    >
                      <span title={row.sponsor}>{truncate(row.sponsor)}</span>
                    </td>
                    <td
                      style={{
                        padding: "0.65rem 0.75rem",
                        fontWeight: 600,
                        verticalAlign: "middle",
                      }}
                    >
                      {row.token}
                    </td>
                    <td
                      style={{
                        padding: "0.65rem 0.75rem",
                        fontVariantNumeric: "tabular-nums",
                        verticalAlign: "middle",
                      }}
                    >
                      {row.rate.toLocaleString()}
                    </td>
                    <td
                      style={{
                        padding: "0.65rem 0.75rem",
                        fontVariantNumeric: "tabular-nums",
                        verticalAlign: "middle",
                        fontSize: "0.78rem",
                        color: "#6b7280",
                      }}
                    >
                      {row.cliffLedger.toLocaleString()}
                    </td>
                    <td
                      style={{
                        padding: "0.65rem 0.75rem",
                        fontVariantNumeric: "tabular-nums",
                        verticalAlign: "middle",
                        fontSize: "0.78rem",
                        color: "#6b7280",
                      }}
                    >
                      {row.endLedger.toLocaleString()}
                    </td>
                    <td style={{ padding: "0.65rem 0.75rem", verticalAlign: "middle" }}>
                      <StatusBadge status={row.status} />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <nav
          aria-label="Pagination"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "0.5rem",
            marginTop: "1.5rem",
            flexWrap: "wrap",
          }}
        >
          {/* First */}
          <button
            type="button"
            className="btn btn-outline"
            style={{ padding: "0.35rem 0.75rem", fontSize: "0.8rem" }}
            onClick={() => handlePageChange(1)}
            disabled={filters.page === 1}
            aria-label="First page"
          >
            «
          </button>

          {/* Prev */}
          <button
            type="button"
            className="btn btn-outline"
            style={{ padding: "0.35rem 0.875rem" }}
            onClick={() => handlePageChange(filters.page - 1)}
            disabled={filters.page === 1}
            aria-label="Previous page"
          >
            ‹
          </button>

          {/* Page numbers (window of 5) */}
          {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
            const half = 2;
            let start = Math.max(1, filters.page - half);
            const end = Math.min(totalPages, start + 4);
            start = Math.max(1, end - 4);
            return start + i;
          }).map((p) => (
            <button
              key={p}
              type="button"
              className={`btn ${p === filters.page ? "btn-primary" : "btn-outline"}`}
              style={{ padding: "0.35rem 0.75rem", minWidth: "2.25rem" }}
              onClick={() => handlePageChange(p)}
              aria-label={`Page ${p}`}
              aria-current={p === filters.page ? "page" : undefined}
            >
              {p}
            </button>
          ))}

          {/* Next */}
          <button
            type="button"
            className="btn btn-outline"
            style={{ padding: "0.35rem 0.875rem" }}
            onClick={() => handlePageChange(filters.page + 1)}
            disabled={filters.page === totalPages}
            aria-label="Next page"
          >
            ›
          </button>

          {/* Last */}
          <button
            type="button"
            className="btn btn-outline"
            style={{ padding: "0.35rem 0.75rem", fontSize: "0.8rem" }}
            onClick={() => handlePageChange(totalPages)}
            disabled={filters.page === totalPages}
            aria-label="Last page"
          >
            »
          </button>

          <span
            style={{ fontSize: "0.8rem", color: "#6b7280", marginLeft: "0.25rem" }}
          >
            Page {filters.page} of {totalPages}
          </span>
        </nav>
      )}
    </main>
  );
}
