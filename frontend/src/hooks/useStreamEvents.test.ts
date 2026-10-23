/**
 * Tests for the transaction history filter/pagination logic (#537).
 *
 * Covers the pure helpers used by /history: URL ↔ state parsing, query-string
 * construction for GET /api/v1/streams/:recipient/events, page maths and
 * response normalisation.
 */
import { describe, it, expect } from "vitest";
import {
  EVENTS_PAGE_SIZE,
  SAMPLE_EVENTS,
  buildEventsQuery,
  eventsUrl,
  historyParamsToSearch,
  normalizeEventType,
  normalizeEvents,
  parseHistoryParams,
  samplePage,
  totalPages,
} from "./useStreamEvents";

// ── parseHistoryParams ────────────────────────────────────────────────────────

describe("parseHistoryParams", () => {
  it("defaults to filter=all and page=1", () => {
    expect(parseHistoryParams(new URLSearchParams())).toEqual({
      filter: "all",
      page: 1,
    });
  });

  it("parses a known event type filter", () => {
    const sp = new URLSearchParams("type=clawed_back");
    expect(parseHistoryParams(sp).filter).toBe("clawed_back");
  });

  it.each(["created", "claimed", "cancelled", "clawed_back"])(
    "accepts the %s filter",
    (type) => {
      expect(parseHistoryParams(new URLSearchParams({ type })).filter).toBe(type);
    }
  );

  it("falls back to all for an unknown filter", () => {
    const sp = new URLSearchParams("type=bogus");
    expect(parseHistoryParams(sp).filter).toBe("all");
  });

  it("parses a positive page number", () => {
    expect(parseHistoryParams(new URLSearchParams("page=3")).page).toBe(3);
  });

  it.each(["0", "-2", "abc", ""])(
    "falls back to page 1 for invalid page %j",
    (page) => {
      expect(parseHistoryParams(new URLSearchParams({ page })).page).toBe(1);
    }
  );

  it("floors fractional pages", () => {
    expect(parseHistoryParams(new URLSearchParams("page=2.7")).page).toBe(2);
  });

  it("round-trips through historyParamsToSearch", () => {
    const original = { filter: "claimed" as const, page: 4 };
    const sp = historyParamsToSearch(original);
    expect(parseHistoryParams(sp)).toEqual(original);
  });
});

// ── historyParamsToSearch ─────────────────────────────────────────────────────

describe("historyParamsToSearch", () => {
  it("omits defaults so URLs stay clean", () => {
    const sp = historyParamsToSearch({ filter: "all", page: 1 });
    expect(sp.toString()).toBe("");
  });

  it("includes only the type when page is 1", () => {
    const sp = historyParamsToSearch({ filter: "cancelled", page: 1 });
    expect(sp.toString()).toBe("type=cancelled");
  });

  it("includes both type and page when set", () => {
    const sp = historyParamsToSearch({ filter: "cancelled", page: 2 });
    expect(sp.get("type")).toBe("cancelled");
    expect(sp.get("page")).toBe("2");
  });
});

// ── buildEventsQuery / eventsUrl ──────────────────────────────────────────────

describe("buildEventsQuery", () => {
  it("always paginates at 20 rows per page", () => {
    const query = buildEventsQuery({ filter: "all", page: 1 });
    const sp = new URLSearchParams(query);
    expect(sp.get("limit")).toBe(String(EVENTS_PAGE_SIZE));
    expect(EVENTS_PAGE_SIZE).toBe(20);
    expect(sp.get("page")).toBe("1");
  });

  it("omits the type param for the all filter", () => {
    const sp = new URLSearchParams(buildEventsQuery({ filter: "all", page: 2 }));
    expect(sp.has("type")).toBe(false);
    expect(sp.get("page")).toBe("2");
  });

  it("includes the type param when filtering", () => {
    const sp = new URLSearchParams(
      buildEventsQuery({ filter: "clawed_back", page: 1 })
    );
    expect(sp.get("type")).toBe("clawed_back");
    expect(sp.get("limit")).toBe("20");
  });
});

describe("eventsUrl", () => {
  it("targets GET /api/v1/streams/:recipient/events", () => {
    const url = eventsUrl("GRECIPIENT", { filter: "claimed", page: 2 });
    expect(url).toMatch(/^\/api\/v1\/streams\/GRECIPIENT\/events\?/);
    expect(url).toContain("type=claimed");
    expect(url).toContain("page=2");
    expect(url).toContain("limit=20");
  });

  it("encodes the recipient address", () => {
    const url = eventsUrl("G A/B", { filter: "all", page: 1 });
    expect(url).toContain("/streams/G%20A%2FB/events");
  });
});

// ── totalPages ────────────────────────────────────────────────────────────────

describe("totalPages", () => {
  it("returns at least one page for an empty result", () => {
    expect(totalPages(0)).toBe(1);
  });

  it("returns one page for exactly 20 rows", () => {
    expect(totalPages(20)).toBe(1);
  });

  it("returns two pages for 21 rows", () => {
    expect(totalPages(21)).toBe(2);
  });

  it("returns three pages for 41 rows", () => {
    expect(totalPages(41)).toBe(3);
  });
});

// ── normalizeEventType ────────────────────────────────────────────────────────

describe("normalizeEventType", () => {
  it.each([
    ["created", "created"],
    ["vc_create", "created"],
    ["StreamCreated", "created"],
    ["claimed", "claimed"],
    ["vc_claim", "claimed"],
    ["TokensClaimed", "claimed"],
    ["cancelled", "cancelled"],
    ["vc_cancel", "cancelled"],
    ["StreamCancelled", "cancelled"],
    ["clawed_back", "clawed_back"],
    ["Clawed Back", "clawed_back"],
    ["vc_clawback", "clawed_back"],
    ["StreamClawedBack", "clawed_back"],
  ])("maps %s → %s", (raw, expected) => {
    expect(normalizeEventType(raw)).toBe(expected);
  });

  it("returns null for unknown or non-string values", () => {
    expect(normalizeEventType("mystery")).toBeNull();
    expect(normalizeEventType(undefined)).toBeNull();
    expect(normalizeEventType(42)).toBeNull();
  });
});

// ── normalizeEvents ───────────────────────────────────────────────────────────

describe("normalizeEvents", () => {
  it("maps snake_case API rows into HistoryEvent rows", () => {
    const { events, total } = normalizeEvents({
      total: 1,
      events: [
        {
          id: "evt-1",
          event_type: "vc_claim",
          created_at: "2026-01-01T10:00:00.000Z",
          amount: "1500",
          token: "USDC",
          status: "confirmed",
          tx_hash: "abc123",
        },
      ],
    });

    expect(total).toBe(1);
    expect(events).toEqual([
      {
        id: "evt-1",
        type: "claimed",
        timestamp: "2026-01-01T10:00:00.000Z",
        amount: 1500,
        token: "USDC",
        status: "confirmed",
        txHash: "abc123",
      },
    ]);
  });

  it("accepts camelCase rows and defaults status to confirmed", () => {
    const { events } = normalizeEvents({
      items: [
        { id: 7, type: "StreamCancelled", timestamp: "2026-01-02T00:00:00Z", txHash: "deadbeef" },
      ],
    });
    expect(events[0]).toMatchObject({
      id: "7",
      type: "cancelled",
      status: "confirmed",
      txHash: "deadbeef",
    });
  });

  it("normalises pending/failed statuses", () => {
    const { events } = normalizeEvents({
      events: [
        { id: "1", type: "created", txHash: "aa", status: "pending" },
        { id: "2", type: "created", txHash: "bb", status: "FAILED" },
      ],
    });
    expect(events.map((e) => e.status)).toEqual(["pending", "failed"]);
  });

  it("drops rows without a recognisable type or tx hash", () => {
    const { events } = normalizeEvents({
      events: [
        { id: "1", type: "mystery", txHash: "aa" },
        { id: "2", type: "created", txHash: "" },
        { id: "3", type: "claimed", txHash: "cc" },
      ],
    });
    expect(events).toHaveLength(1);
    expect(events[0]!.txHash).toBe("cc");
  });

  it("derives total from the row count when missing", () => {
    const { total } = normalizeEvents({
      events: [
        { id: "1", type: "created", txHash: "aa" },
        { id: "2", type: "claimed", txHash: "bb" },
      ],
    });
    expect(total).toBe(2);
  });

  it("handles empty / malformed payloads", () => {
    expect(normalizeEvents(null)).toEqual({ events: [], total: 0 });
    expect(normalizeEvents({})).toEqual({ events: [], total: 0 });
    expect(normalizeEvents({ events: "nope" })).toEqual({ events: [], total: 0 });
  });
});

// ── samplePage (client-side filter + pagination fallback) ─────────────────────

describe("samplePage", () => {
  it("returns 20 rows on the first page", () => {
    const { events, total } = samplePage("all", 1);
    expect(events).toHaveLength(EVENTS_PAGE_SIZE);
    expect(total).toBe(SAMPLE_EVENTS.length);
  });

  it("returns only the remainder on the last page", () => {
    const { events, total } = samplePage("all", 3);
    expect(total).toBe(SAMPLE_EVENTS.length);
    expect(events).toHaveLength(total - 2 * EVENTS_PAGE_SIZE);
  });

  it("returns an empty page beyond the last page", () => {
    expect(samplePage("all", 99).events).toHaveLength(0);
  });

  it("filters by event type", () => {
    const { events, total } = samplePage("clawed_back", 1);
    expect(total).toBe(SAMPLE_EVENTS.filter((e) => e.type === "clawed_back").length);
    expect(events.every((e) => e.type === "clawed_back")).toBe(true);
  });

  it("paginates filtered results independently", () => {
    const claimed = SAMPLE_EVENTS.filter((e) => e.type === "claimed");
    const { events, total } = samplePage("claimed", 2);
    expect(total).toBe(claimed.length);
    expect(events).toHaveLength(Math.max(0, claimed.length - EVENTS_PAGE_SIZE));
  });
});
