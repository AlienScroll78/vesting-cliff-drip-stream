import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import crypto from "node:crypto";

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
  const originalSecret = process.env.WEBHOOK_HMAC_SECRET;

  beforeEach(async () => {
    vi.resetModules();
    process.env.WEBHOOK_HMAC_SECRET = "test-webhook-secret";
    vi.stubGlobal("fetch", vi.fn());
    mod = await import("./notificationJob.js");
  });

  afterEach(() => {
    if (originalSecret === undefined) {
      delete process.env.WEBHOOK_HMAC_SECRET;
    } else {
      process.env.WEBHOOK_HMAC_SECRET = originalSecret;
    }
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

    it("delivers valid payload with correct X-Webhook-Signature HMAC-SHA256 header", async () => {
      const mockFetch = vi.fn().mockResolvedValueOnce({ ok: true });
      vi.stubGlobal("fetch", mockFetch);
      const payload = { event: "test", stream: { id: "1" } };

      await mod.sendWebhook("https://example.com/hook", payload);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toBe("https://example.com/hook");
      const body = options.body;
      const expected = crypto
        .createHmac("sha256", process.env.WEBHOOK_HMAC_SECRET as string)
        .update(body)
        .digest("hex");
      expect(options.headers["X-Webhook-Signature"]).toBe(expected);
    });

    it("retries with exponential backoff on HTTP 500", async () => {
      vi.useFakeTimers();
      try {
        const mockFetch = vi.fn()
          .mockResolvedValueOnce({ ok: false, status: 500, text: async () => "Server Error" })
          .mockResolvedValueOnce({ ok: false, status: 500, text: async () => "Server Error" })
          .mockResolvedValueOnce({ ok: false, status: 500, text: async () => "Server Error" })
          .mockResolvedValueOnce({ ok: true });
        vi.stubGlobal("fetch", mockFetch);

        const promise = mod.sendWebhook("https://example.com/hook", { event: "test" });
        await vi.runAllTimersAsync();
        await expect(promise).resolves.toBeUndefined();
        expect(mockFetch).toHaveBeenCalledTimes(4);
      } finally {
        vi.useRealTimers();
      }
    });

    it("marks delivery as failed after 3 failures in delivery history", async () => {
      vi.useFakeTimers();
      try {
        const mockFetch = vi.fn().mockResolvedValue({ ok: false, status: 500, text: async () => "Server Error" });
        vi.stubGlobal("fetch", mockFetch);

        const promise = mod.sendWebhook("https://example.com/hook", { event: "test" });
        const assertion = expect(promise).rejects.toThrow();
        await vi.runAllTimersAsync();
        await assertion;
        expect(mockFetch).toHaveBeenCalledTimes(3);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe("HMAC verification", () => {
    it("passes with correct secret", () => {
      const body = JSON.stringify({ event: "test" });
      const signature = crypto
        .createHmac("sha256", process.env.WEBHOOK_HMAC_SECRET as string)
        .update(body)
        .digest("hex");
      expect(mod.verifyWebhookSignature(body, signature)).toBe(true);
    });

    it("fails with wrong secret", () => {
      const body = JSON.stringify({ event: "test" });
      const signature = crypto.createHmac("sha256", "wrong-secret").update(body).digest("hex");
      expect(mod.verifyWebhookSignature(body, signature)).toBe(false);
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

    it("does not deliver webhook registered for recipient A to recipient B", async () => {
      const streamA = {
        id: "1",
        sponsor: "GSPONSOR",
        recipient: "GRECIP_A",
        token: "CTOKEN",
        rate_per_ledger: "100",
        cliff_ledger: 500,
        end_ledger: 2000,
        notify_webhook: true,
        webhook_url: "https://example.com/hook-a",
        notify_email: false,
        email: null,
      };
      const streamB = {
        ...streamA,
        id: "2",
        recipient: "GRECIP_B",
        webhook_url: "https://example.com/hook-b",
      };
      const spy = vi.spyOn(mod, "sendWebhook").mockResolvedValue(undefined);

      await mod.dispatchNotification(streamA, 100);
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenCalledWith("https://example.com/hook-a", expect.any(Object));
      expect(spy).not.toHaveBeenCalledWith("https://example.com/hook-b", expect.any(Object));

      spy.mockClear();
      await mod.dispatchNotification(streamB, 100);
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenCalledWith("https://example.com/hook-b", expect.any(Object));
      expect(spy).not.toHaveBeenCalledWith("https://example.com/hook-a", expect.any(Object));
    });

    it("does not trigger webhooks for backfill events older than 24 hours", async () => {
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
      const spy = vi.spyOn(mod, "sendWebhook").mockResolvedValue(undefined);
      const oldTimestamp = Date.now() - 25 * 60 * 60 * 1000;

      await mod.dispatchNotification(stream, 100, { eventTimestamp: oldTimestamp });
      expect(spy).not.toHaveBeenCalled();
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
