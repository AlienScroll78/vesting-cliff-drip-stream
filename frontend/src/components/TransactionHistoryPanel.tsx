/**
 * TransactionHistoryPanel — displays a stream's Horizon event history.
 *
 * Features:
 *  - Lists StreamCreated, TokensClaimed, StreamCancelled events
 *  - Paginate with "Load more" (20 events per page)
 *  - Filter by event type
 *  - Loading skeleton during fetch
 *  - Empty state when no events
 *  - Links to Stellar Expert transaction page
 *
 * @closes #272
 */
"use client";
import { HorizonEventType } from "@/types";
import { EventFilter, useHorizonEvents } from "@/hooks/useHorizonEvents";

// ── Constants ─────────────────────────────────────────────────────────────────

const STELLAR_EXPERT_BASE = "https://stellar.expert/explorer/testnet/tx";

const EVENT_LABELS: Record<HorizonEventType | "all", string> = {
  all: "All Events",
  StreamCreated: "Stream Created",
  TokensClaimed: "Tokens Claimed",
  StreamCancelled: "Stream Cancelled",
};

const EVENT_EMOJI: Record<HorizonEventType, string> = {
  StreamCreated: "🚀",
  TokensClaimed: "💸",
  StreamCancelled: "🛑",
};

const EVENT_COLORS: Record<HorizonEventType, string> = {
  StreamCreated: "#059669",   // green
  TokensClaimed: "#1d6ae5",   // blue
  StreamCancelled: "#dc2626", // red
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(iso));
}

function abbreviateHash(hash: string): string {
  return `${hash.slice(0, 8)}…${hash.slice(-4)}`;
}

// ── Skeleton ──────────────────────────────────────────────────────────────────

function SkeletonRow() {
  return (
    <tr aria-hidden="true" data-testid="event-skeleton-row">
      {[1, 2, 3, 4, 5].map((i) => (
        <td key={i} style={{ padding: "0.7rem 0.75rem" }}>
          <div
            style={{
              height: "0.875rem",
              background: "var(--color-skeleton, #e5e7eb)",
              borderRadius: "0.25rem",
              width: i === 1 ? "70%" : i === 4 ? "90%" : "60%",
              animation: "skeleton-shimmer 1.5s ease-in-out infinite",
            }}
          />
        </td>
      ))}
    </tr>
  );
}

function SkeletonTable() {
  return (
    <div role="status" aria-label="Loading transaction history">
      <table
        style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.875rem" }}
        aria-hidden="true"
      >
        <thead>
          <tr style={{ borderBottom: "2px solid var(--color-border, #e5e7eb)" }}>
            {["Type", "Amount", "Ledger", "Date", "Tx"].map((h) => (
              <th key={h} style={thStyle}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: 5 }).map((_, i) => (
            <SkeletonRow key={i} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Empty State ───────────────────────────────────────────────────────────────

function EmptyState({ filter }: { filter: EventFilter }) {
  return (
    <div
      style={{
        textAlign: "center",
        padding: "3rem 1rem",
        color: "var(--color-muted, #6b7280)",
      }}
      data-testid="events-empty-state"
    >
      <div
        style={{ fontSize: "3rem", marginBottom: "0.75rem" }}
        role="img"
        aria-label="Empty inbox"
      >
        📭
      </div>
      <p style={{ fontWeight: 600, fontSize: "1rem", margin: "0 0 0.25rem" }}>
        No events yet
      </p>
      <p style={{ fontSize: "0.875rem", margin: 0 }}>
        {filter === "all"
          ? "No contract events have been recorded for this stream."
          : `No "${EVENT_LABELS[filter]}" events found.`}
      </p>
    </div>
  );
}

// ── Filter Bar ────────────────────────────────────────────────────────────────

const FILTER_OPTIONS: (HorizonEventType | "all")[] = [
  "all",
  "StreamCreated",
  "TokensClaimed",
  "StreamCancelled",
];

interface FilterBarProps {
  current: EventFilter;
  onChange: (f: EventFilter) => void;
}

function FilterBar({ current, onChange }: FilterBarProps) {
  return (
    <div
      role="group"
      aria-label="Filter events by type"
      style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginBottom: "1rem" }}
    >
      {FILTER_OPTIONS.map((opt) => (
        <button
          key={opt}
          onClick={() => onChange(opt)}
          aria-pressed={current === opt}
          style={{
            padding: "0.3rem 0.875rem",
            fontSize: "0.8rem",
            fontWeight: current === opt ? 700 : 400,
            borderRadius: "9999px",
            border: "1px solid var(--color-border, #e5e7eb)",
            background: current === opt ? "var(--color-active, #1d6ae5)" : "transparent",
            color: current === opt ? "#fff" : "var(--color-text, #374151)",
            cursor: "pointer",
            transition: "background 0.15s, color 0.15s",
          }}
        >
          {EVENT_LABELS[opt]}
        </button>
      ))}
    </div>
  );
}

// ── Event Row ─────────────────────────────────────────────────────────────────

import type { HorizonEvent } from "@/types";

interface EventRowProps {
  event: HorizonEvent;
}

function EventRow({ event }: EventRowProps) {
  const color = EVENT_COLORS[event.type];
  return (
    <tr
      style={{ borderBottom: "1px solid var(--color-border, #f3f4f6)" }}
      data-testid="event-row"
    >
      {/* Type */}
      <td style={tdStyle}>
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "0.375rem",
            fontSize: "0.8rem",
            fontWeight: 600,
            color,
          }}
        >
          <span aria-hidden="true">{EVENT_EMOJI[event.type]}</span>
          {EVENT_LABELS[event.type]}
        </span>
      </td>

      {/* Amount */}
      <td style={tdStyle}>
        {event.amount > 0 ? (
          <span>
            {event.amount.toLocaleString()}{" "}
            <span style={{ color: "var(--color-muted, #6b7280)", fontSize: "0.8rem" }}>
              {event.token}
            </span>
          </span>
        ) : (
          <span style={{ color: "var(--color-muted, #6b7280)" }}>—</span>
        )}
      </td>

      {/* Ledger */}
      <td style={{ ...tdStyle, fontFamily: "monospace", fontSize: "0.8rem" }}>
        #{event.ledger.toLocaleString()}
      </td>

      {/* Date */}
      <td style={tdStyle}>
        <time dateTime={event.timestamp}>{formatDate(event.timestamp)}</time>
      </td>

      {/* Transaction link */}
      <td style={tdStyle}>
        <a
          href={`${STELLAR_EXPERT_BASE}/${event.txHash}`}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`View transaction ${event.txHash.slice(0, 8)} on Stellar Expert`}
          style={{
            color: "var(--color-active, #1d6ae5)",
            fontFamily: "monospace",
            fontSize: "0.78rem",
            textDecoration: "none",
          }}
          onMouseEnter={(e) => ((e.target as HTMLAnchorElement).style.textDecoration = "underline")}
          onMouseLeave={(e) => ((e.target as HTMLAnchorElement).style.textDecoration = "none")}
        >
          {abbreviateHash(event.txHash)} ↗
        </a>
      </td>
    </tr>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

interface TransactionHistoryPanelProps {
  /** Optional: filter events to a specific stream recipient */
  recipient?: string;
  /** Optional: Soroban contract address */
  contractId?: string;
  /** Optional panel title */
  title?: string;
}

export function TransactionHistoryPanel({
  recipient,
  contractId,
  title = "Transaction History",
}: TransactionHistoryPanelProps) {
  const { events, hasMore, loading, loadingMore, error, filter, setFilter, loadMore, refresh } =
    useHorizonEvents(contractId, recipient);

  return (
    <section
      aria-label={title}
      data-testid="transaction-history-panel"
      style={{ width: "100%" }}
    >
      {/* Panel header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: "0.875rem",
          flexWrap: "wrap",
          gap: "0.5rem",
        }}
      >
        <h2 style={{ margin: 0, fontSize: "1.125rem", fontWeight: 700 }}>{title}</h2>
        <button
          onClick={refresh}
          disabled={loading}
          aria-label="Refresh transaction history"
          style={{
            background: "none",
            border: "1px solid var(--color-border, #e5e7eb)",
            borderRadius: "0.375rem",
            padding: "0.3rem 0.625rem",
            cursor: "pointer",
            fontSize: "0.8rem",
            color: "var(--color-text, #374151)",
          }}
        >
          ↻ Refresh
        </button>
      </div>

      {/* Filter bar */}
      <FilterBar current={filter} onChange={setFilter} />

      {/* Error banner */}
      {error && (
        <p
          role="alert"
          style={{
            color: "var(--color-cancelled, #dc2626)",
            marginBottom: "1rem",
            fontSize: "0.875rem",
          }}
        >
          Failed to load events: {error}
        </p>
      )}

      {/* Loading skeleton (first load) */}
      {loading ? (
        <SkeletonTable />
      ) : events.length === 0 ? (
        /* Empty state */
        <EmptyState filter={filter} />
      ) : (
        <>
          {/* Events table */}
          <div style={{ overflowX: "auto" }}>
            <table
              style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.875rem" }}
              aria-label="Stream contract events"
            >
              <thead>
                <tr
                  style={{
                    borderBottom: "2px solid var(--color-border, #e5e7eb)",
                    textAlign: "left",
                  }}
                >
                  <th style={thStyle}>Type</th>
                  <th style={thStyle}>Amount</th>
                  <th style={thStyle}>Ledger</th>
                  <th style={thStyle}>Date</th>
                  <th style={thStyle}>Tx</th>
                </tr>
              </thead>
              <tbody>
                {events.map((ev) => (
                  <EventRow key={ev.id} event={ev} />
                ))}
              </tbody>
            </table>
          </div>

          {/* Load more */}
          {hasMore && (
            <div style={{ textAlign: "center", marginTop: "1.25rem" }}>
              <button
                onClick={loadMore}
                disabled={loadingMore}
                data-testid="load-more-btn"
                style={{
                  padding: "0.5rem 1.5rem",
                  border: "1px solid var(--color-border, #e5e7eb)",
                  borderRadius: "0.375rem",
                  background: "transparent",
                  cursor: loadingMore ? "default" : "pointer",
                  fontSize: "0.875rem",
                  color: "var(--color-text, #374151)",
                  opacity: loadingMore ? 0.6 : 1,
                }}
                aria-busy={loadingMore}
              >
                {loadingMore ? "Loading…" : "Load more"}
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const thStyle: React.CSSProperties = {
  padding: "0.6rem 0.75rem",
  fontWeight: 700,
  whiteSpace: "nowrap",
  fontSize: "0.8rem",
  color: "var(--color-muted, #6b7280)",
};

const tdStyle: React.CSSProperties = {
  padding: "0.65rem 0.75rem",
  verticalAlign: "middle",
};
