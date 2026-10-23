"use client";
/**
 * useStreamEvents — paginated transaction history for a recipient (#537)
 *
 * Fetches `GET /api/v1/streams/:recipient/events` with page/limit/type query
 * params. Filter and pagination state live in the URL so links stay shareable;
 * the pure helpers below (parseHistoryParams, historyParamsToSearch,
 * buildEventsQuery, totalPages, normalizeEvents) own that logic so it can be
 * unit tested without React.
 */
import { useCallback, useEffect, useState } from "react";

// ── Constants ─────────────────────────────────────────────────────────────────

export const EVENTS_PAGE_SIZE = 20;

/** Event types as returned by the events endpoint (contract event topics). */
export type HistoryEventType = "created" | "claimed" | "cancelled" | "clawed_back";

export type HistoryFilter = HistoryEventType | "all";

export type EventStatus = "confirmed" | "pending" | "failed";

export interface HistoryEvent {
  id: string;
  type: HistoryEventType;
  /** ISO-8601 timestamp */
  timestamp: string;
  amount: number;
  token: string;
  status: EventStatus;
  /** 64-char transaction hash */
  txHash: string;
}

export interface HistoryParams {
  filter: HistoryFilter;
  page: number;
}

export const HISTORY_FILTERS: HistoryFilter[] = [
  "all",
  "created",
  "claimed",
  "cancelled",
  "clawed_back",
];

export const EVENT_FILTER_LABELS: Record<HistoryFilter, string> = {
  all: "All Events",
  created: "Created",
  claimed: "Claimed",
  cancelled: "Cancelled",
  clawed_back: "Clawed Back",
};

/** Alternate spellings seen in contract topics / Horizon event names. */
const TYPE_ALIASES: Record<string, HistoryEventType> = {
  created: "created",
  create: "created",
  vc_create: "created",
  streamcreated: "created",
  claimed: "claimed",
  claim: "claimed",
  vc_claim: "claimed",
  tokensclaimed: "claimed",
  cancelled: "cancelled",
  cancel: "cancelled",
  vc_cancel: "cancelled",
  streamcancelled: "cancelled",
  clawed_back: "clawed_back",
  clawback: "clawed_back",
  vc_clawback: "clawed_back",
  streamclawedback: "clawed_back",
};

// ── Filter / pagination helpers ───────────────────────────────────────────────

/** Parse `?type=` / `?page=` from the URL, falling back to safe defaults. */
export function parseHistoryParams(sp: URLSearchParams): HistoryParams {
  const rawType = sp.get("type") ?? "";
  const filter: HistoryFilter =
    rawType in EVENT_FILTER_LABELS ? (rawType as HistoryFilter) : "all";

  const rawPage = Number(sp.get("page") ?? "1");
  const page =
    Number.isFinite(rawPage) && rawPage >= 1 ? Math.floor(rawPage) : 1;

  return { filter, page };
}

/** Serialise state back into URL search params (defaults are omitted). */
export function historyParamsToSearch(params: HistoryParams): URLSearchParams {
  const sp = new URLSearchParams();
  if (params.filter !== "all") sp.set("type", params.filter);
  if (params.page > 1) sp.set("page", String(params.page));
  return sp;
}

/** Query string for the events endpoint (always paginated at 20 rows/page). */
export function buildEventsQuery(params: HistoryParams): string {
  const sp = new URLSearchParams({
    page: String(params.page),
    limit: String(EVENTS_PAGE_SIZE),
  });
  if (params.filter !== "all") sp.set("type", params.filter);
  return sp.toString();
}

/** Full request URL for `GET /api/v1/streams/:recipient/events`. */
export function eventsUrl(recipient: string, params: HistoryParams): string {
  return `/api/v1/streams/${encodeURIComponent(recipient)}/events?${buildEventsQuery(params)}`;
}

/** Total number of pages for a result count (at least one page). */
export function totalPages(total: number, limit: number = EVENTS_PAGE_SIZE): number {
  if (total <= 0) return 1;
  return Math.ceil(total / limit);
}

// ── Response normalisation ────────────────────────────────────────────────────

/** Map a raw type string (snake_case, contract topic, …) to a canonical type. */
export function normalizeEventType(raw: unknown): HistoryEventType | null {
  if (typeof raw !== "string") return null;
  return TYPE_ALIASES[raw.trim().toLowerCase().replace(/[\s-]+/g, "_")] ?? null;
}

function normalizeStatus(raw: unknown): EventStatus {
  if (typeof raw !== "string") return "confirmed";
  const value = raw.trim().toLowerCase();
  if (value === "pending" || value === "submitted") return "pending";
  if (value === "failed" || value === "error") return "failed";
  return "confirmed";
}

interface NormalizedPage {
  events: HistoryEvent[];
  total: number;
}

/**
 * Normalise an events API payload into `HistoryEvent` rows.
 * Accepts `{ events | items | data }` envelopes and snake_case or camelCase
 * fields; rows without a recognisable type or tx hash are dropped.
 */
export function normalizeEvents(payload: unknown): NormalizedPage {
  const body = (payload ?? {}) as Record<string, unknown>;
  const rows = (body.events ?? body.items ?? body.data ?? []) as unknown[];
  if (!Array.isArray(rows)) return { events: [], total: 0 };

  const events: HistoryEvent[] = [];
  rows.forEach((row, index) => {
    const raw = (row ?? {}) as Record<string, unknown>;
    const type = normalizeEventType(raw.type ?? raw.event_type ?? raw.eventType);
    const txHash = String(raw.txHash ?? raw.tx_hash ?? raw.hash ?? "");
    if (!type || !txHash) return;

    const timestamp = String(
      raw.timestamp ?? raw.created_at ?? raw.createdAt ?? raw.date ?? ""
    );
    const rawAmount = raw.amount ?? raw.value ?? 0;
    const amount = Number(rawAmount);
    const rawId = raw.id ?? raw.event_id ?? `${txHash}:${index}`;

    events.push({
      id: String(rawId),
      type,
      timestamp,
      amount: Number.isFinite(amount) ? amount : 0,
      token: typeof raw.token === "string" && raw.token ? raw.token : "—",
      status: normalizeStatus(raw.status),
      txHash,
    });
  });

  const rawTotal = Number(body.total ?? body.count ?? events.length);
  const total = Number.isFinite(rawTotal) && rawTotal >= events.length
    ? rawTotal
    : events.length;

  return { events, total };
}

// ── Sample data (endpoint unavailable) ────────────────────────────────────────

const SAMPLE_TYPES: HistoryEventType[] = [
  "created",
  "claimed",
  "claimed",
  "cancelled",
  "clawed_back",
];

/** Deterministic sample rows used when the endpoint is not deployed yet. */
export const SAMPLE_EVENTS: HistoryEvent[] = Array.from(
  { length: 47 },
  (_, i): HistoryEvent => ({
    id: `sample-${i + 1}`,
    type: SAMPLE_TYPES[i % SAMPLE_TYPES.length]!,
    timestamp: new Date(Date.UTC(2026, 0, 1) - i * 6 * 3_600_000).toISOString(),
    amount: SAMPLE_TYPES[i % SAMPLE_TYPES.length] === "claimed" ? (i + 1) * 150 : 0,
    token: "USDC",
    status: i % 11 === 0 ? "pending" : "confirmed",
    txHash: `${String(i + 1).padStart(2, "0")}${"abcdef0123456789".repeat(4).slice(0, 62)}`,
  })
);

/** Client-side filter + paginate over `SAMPLE_EVENTS`. */
export function samplePage(
  filter: HistoryFilter,
  page: number
): NormalizedPage {
  const filtered =
    filter === "all" ? SAMPLE_EVENTS : SAMPLE_EVENTS.filter((ev) => ev.type === filter);
  const start = (page - 1) * EVENTS_PAGE_SIZE;
  return { events: filtered.slice(start, start + EVENTS_PAGE_SIZE), total: filtered.length };
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export interface UseStreamEventsResult {
  events: HistoryEvent[];
  total: number;
  page: number;
  pageSize: number;
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

export function useStreamEvents(
  recipient: string | null,
  params: HistoryParams
): UseStreamEventsResult {
  const { filter, page } = params;
  const [events, setEvents] = useState<HistoryEvent[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (!recipient) {
      setEvents([]);
      setTotal(0);
      setLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        const res = await fetch(eventsUrl(recipient, { filter, page }), {
          headers: { Accept: "application/json" },
        });

        if (res.ok) {
          const data = normalizeEvents(await res.json());
          if (cancelled) return;
          setEvents(data.events);
          setTotal(data.total);
          setLoading(false);
          return;
        }

        if (res.status === 404) {
          // Endpoint not deployed yet — fall back to sample rows so the page
          // stays usable (same convention as fetchStreams in /explore).
          const data = samplePage(filter, page);
          if (cancelled) return;
          setEvents(data.events);
          setTotal(data.total);
          setLoading(false);
          return;
        }

        throw new Error(`Request failed with status ${res.status}`);
      } catch (err) {
        if (cancelled) return;
        setEvents([]);
        setTotal(0);
        setError(
          err instanceof Error ? err.message : "Failed to load transaction history"
        );
        setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [recipient, filter, page, refreshKey]);

  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  return {
    events,
    total,
    page,
    pageSize: EVENTS_PAGE_SIZE,
    loading,
    error,
    refresh,
  };
}
