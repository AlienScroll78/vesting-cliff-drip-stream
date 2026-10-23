/**
 * useHorizonEvents — fetches contract events from Horizon for a given stream.
 *
 * Supports:
 *  - Pagination via "Load more" (20 events per page)
 *  - Filter by event type (StreamCreated | TokensClaimed | StreamCancelled | all)
 *  - Loading skeleton state
 *  - Empty state
 *
 * @closes #272
 */
import { useCallback, useEffect, useState } from "react";
import { HorizonEvent, HorizonEventType } from "@/types";

export const EVENTS_PAGE_SIZE = 20;

export type EventFilter = HorizonEventType | "all";

// ── Stub data ─────────────────────────────────────────────────────────────────
// Replace with a real Horizon/backend call. Horizon contract events endpoint:
//   GET /accounts/{account_id}/operations  (or contract events via backend)

const EVENT_TYPES: HorizonEventType[] = ["StreamCreated", "TokensClaimed", "StreamCancelled"];

const STUB_EVENTS: HorizonEvent[] = Array.from({ length: 55 }, (_, i) => {
  const type = EVENT_TYPES[i % 3]!;
  return {
    id: `${50_000_000 - i * 100}:0:${i}`,
    type,
    ledger: 50_000_000 - i * 100,
    timestamp: new Date(Date.now() - i * 3_600_000).toISOString(),
    txHash: `${String(i + 1).padStart(2, "0")}${"abcdef0123456789".repeat(4).slice(0, 62)}`,
    amount: type === "TokensClaimed" ? (i + 1) * 150 : type === "StreamCreated" ? 63_072_000 : 0,
    token: "USDC",
    recipient: `GRECIPIENT${"ABCDEFGH"[i % 8]}`,
    sponsor: type !== "TokensClaimed" ? `GSPONSOR${"XYZ"[i % 3]}` : undefined,
  };
});

// ── Hook ──────────────────────────────────────────────────────────────────────

export interface UseHorizonEventsResult {
  events: HorizonEvent[];
  hasMore: boolean;
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  filter: EventFilter;
  setFilter: (f: EventFilter) => void;
  loadMore: () => void;
  refresh: () => void;
}

export function useHorizonEvents(
  _contractId?: string,
  _recipient?: string
): UseHorizonEventsResult {
  const [filter, setFilterState] = useState<EventFilter>("all");
  const [page, setPage] = useState(1);
  const [events, setEvents] = useState<HorizonEvent[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  // Reset to first page when filter changes
  function setFilter(f: EventFilter) {
    setFilterState(f);
    setPage(1);
    setEvents([]);
  }

  function refresh() {
    setPage(1);
    setEvents([]);
    setRefreshKey((k) => k + 1);
  }

  function loadMore() {
    setPage((p) => p + 1);
  }

  useEffect(() => {
    let cancelled = false;
    const isFirstPage = page === 1;

    if (isFirstPage) {
      setLoading(true);
    } else {
      setLoadingMore(true);
    }
    setError(null);

    // TODO: replace stub with real Horizon call:
    // const params = new URLSearchParams({
    //   filter: filter === "all" ? "" : filter,
    //   page: String(page),
    //   pageSize: String(EVENTS_PAGE_SIZE),
    //   ...(contractId ? { contractId } : {}),
    //   ...(recipient ? { recipient } : {}),
    // });
    // fetch(`/api/horizon-events?${params}`)
    //   .then(r => r.json())
    //   .then(({ data, hasMore }) => { ... })
    //   .catch(e => setError(e.message))

    const timer = window.setTimeout(() => {
      if (cancelled) return;

      const filtered =
        filter === "all" ? STUB_EVENTS : STUB_EVENTS.filter((ev) => ev.type === filter);

      const start = (page - 1) * EVENTS_PAGE_SIZE;
      const end = page * EVENTS_PAGE_SIZE;
      const newBatch = filtered.slice(start, end);

      if (isFirstPage) {
        setEvents(newBatch);
        setLoading(false);
      } else {
        setEvents((prev) => [...prev, ...newBatch]);
        setLoadingMore(false);
      }
      setHasMore(filtered.length > end);
    }, 400); // simulated network delay

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [filter, page, refreshKey]);

  return {
    events,
    hasMore,
    loading,
    loadingMore,
    error,
    filter,
    setFilter,
    loadMore,
    refresh,
  };
}
