import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("pg", () => ({
  Pool: vi.fn(() => ({
    connect: vi.fn(async () => ({
      query: vi.fn(),
      release: vi.fn(),
    })),
    query: vi.fn(async () => ({ rows: [] })),
  })),
}));

const mockPool = {
  connect: vi.fn(async () => ({
    query: vi.fn(),
    release: vi.fn(),
  })),
  query: vi.fn(async () => ({ rows: [{ cursor: "test-cursor" }] })),
};

describe("EventIndexer", () => {
  let EventIndexer: any;
  let indexer: any;

  beforeEach(async () => {
    vi.resetModules();
    vi.stubGlobal("fetch", vi.fn());
    const mod = await import("./indexer.js");
    EventIndexer = mod.EventIndexer;
    indexer = new EventIndexer(mockPool as any);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("init", () => {
    it("creates tables on init", async () => {
      const querySpy = vi.spyOn(mockPool, "query");
      await indexer.init();
      expect(querySpy).toHaveBeenCalled();
    });
  });

  describe("start/stop", () => {
    it("start schedules first tick", async () => {
      vi.spyOn(indexer, "init").mockResolvedValue(undefined);
      vi.spyOn(indexer, "scheduleNext").mockImplementation(() => {});
      await indexer.start();
      expect(indexer.running).toBe(true);
    });

    it("stop clears timer and sets running false", () => {
      indexer.timer = setTimeout(() => {}, 1000);
      indexer.stop();
      expect(indexer.running).toBe(false);
    });
  });

  describe("fetchEvents", () => {
    it("fetches events and latest ledger", async () => {
      const mockFetch = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            _embedded: {
              records: [
                { id: "evt-1", ledger: 100, topic: ["stream_created"], value: {}, paging_token: "pt-1" },
              ],
            },
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            _embedded: { records: [{ sequence: 105 }] },
          }),
        });
      vi.stubGlobal("fetch", mockFetch);

      const result = await indexer.fetchEvents("");
      expect(result.events).toHaveLength(1);
      expect(result.latestLedger).toBe(105);
      expect(result.lastCursor).toBe("pt-1");
    });

    it("throws on non-ok response", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce({ ok: false, status: 500 }));
      await expect(indexer.fetchEvents("")).rejects.toThrow("Horizon responded 500");
    });

    it("returns empty events when no records", async () => {
      vi.stubGlobal("fetch", vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ _embedded: { records: [] } }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ _embedded: { records: [{ sequence: 100 }] } }),
        }),
      );
      const result = await indexer.fetchEvents("");
      expect(result.events).toHaveLength(0);
      expect(result.lastCursor).toBeNull();
    });
  });

  describe("upsertEvents", () => {
    it("inserts events in transaction", async () => {
      const mockClient = {
        query: vi.fn().mockResolvedValue({}),
        release: vi.fn(),
      };
      vi.spyOn(mockPool, "connect").mockResolvedValue(mockClient as any);

      const events = [
        {
          id: "evt-1",
          ledger: 100,
          topic: ["AAAAEnN0cmVhbV9jcmVhdGVk", "sponsor1", "recipient1"],
          value: { fields: ["CTOKEN", "100", "", "500", "2000"] },
        },
      ];

      await indexer.upsertEvents(events);
      expect(mockClient.query).toHaveBeenCalledWith("BEGIN");
      expect(mockClient.query).toHaveBeenCalledWith("COMMIT");
    });

    it("rolls back on error", async () => {
      const mockClient = {
        query: vi.fn().mockRejectedValueOnce(new Error("DB error")),
        release: vi.fn(),
      };
      vi.spyOn(mockPool, "connect").mockResolvedValue(mockClient as any);

      const events = [{ id: "evt-1", ledger: 100, topic: [], value: {} }];
      await expect(indexer.upsertEvents(events)).rejects.toThrow("DB error");
      expect(mockClient.query).toHaveBeenCalledWith("ROLLBACK");
    });
  });

  describe("tick", () => {
    it("runs full tick cycle successfully", async () => {
      vi.spyOn(indexer, "getCursor").mockResolvedValue("cursor-1");
      vi.spyOn(indexer, "fetchEvents").mockResolvedValue({
        events: [{ id: "evt-1", ledger: 100 }],
        lastCursor: "cursor-2",
        latestLedger: 105,
      });
      vi.spyOn(indexer, "upsertEvents").mockResolvedValue(undefined);
      vi.spyOn(indexer, "saveCursor").mockResolvedValue(undefined);
      vi.spyOn(indexer, "scheduleNext").mockImplementation(() => {});

      await indexer.tick();
      expect(indexer.upsertEvents).toHaveBeenCalled();
      expect(indexer.saveCursor).toHaveBeenCalledWith("cursor-2");
    });

    it("skips upsert when events are not finalised", async () => {
      vi.spyOn(indexer, "getCursor").mockResolvedValue("");
      vi.spyOn(indexer, "fetchEvents").mockResolvedValue({
        events: [{ id: "evt-1", ledger: 103 }],
        lastCursor: null,
        latestLedger: 105,
      });
      vi.spyOn(indexer, "upsertEvents").mockResolvedValue(undefined);
      vi.spyOn(indexer, "saveCursor").mockResolvedValue(undefined);
      vi.spyOn(indexer, "scheduleNext").mockImplementation(() => {});

      await indexer.tick();
      expect(indexer.upsertEvents).not.toHaveBeenCalled();
    });
  });

  describe("getCursor / saveCursor", () => {
    it("getCursor returns empty string when no row", async () => {
      vi.spyOn(mockPool, "query").mockResolvedValue({ rows: [] });
      const cursor = await indexer.getCursor();
      expect(cursor).toBe("");
    });

    it("saveCursor updates cursor", async () => {
      const querySpy = vi.spyOn(mockPool, "query");
      await indexer.saveCursor("new-cursor");
      expect(querySpy).toHaveBeenCalledWith(
        "UPDATE indexer_cursor SET cursor = $1 WHERE id = 1",
        ["new-cursor"]
      );
    });
  });
});
