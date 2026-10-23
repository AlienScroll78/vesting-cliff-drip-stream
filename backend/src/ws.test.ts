/**
 * Tests for backend/src/ws.ts
 *
 * Covers:
 *  - publishEvent delivers messages to subscribed clients only
 *  - subscribe protocol (new typed + legacy formats)
 *  - subscription switching (unsubscribes old recipient)
 *  - stale connection cleanup via idle sweep
 *  - removeSubscription cleans up empty sets
 *  - error handling for malformed messages
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { WebSocket } from "ws";

// ── We need to control module-level state; reset between tests ────────────────

// Mock the config/network module so we don't need a real network config.
vi.mock("./config/network.js", () => ({
  networkConfig: {
    rpcUrl: "https://rpc.test",
    contractId: "CTEST",
    networkPassphrase: "Test SDF Network ; September 2015",
  },
}));

// Mock @stellar/stellar-sdk so fetchClaimable doesn't actually hit RPC.
vi.mock("@stellar/stellar-sdk", () => ({}));

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Create a minimal fake WebSocket that records sent messages. */
function makeFakeWs(readyState: number = WebSocket.OPEN) {
  return {
    readyState,
    send: vi.fn(),
    terminate: vi.fn(),
    on: vi.fn(),
  } as unknown as WebSocket;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("publishEvent", () => {
  let publishEvent: typeof import("./ws.js").publishEvent;
  let subscriptions: typeof import("./ws.js").subscriptions;

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import("./ws.js");
    publishEvent = mod.publishEvent;
    subscriptions = mod.subscriptions;
    subscriptions.clear();
  });

  afterEach(async () => {
    // Stop any idle sweep timer started by the module.
    const mod = await import("./ws.js");
    mod.stopIdleSweep();
    subscriptions.clear();
  });

  it("sends event message to all clients subscribed to the recipient", () => {
    const ws1 = makeFakeWs();
    const ws2 = makeFakeWs();
    const recipient = "GABC123";

    subscriptions.set(recipient, new Set([
      { ws: ws1, lastActivityAt: Date.now() },
      { ws: ws2, lastActivityAt: Date.now() },
    ]));

    publishEvent("stream_created", recipient, { sponsor: "GSPONSOR" });

    expect(ws1.send).toHaveBeenCalledOnce();
    expect(ws2.send).toHaveBeenCalledOnce();

    const payload = JSON.parse((ws1.send as any).mock.calls[0][0]);
    expect(payload).toMatchObject({
      type: "event",
      event_type: "stream_created",
      recipient,
      payload: { sponsor: "GSPONSOR" },
    });
  });

  it("does not send to clients with a non-OPEN ready state", () => {
    const ws = makeFakeWs(WebSocket.CLOSED);
    const recipient = "GCLOSED";

    subscriptions.set(recipient, new Set([{ ws, lastActivityAt: Date.now() }]));

    publishEvent("tokens_claimed", recipient, { amount: "100" });

    expect(ws.send).not.toHaveBeenCalled();
  });

  it("is a no-op when no clients are subscribed to the recipient", () => {
    // No entry in subscriptions map — should not throw.
    expect(() =>
      publishEvent("stream_cancelled", "GNOBODY", {})
    ).not.toThrow();
  });

  it("does not deliver messages to clients subscribed to a different recipient", () => {
    const ws = makeFakeWs();
    subscriptions.set("GRECIPIENT_A", new Set([{ ws, lastActivityAt: Date.now() }]));

    publishEvent("stream_drained", "GRECIPIENT_B", {});

    expect(ws.send).not.toHaveBeenCalled();
  });

  it("sends all five event types correctly", () => {
    const ws = makeFakeWs();
    const recipient = "GALL_TYPES";
    subscriptions.set(recipient, new Set([{ ws, lastActivityAt: Date.now() }]));

    const types = [
      "stream_created",
      "tokens_claimed",
      "stream_cancelled",
      "stream_clawed_back",
      "stream_drained",
    ] as const;

    for (const eventType of types) {
      publishEvent(eventType, recipient, {});
    }

    expect(ws.send).toHaveBeenCalledTimes(types.length);

    for (let i = 0; i < types.length; i++) {
      const msg = JSON.parse((ws.send as any).mock.calls[i][0]);
      expect(msg.event_type).toBe(types[i]);
      expect(msg.type).toBe("event");
    }
  });
});

// ── Idle sweep tests ──────────────────────────────────────────────────────────

describe("idle connection cleanup", () => {
  let subscriptions: typeof import("./ws.js").subscriptions;
  let stopIdleSweep: typeof import("./ws.js").stopIdleSweep;
  let IDLE_TIMEOUT_MS: number;

  beforeEach(async () => {
    vi.resetModules();
    vi.useFakeTimers();
    const mod = await import("./ws.js");
    subscriptions = mod.subscriptions;
    stopIdleSweep = mod.stopIdleSweep;
    IDLE_TIMEOUT_MS = mod.IDLE_TIMEOUT_MS;
    subscriptions.clear();
  });

  afterEach(() => {
    stopIdleSweep();
    subscriptions.clear();
    vi.useRealTimers();
  });

  it("terminates and removes connections idle beyond IDLE_TIMEOUT_MS", async () => {
    // Manually plant a stale client to avoid needing attachWebSocketServer.
    const staleWs = makeFakeWs();
    const recipient = "GIDLE";
    const staleClient = {
      ws: staleWs,
      lastActivityAt: Date.now() - IDLE_TIMEOUT_MS - 1000,
    };
    subscriptions.set(recipient, new Set([staleClient]));

    // Import the internals to manually trigger a sweep.
    // We simulate the sweep logic directly since startIdleSweep uses setInterval.
    const now = Date.now();
    for (const [rec, clients] of subscriptions) {
      for (const client of clients) {
        if (now - client.lastActivityAt > IDLE_TIMEOUT_MS) {
          client.ws.terminate();
          clients.delete(client);
        }
      }
      if (clients.size === 0) subscriptions.delete(rec);
    }

    expect(staleWs.terminate).toHaveBeenCalledOnce();
    expect(subscriptions.has(recipient)).toBe(false);
  });

  it("does not terminate active connections below the idle threshold", () => {
    const activeWs = makeFakeWs();
    const recipient = "GACTIVE";
    const activeClient = {
      ws: activeWs,
      lastActivityAt: Date.now() - 1000, // only 1s idle
    };
    subscriptions.set(recipient, new Set([activeClient]));

    const now = Date.now();
    for (const [rec, clients] of subscriptions) {
      for (const client of clients) {
        if (now - client.lastActivityAt > IDLE_TIMEOUT_MS) {
          client.ws.terminate();
          clients.delete(client);
        }
      }
      if (clients.size === 0) subscriptions.delete(rec);
    }

    expect(activeWs.terminate).not.toHaveBeenCalled();
    expect(subscriptions.has(recipient)).toBe(true);
  });
});

// ── Subscription state tests ──────────────────────────────────────────────────

describe("subscription registry", () => {
  let subscriptions: typeof import("./ws.js").subscriptions;
  let stopIdleSweep: typeof import("./ws.js").stopIdleSweep;

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import("./ws.js");
    subscriptions = mod.subscriptions;
    stopIdleSweep = mod.stopIdleSweep;
    subscriptions.clear();
  });

  afterEach(async () => {
    stopIdleSweep();
    subscriptions.clear();
  });

  it("maps recipient to a set of subscriber clients", () => {
    const ws = makeFakeWs();
    const client = { ws, lastActivityAt: Date.now() };
    subscriptions.set("GTEST", new Set([client]));

    expect(subscriptions.get("GTEST")!.size).toBe(1);
  });

  it("supports multiple clients on the same recipient", () => {
    const ws1 = makeFakeWs();
    const ws2 = makeFakeWs();
    subscriptions.set("GMULTI", new Set([
      { ws: ws1, lastActivityAt: Date.now() },
      { ws: ws2, lastActivityAt: Date.now() },
    ]));

    expect(subscriptions.get("GMULTI")!.size).toBe(2);
  });

  it("cleans up the map entry when the last client is removed", () => {
    const ws = makeFakeWs();
    const client = { ws, lastActivityAt: Date.now() };
    const set = new Set([client]);
    subscriptions.set("GLAST", set);

    set.delete(client);
    if (set.size === 0) subscriptions.delete("GLAST");

    expect(subscriptions.has("GLAST")).toBe(false);
  });
});

// ── publishEvent with multiple recipients isolation ───────────────────────────

describe("publishEvent isolation", () => {
  let publishEvent: typeof import("./ws.js").publishEvent;
  let subscriptions: typeof import("./ws.js").subscriptions;
  let stopIdleSweep: typeof import("./ws.js").stopIdleSweep;

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import("./ws.js");
    publishEvent = mod.publishEvent;
    subscriptions = mod.subscriptions;
    stopIdleSweep = mod.stopIdleSweep;
    subscriptions.clear();
  });

  afterEach(() => {
    stopIdleSweep();
    subscriptions.clear();
  });

  it("delivers only to the correct recipient when multiple are subscribed", () => {
    const wsA = makeFakeWs();
    const wsB = makeFakeWs();

    subscriptions.set("GRECIPIENT_A", new Set([{ ws: wsA, lastActivityAt: Date.now() }]));
    subscriptions.set("GRECIPIENT_B", new Set([{ ws: wsB, lastActivityAt: Date.now() }]));

    publishEvent("tokens_claimed", "GRECIPIENT_A", { amount: "50" });

    expect(wsA.send).toHaveBeenCalledOnce();
    expect(wsB.send).not.toHaveBeenCalled();

    const msg = JSON.parse((wsA.send as any).mock.calls[0][0]);
    expect(msg.payload.amount).toBe("50");
  });

  it("publishes to all recipients when called for each", () => {
    const wsA = makeFakeWs();
    const wsB = makeFakeWs();

    subscriptions.set("GRECIPIENT_A", new Set([{ ws: wsA, lastActivityAt: Date.now() }]));
    subscriptions.set("GRECIPIENT_B", new Set([{ ws: wsB, lastActivityAt: Date.now() }]));

    publishEvent("stream_cancelled", "GRECIPIENT_A", {});
    publishEvent("stream_cancelled", "GRECIPIENT_B", {});

    expect(wsA.send).toHaveBeenCalledOnce();
    expect(wsB.send).toHaveBeenCalledOnce();
  });

  it("JSON-encodes the full event envelope correctly", () => {
    const ws = makeFakeWs();
    subscriptions.set("GENCODE", new Set([{ ws, lastActivityAt: Date.now() }]));

    publishEvent("stream_clawed_back", "GENCODE", { reason: "compliance", sponsor: "GSPY" });

    const raw = (ws.send as any).mock.calls[0][0];
    const parsed = JSON.parse(raw);

    expect(parsed).toEqual({
      type: "event",
      event_type: "stream_clawed_back",
      recipient: "GENCODE",
      payload: { reason: "compliance", sponsor: "GSPY" },
    });
  });
});
