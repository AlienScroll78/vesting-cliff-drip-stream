import { describe, it, expect, vi, beforeEach } from "vitest";

const mockPool = {
  connect: vi.fn(async () => ({ query: vi.fn(), release: vi.fn() })),
  query: vi.fn(async () => ({ rows: [] })),
};

vi.mock("../db", () => ({ pool: mockPool }));

vi.mock("../redisClient", () => ({
  createRedisClient: vi.fn(async () => ({
    get: vi.fn(async () => null),
    set: vi.fn(async () => "OK"),
    del: vi.fn(async () => 1),
  })),
}));

vi.mock("../lib", () => ({
  loadConfig: vi.fn(() => ({
    HORIZON_URL: "https://horizon-testnet.stellar.org",
    NETWORK_PASSPHRASE: "Test SDF Network ; September 2015",
    CONTRACT_ID: "CA3PLWTC5FC272X3Y5SY7X7Y7X7Y5SY7X7Y7X7Y",
  })),
  StellarSdk: {
    SorobanRpc: {
      Server: vi.fn(() => ({
        getLatestLedger: vi.fn(async () => ({ sequence: 1000 })),
      })),
    },
  },
}));

vi.mock("pg", () => ({
  Pool: vi.fn(() => mockPool),
}));

vi.mock("@sendgrid/mail", () => ({
  setApiKey: vi.fn(),
  send: vi.fn(),
}));

vi.mock("node-cron", () => ({
  schedule: vi.fn(),
}));

describe("Webhook", () => {
  let mod: any;

  beforeEach(async () => {
    vi.resetModules();
    vi.stubGlobal("fetch", vi.fn());
    mod = await import("./notificationJob.js");
  });

  describe("sendWebhook", () => {
    it("succeeds on first attempt", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce({ ok: true }));
      await expect(mod.sendWebhook("https://example.com/hook", { event: "test" })).resolves.toBeUndefined();
    });

    it("retries on failure up to 3 times", async () => {
      const mockFetch = vi.fn()
        .mockResolvedValueOnce({ ok: false, status: 500, text: async () => "Server Error" })
        .mockResolvedValueOnce({ ok: false, status: 500, text: async () => "Server Error" })
        .mockResolvedValueOnce({ ok: true });
      vi.stubGlobal("fetch", mockFetch);

      await expect(mod.sendWebhook("https://example.com/hook", { event: "test" })).resolves.toBeUndefined();
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    it("throws after exhausting retries", async () => {
      const mockFetch = vi.fn().mockResolvedValue({ ok: false, status: 502, text: async () => "Bad Gateway" });
      vi.stubGlobal("fetch", mockFetch);

      await expect(mod.sendWebhook("https://example.com/hook", { event: "test" })).rejects.toThrow();
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    it("handles network timeout", async () => {
      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("fetch failed")));
      await expect(mod.sendWebhook("https://example.com/hook", { event: "test" })).rejects.toThrow("fetch failed");
    });
  });

  describe("buildNotificationPayload", () => {
    it("builds correct payload for cliff_reached event", () => {
      const stream = { id: "1", sponsor: "GSPONSOR", recipient: "GRECIP", token: "CTOKEN", rate_per_ledger: "100", cliff_ledger: 500, end_ledger: 2000 };
      const payload = mod.buildNotificationPayload(stream, "cliff_reached");
      expect(payload.event).toBe("cliff_reached");
      expect(payload.stream.id).toBe("1");
      expect(payload.stream.sponsor).toBe("GSPONSOR");
    });

    it("builds correct payload for stream_completed event", () => {
      const stream = { id: "2", sponsor: "GSPONSOR", recipient: "GRECIP", token: "CTOKEN", rate_per_ledger: "100", cliff_ledger: 500, end_ledger: 2000 };
      const payload = mod.buildNotificationPayload(stream, "stream_completed");
      expect(payload.event).toBe("stream_completed");
      expect(payload.stream.end_ledger).toBe(2000);
    });
  });

  describe("dispatchNotification", () => {
    it("sends webhook when notify_webhook is true", async () => {
      const stream = {
        id: "1",
        sponsor: "GSPONSOR",
        recipient: "GRECIP",
        token: "CTOKEN",
        rate_per_ledger: "100",
        cliff_ledger: 500,
        end_ledger: 2000,
        notify_webhook: true,
        webhook_url: "https://example.com/hook",
        notify_email: false,
        email: null,
      };
      vi.spyOn(mod, "sendWebhook").mockResolvedValue(undefined);
      await mod.dispatchNotification(stream, 100);
      expect(mod.sendWebhook).toHaveBeenCalledWith("https://example.com/hook", expect.any(Object));
    });

    it("skips webhook when notify_webhook is false", async () => {
      const stream = {
        id: "1",
        sponsor: "GSPONSOR",
        recipient: "GRECIP",
        token: "CTOKEN",
        rate_per_ledger: "100",
        cliff_ledger: 500,
        end_ledger: 2000,
        notify_webhook: false,
        webhook_url: null,
        notify_email: false,
        email: null,
      };
      vi.spyOn(mod, "sendWebhook").mockResolvedValue(undefined);
      await mod.dispatchNotification(stream, 100);
      expect(mod.sendWebhook).not.toHaveBeenCalled();
    });
  });

  describe("processNotifications", () => {
    it("acquires lock and processes notifications", async () => {
      vi.spyOn(mod, "fetchUpcomingNotifications").mockResolvedValue([]);
      await mod.processNotifications();
    });

    it("skips processing when lock cannot be acquired", async () => {
      vi.doMock("../redisClient", () => ({
        createRedisClient: vi.fn(async () => ({
          set: vi.fn(async () => null),
          get: vi.fn(),
          del: vi.fn(),
        })),
      }));
      mod = await import("./notificationJob.js");
      vi.spyOn(mod, "fetchUpcomingNotifications").mockResolvedValue([]);
      await mod.processNotifications();
    });
  });
});
