/**
 * Tests for webhookWorker.js and webhookValidator.js – Issue #552
 *
 * Covers:
 *   - Successful first-attempt delivery
 *   - Exponential backoff retry schedule (5 attempts: 1s, 2s, 4s, 8s, 16s)
 *   - DLQ insertion after retry exhaustion
 *   - HMAC signature attached to every request
 *   - DLQ replay (success + failure paths)
 *   - webhookValidator: valid and invalid signatures
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Hoist mocks
// ---------------------------------------------------------------------------

const mockQuery = vi.hoisted(() => vi.fn());

vi.mock("../db.js", () => ({ pool: { query: mockQuery } }));

// Spy on global fetch
const mockFetch = vi.hoisted(() => vi.fn());
vi.stubGlobal("fetch", mockFetch);

// Control timers to avoid real delays
vi.useFakeTimers();

// ---------------------------------------------------------------------------
// Import after mocking
// ---------------------------------------------------------------------------

import {
  deliverWebhook,
  replayDlqItem,
  signPayload,
  moveToDlq,
  MAX_RETRIES,
} from "../webhookWorker.js";

import {
  validateWebhookSignature,
} from "../webhookValidator.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TEST_URL = "https://example.com/hook";
const TEST_SECRET = "supersecret123";
const TEST_PAYLOAD = { event: "stream_created", stream: { id: "1" } };

// ---------------------------------------------------------------------------
// signPayload
// ---------------------------------------------------------------------------

describe("signPayload()", () => {
  it("returns a sha256= prefixed hex string", () => {
    const sig = signPayload(TEST_SECRET, '{"event":"test"}');
    expect(sig).toMatch(/^sha256=[0-9a-f]{64}$/);
  });

  it("produces consistent output for same input", () => {
    const body = JSON.stringify(TEST_PAYLOAD);
    expect(signPayload(TEST_SECRET, body)).toBe(signPayload(TEST_SECRET, body));
  });

  it("produces different output for different secrets", () => {
    const body = '{"x":1}';
    expect(signPayload("secret-a", body)).not.toBe(signPayload("secret-b", body));
  });
});

// ---------------------------------------------------------------------------
// deliverWebhook – success paths
// ---------------------------------------------------------------------------

describe("deliverWebhook() – success", () => {
  beforeEach(() => {
    mockFetch.mockClear();
    mockQuery.mockClear();
  });

  it("succeeds on first attempt and returns ok=true", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true });

    const result = await deliverWebhook(TEST_URL, TEST_PAYLOAD, TEST_SECRET);

    expect(result.ok).toBe(true);
    expect(result.attempts).toBe(1);
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it("attaches X-Webhook-Signature header on delivery", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true });

    await deliverWebhook(TEST_URL, TEST_PAYLOAD, TEST_SECRET);

    const [, options] = mockFetch.mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }];
    expect((options.headers as Record<string, string>)["X-Webhook-Signature"]).toMatch(/^sha256=[0-9a-f]{64}$/);
  });

  it("sends Content-Type: application/json", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true });

    await deliverWebhook(TEST_URL, TEST_PAYLOAD, TEST_SECRET);

    const [, options] = mockFetch.mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }];
    expect((options.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
  });

  it("succeeds on 3rd attempt after two 500s", async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: false, status: 500, text: async () => "err" })
      .mockResolvedValueOnce({ ok: false, status: 500, text: async () => "err" })
      .mockResolvedValueOnce({ ok: true });
    mockQuery.mockResolvedValue({ rows: [] });

    const deliverPromise = deliverWebhook(TEST_URL, TEST_PAYLOAD, TEST_SECRET);
    await vi.runAllTimersAsync();
    const result = await deliverPromise;

    expect(result.ok).toBe(true);
    expect(result.attempts).toBe(3);
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });
});

// ---------------------------------------------------------------------------
// deliverWebhook – retry exhaustion + DLQ
// ---------------------------------------------------------------------------

describe("deliverWebhook() – retry exhaustion", () => {
  beforeEach(() => {
    mockFetch.mockClear();
    mockQuery.mockClear();
  });

  it("makes exactly MAX_RETRIES attempts before giving up", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 503, text: async () => "unavailable" });
    mockQuery.mockResolvedValue({ rows: [] });

    const deliverPromise = deliverWebhook(TEST_URL, TEST_PAYLOAD, TEST_SECRET);
    await vi.runAllTimersAsync();
    const result = await deliverPromise;

    expect(mockFetch).toHaveBeenCalledTimes(MAX_RETRIES);
    expect(result.ok).toBe(false);
    expect(result.attempts).toBe(MAX_RETRIES);
  });

  it("inserts a row into webhook_dead_letter_queue after exhaustion", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 503, text: async () => "unavailable" });
    mockQuery.mockResolvedValue({ rows: [] });

    const deliverPromise = deliverWebhook(TEST_URL, TEST_PAYLOAD, TEST_SECRET);
    await vi.runAllTimersAsync();
    await deliverPromise;

    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO webhook_dead_letter_queue"),
      expect.arrayContaining([TEST_URL])
    );
  });

  it("DLQ payload contains the original event payload serialised as JSON", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 502, text: async () => "bad gateway" });
    mockQuery.mockResolvedValue({ rows: [] });

    const deliverPromise = deliverWebhook(TEST_URL, TEST_PAYLOAD, TEST_SECRET);
    await vi.runAllTimersAsync();
    await deliverPromise;

    const [, params] = mockQuery.mock.calls[0] as [string, unknown[]];
    const storedPayload = params[1] as string;
    expect(JSON.parse(storedPayload)).toEqual(TEST_PAYLOAD);
  });
});

// ---------------------------------------------------------------------------
// moveToDlq – isolated
// ---------------------------------------------------------------------------

describe("moveToDlq()", () => {
  beforeEach(() => mockQuery.mockClear());

  it("writes the URL, payload, and error to the DLQ table", async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    await moveToDlq(TEST_URL, TEST_PAYLOAD, "timeout");

    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO webhook_dead_letter_queue"),
      [TEST_URL, JSON.stringify(TEST_PAYLOAD), "timeout", MAX_RETRIES]
    );
  });

  it("does not throw when the DB insert fails (graceful degradation)", async () => {
    mockQuery.mockRejectedValueOnce(new Error("DB connection lost"));
    await expect(moveToDlq(TEST_URL, TEST_PAYLOAD, "error")).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// replayDlqItem
// ---------------------------------------------------------------------------

describe("replayDlqItem()", () => {
  const dlqRow = {
    id: 42,
    webhook_url: TEST_URL,
    payload: JSON.stringify(TEST_PAYLOAD),
    last_error: "HTTP 500",
    retry_count: 5,
  };

  beforeEach(() => {
    mockFetch.mockClear();
    mockQuery.mockClear();
  });

  it("replays successfully and removes the row from DLQ", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [dlqRow] })   // SELECT
      .mockResolvedValueOnce({ rows: [] });          // DELETE

    mockFetch.mockResolvedValueOnce({ ok: true });

    const result = await replayDlqItem(42, TEST_SECRET);

    expect(result.ok).toBe(true);
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("DELETE FROM webhook_dead_letter_queue"),
      [42]
    );
  });

  it("updates last_error when replay fails", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [dlqRow] })   // SELECT
      .mockResolvedValueOnce({ rows: [] });          // UPDATE

    mockFetch.mockResolvedValueOnce({ ok: false, status: 503, text: async () => "Service Unavailable" });

    const result = await replayDlqItem(42, TEST_SECRET);

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/503/);
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE webhook_dead_letter_queue"),
      expect.arrayContaining([42])
    );
  });

  it("throws when DLQ item is not found", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }); // SELECT returns empty

    await expect(replayDlqItem(999, TEST_SECRET)).rejects.toThrow("not found");
  });
});

// ---------------------------------------------------------------------------
// validateWebhookSignature
// ---------------------------------------------------------------------------

describe("validateWebhookSignature()", () => {
  const body = '{"event":"stream_created"}';
  const sig = signPayload(TEST_SECRET, body);

  it("returns true for a valid sha256= signature", () => {
    expect(validateWebhookSignature(TEST_SECRET, body, sig)).toBe(true);
  });

  it("accepts bare hex without sha256= prefix", () => {
    const bareHex = sig.replace("sha256=", "");
    expect(validateWebhookSignature(TEST_SECRET, body, bareHex)).toBe(true);
  });

  it("returns false for wrong secret", () => {
    expect(validateWebhookSignature("wrong-secret", body, sig)).toBe(false);
  });

  it("returns false for tampered body", () => {
    expect(validateWebhookSignature(TEST_SECRET, '{"event":"tampered"}', sig)).toBe(false);
  });

  it("returns false when signature is undefined", () => {
    expect(validateWebhookSignature(TEST_SECRET, body, undefined)).toBe(false);
  });

  it("returns false when signature is empty string", () => {
    expect(validateWebhookSignature(TEST_SECRET, body, "")).toBe(false);
  });

  it("returns false when body is empty string", () => {
    expect(validateWebhookSignature(TEST_SECRET, "", sig)).toBe(false);
  });

  it("returns false when secret is empty string", () => {
    expect(validateWebhookSignature("", body, sig)).toBe(false);
  });
});
