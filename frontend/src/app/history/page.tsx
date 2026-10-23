"use client";
/**
 * /history — Transaction history (#537)
 *
 * Features:
 *  - Table: Date, Type, Amount, Status, Tx Hash
 *  - Filter by event type (Created, Claimed, Cancelled, Clawed Back)
 *  - Paginated (20 rows/page) via GET /api/v1/streams/:recipient/events
 *  - Filter/page state kept in the URL for shareable links
 *  - Tx hashes link to Stellar Expert (new tab)
 *  - Loading, error and empty states
 */
import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { useWallet } from "@/contexts/WalletContext";
import { TxHistoryEmpty } from "@/components/EmptyStates";
import {
  EVENT_FILTER_LABELS,
  EVENTS_PAGE_SIZE,
  HISTORY_FILTERS,
  HistoryEvent,
  HistoryParams,
  historyParamsToSearch,
  parseHistoryParams,
  totalPages,
  useStreamEvents,
} from "@/hooks/useStreamEvents";

const STELLAR_EXPERT_TX = "https://stellar.expert/explorer";

// ── Helpers ───────────────────────────────────────────────────────────────────

function explorerTxUrl(network: string, txHash: string): string {
  const explorer = network === "mainnet" ? "public" : "testnet";
  return `${STELLAR_EXPERT_TX}/${explorer}/tx/${txHash}`;
}

/** Format an ISO timestamp in the user's local timezone. */
function localDate(iso: string): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function abbreviateHash(hash: string): string {
  return `${hash.slice(0, 8)}…${hash.slice(-4)}`;
}

const TYPE_LABELS: Record<HistoryEvent["type"], string> = {
  created: "Created",
  claimed: "Claimed",
  cancelled: "Cancelled",
  clawed_back: "Clawed Back",
};

const TYPE_COLORS: Record<HistoryEvent["type"], string> = {
  created: "#059669",
  claimed: "#1d6ae5",
  cancelled: "#dc2626",
  clawed_back: "#b45309",
};

const STATUS_LABELS: Record<HistoryEvent["status"], string> = {
  confirmed: "Confirmed",
  pending: "Pending",
  failed: "Failed",
};

const STATUS_COLORS: Record<HistoryEvent["status"], string> = {
  confirmed: "#059669",
  pending: "#b45309",
  failed: "#dc2626",
};

// ── Skeleton ──────────────────────────────────────────────────────────────────

function HistorySkeleton() {
  return (
    <div role="status" aria-label="Loading transaction history" data-testid="history-skeleton">
      <table
        style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.875rem" }}
        aria-hidden="true"
      >
        <thead>
          <tr style={{ borderBottom: "2px solid var(--color-border)" }}>
            {["Date", "Type", "Amount", "Status", "Tx Hash"].map((h) => (
              <th key={h} style={thStyle}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: 5 }).map((_, i) => (
            <tr key={i} aria-hidden="true">
              {[1, 2, 3, 4, 5].map((c) => (
                <td key={c} style={tdStyle}>
                  <div
                    style={{
                      height: "0.875rem",
                      background: "var(--color-skeleton, #e5e7eb)",
                      borderRadius: "0.25rem",
                      width: c === 5 ? "75%" : "60%",
                      animation: "skeleton-shimmer 1.5s ease-in-out infinite",
                    }}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function TransactionHistoryPage() {
  const { address, network } = useWallet();

  // Filter/page state lives in the URL (?type=&page=) so links stay shareable
  const [params, setParams] = useState<HistoryParams>(() =>
    parseHistoryParams(
      new URLSearchParams(typeof window !== "undefined" ? window.location.search : "")
    )
  );

  // Keep in sync with browser back/forward navigation
  useEffect(() => {
    const onLocationChange = () =>
      setParams(parseHistoryParams(new URLSearchParams(window.location.search)));
    window.addEventListener("popstate", onLocationChange);
    return () => window.removeEventListener("popstate", onLocationChange);
  }, []);

  const { events, total, page, loading, error, refresh } = useStreamEvents(
    address,
    params
  );

  const pages = totalPages(total, EVENTS_PAGE_SIZE);

  const navigate = useCallback((next: HistoryParams) => {
    const query = historyParamsToSearch(next).toString();
    // LazyRouter intercepts history.pushState, so back/forward stay in sync
    window.history.pushState(null, "", query ? `/history?${query}` : "/history");
    setParams(next);
  }, []);

  const setFilter = (filter: HistoryParams["filter"]) => navigate({ filter, page: 1 });
  const setPage = (nextPage: number) => navigate({ filter: params.filter, page: nextPage });

  if (!address) {
    return (
      <main className="page">
        <header className="header">
          <h1>Transaction History</h1>
        </header>
        <div role="alert" style={{ color: "var(--color-muted)" }}>
          <p style={{ fontWeight: 600, marginBottom: "0.25rem" }}>No wallet connected</p>
          <p style={{ margin: 0, fontSize: "0.875rem" }}>
            Connect your wallet to view your transaction history.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="page">
      <header className="header">
        <h1>Transaction History</h1>
        <a href="/" className="btn btn-outline" style={{ fontSize: "0.875rem" }}>
          ← Back
        </a>
      </header>

      {/* Type filter — reflected in the URL for shareable links */}
      <div
        role="group"
        aria-label="Filter by event type"
        style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem", flexWrap: "wrap" }}
        data-testid="history-filters"
      >
        {HISTORY_FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={`btn ${params.filter === f ? "btn-primary" : "btn-outline"}`}
            style={{ padding: "0.35rem 1rem", fontSize: "0.875rem" }}
            aria-pressed={params.filter === f}
            data-testid={`history-filter-${f}`}
          >
            {EVENT_FILTER_LABELS[f]}
          </button>
        ))}
      </div>

      {error && (
        <div role="alert" style={{ marginBottom: "1rem" }} data-testid="history-error">
          <p style={{ color: "var(--color-cancelled, #dc2626)", margin: "0 0 0.5rem" }}>
            Failed to load transaction history: {error}
          </p>
          <button
            type="button"
            className="btn btn-outline"
            style={{ fontSize: "0.875rem" }}
            onClick={refresh}
          >
            Retry
          </button>
        </div>
      )}

      {!error && loading ? (
        <HistorySkeleton />
      ) : (
        !error &&
        events.length === 0 && (
          /* Empty state */
          <div data-testid="history-empty">
            {params.filter === "all" ? (
              <TxHistoryEmpty />
            ) : (
              <div style={{ textAlign: "center", padding: "3rem 1rem", color: "var(--color-muted)" }}>
                <div style={{ fontSize: "3rem", marginBottom: "0.5rem" }} aria-hidden="true">
                  📭
                </div>
                <p style={{ fontWeight: 600, margin: "0 0 0.25rem" }}>No matching events</p>
                <p style={{ fontSize: "0.875rem", margin: "0 0 1rem" }}>
                  No “{EVENT_FILTER_LABELS[params.filter]}” events have been recorded for this
                  address yet.
                </p>
                <button
                  type="button"
                  className="btn btn-outline"
                  style={{ fontSize: "0.875rem" }}
                  onClick={() => setFilter("all")}
                  data-testid="history-clear-filter"
                >
                  Show all events
                </button>
              </div>
            )}
          </div>
        )
      )}

      {!error && !loading && events.length > 0 && (
        <>
          <div style={{ overflowX: "auto" }}>
            <table
              style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.875rem" }}
              aria-label="Transaction history"
              data-testid="history-table"
            >
              <thead>
                <tr style={{ borderBottom: "2px solid var(--color-border)", textAlign: "left" }}>
                  <th style={thStyle}>Date</th>
                  <th style={thStyle}>Type</th>
                  <th style={thStyle}>Amount</th>
                  <th style={thStyle}>Status</th>
                  <th style={thStyle}>Tx Hash</th>
                </tr>
              </thead>
              <tbody>
                {events.map((ev) => (
                  <tr key={ev.id} style={{ borderBottom: "1px solid var(--color-border)" }}>
                    <td style={tdStyle}>
                      {ev.timestamp ? (
                        <time dateTime={ev.timestamp}>{localDate(ev.timestamp)}</time>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td style={{ ...tdStyle, color: TYPE_COLORS[ev.type], fontWeight: 600 }}>
                      {TYPE_LABELS[ev.type]}
                    </td>
                    <td style={tdStyle}>
                      {ev.amount > 0 ? (
                        <>
                          {ev.amount.toLocaleString()}{" "}
                          <span style={{ color: "var(--color-muted)", fontSize: "0.8rem" }}>
                            {ev.token}
                          </span>
                        </>
                      ) : (
                        <span style={{ color: "var(--color-muted)" }}>—</span>
                      )}
                    </td>
                    <td style={tdStyle}>
                      <span
                        style={{
                          color: STATUS_COLORS[ev.status],
                          fontWeight: 600,
                          fontSize: "0.8rem",
                        }}
                        data-testid="history-event-status"
                      >
                        {STATUS_LABELS[ev.status]}
                      </span>
                    </td>
                    <td style={tdStyle}>
                      <a
                        href={explorerTxUrl(network, ev.txHash)}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label={`View transaction ${ev.txHash.slice(0, 8)} on Stellar Expert`}
                        style={{
                          color: "var(--color-active)",
                          fontFamily: "monospace",
                          fontSize: "0.78rem",
                        }}
                      >
                        {abbreviateHash(ev.txHash)} ↗
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <nav
            aria-label="Pagination"
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "0.75rem",
              marginTop: "1.5rem",
            }}
            data-testid="history-pagination"
          >
            <button
              type="button"
              className="btn btn-outline"
              style={{ padding: "0.35rem 0.875rem" }}
              onClick={() => setPage(page - 1)}
              disabled={page <= 1}
              aria-label="Previous page"
            >
              ‹
            </button>
            <span style={{ fontSize: "0.875rem" }}>
              Page {page} of {pages} <span style={{ color: "var(--color-muted)" }}>({total} events)</span>
            </span>
            <button
              type="button"
              className="btn btn-outline"
              style={{ padding: "0.35rem 0.875rem" }}
              onClick={() => setPage(page + 1)}
              disabled={page >= pages}
              aria-label="Next page"
            >
              ›
            </button>
          </nav>
        </>
      )}
    </main>
  );
}

const thStyle: CSSProperties = {
  padding: "0.6rem 0.75rem",
  fontWeight: 700,
  whiteSpace: "nowrap",
};

const tdStyle: CSSProperties = {
  padding: "0.65rem 0.75rem",
  verticalAlign: "middle",
};
