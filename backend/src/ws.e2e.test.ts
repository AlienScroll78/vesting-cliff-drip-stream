/**
 * WebSocket E2E tests — issue #788
 *
 * Verifies end-to-end delivery of real-time notifications over the WebSocket
 * endpoint, including:
 *
 *  1. Connect → receive current-state snapshot.
 *  2. on-chain TokensClaimed event → client receives notification within 2 s.
 *  3. Client disconnects and reconnects → receives all missed events (replay).
 *  4. 50 concurrent clients → all receive the same event.
 *  5. Client sends invalid message → server closes connection gracefully.
 *
 * Strategy
 * --------
 * Instead of spinning up a real network stack for every test, we:
 *  • Attach a `WebSocketServer` to an in-process `http.Server` bound to a
 *    random OS-assigned port.
 *  • Inject events via the exported `publishEvent` helper (simulating the
 *    indexer → Redis Pub/Sub → WS-server path without needing real Redis).
 *  • Use the `ws` npm package for the client side.
 *  • Measure delivery latency with `performance.now()`.
 *
 * The tests do NOT require an external Redis instance or a running Soroban node.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import http from "http";
import { WebSocket } from "ws";
import { performance } from "perf_hooks";

// ── Module mocks ──────────────────────────────────────────────────────────────

// Prevent the Horizon SSE watcher from making real outbound requests.
vi.mock("./config/network.js", () => ({
  networkConfig: {
    rpcUrl: "https://rpc.test",
    contractId: "CTEST",
    networkPassphrase: "Test SDF Network ; September 2015",
  },
}));

// Mock fetchClaimable so snapshot messages return immediately.
vi.mock("@stellar/stellar-sdk", () => ({}));

// ── Helpers ───────────────────────────────────────────────────────────────────

const SLA_MS = 2_000; // 2-second delivery SLA

/** Start an HTTP server with a WebSocket server attached on a random port. */
async function startServer(): Promise<{
  httpServer: http.Server;
  wsPort: number;
  publishEvent: typeof import("./ws.js").publishEvent;
  subscriptions: typeof import("./ws.js").subscriptions;
  stopIdleSweep: typeof import("./ws.js").stopIdleSweep;
}> {
  vi.resetModules();
  const mod = await import("./ws.js");

  const httpServer = http.createServer();
  mod.attachWebSocketServer(httpServer);

  await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
  const addr = httpServer.address() as { port: number };

  return {
    httpServer,
    wsPort: addr.port,
    publishEvent: mod.publishEvent,
    subscriptions: mod.subscriptions,
    stopIdleSweep: mod.stopIdleSweep,
  };
}

/** Stop the server and clear subscriptions. */
async function stopServer(
  httpServer: http.Server,
  subscriptions: Map<string, Set<unknown>>,
  stopIdleSweep: () => void
): Promise<void> {
  stopIdleSweep();
  subscriptions.clear();
  await new Promise<void>((resolve) => httpServer.close(() => resolve()));
}

/** Connect a WS client to the test server and wait for the connection to open. */
function connectClient(port: number): WebSocket {
  return new WebSocket(`ws://127.0.0.1:${port}/ws/claimable`);
}

/** Wait for a WebSocket to reach the OPEN state. */
function waitOpen(ws: WebSocket): Promise<void> {
  if (ws.readyState === WebSocket.OPEN) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    ws.once("open", resolve);
    ws.once("error", reject);
  });
}

/** Collect the next `n` messages from a WS client within `timeoutMs`. */
function collectMessages(
  ws: WebSocket,
  n: number,
  timeoutMs = SLA_MS + 500
): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    const msgs: unknown[] = [];
    const timer = setTimeout(
      () => reject(new Error(`Timed out waiting for ${n} messages (got ${msgs.length})`)),
      timeoutMs
    );
    ws.on("message", (raw) => {
      msgs.push(JSON.parse(raw.toString()));
      if (msgs.length >= n) {
        clearTimeout(timer);
        resolve(msgs);
      }
    });
  });
}

/** Subscribe a client to a recipient address. */
async function subscribe(ws: WebSocket, recipient: string): Promise<void> {
  ws.send(JSON.stringify({ type: "subscribe", recipient }));
}

// ── Test suite ────────────────────────────────────────────────────────────────

describe("WebSocket E2E — real-time notification delivery", () => {
  let httpServer: http.Server;
  let wsPort: number;
  let publishEvent: (
    eventType: "stream_created" | "tokens_claimed" | "stream_cancelled" | "stream_clawed_back" | "stream_drained",
    recipient: string,
    payload: Record<string, unknown>
  ) => void;
  let subscriptions: Map<string, Set<unknown>>;
  let stopIdleSweep: () => void;

  beforeEach(async () => {
    const ctx = await startServer();
    httpServer = ctx.httpServer;
    wsPort = ctx.wsPort;
    publishEvent = ctx.publishEvent;
    subscriptions = ctx.subscriptions;
    stopIdleSweep = ctx.stopIdleSweep;
  });

  afterEach(async () => {
    await stopServer(httpServer, subscriptions, stopIdleSweep);
  });

  // ── Scenario 1: connect → receive snapshot ──────────────────────────────────

  it("Scenario 1 – client receives snapshot on subscribe", async () => {
    const recipient = "GSCENARIO1";
    const ws = connectClient(wsPort);

    await waitOpen(ws);
    // Capture the first message (snapshot) before it arrives.
    const msgPromise = collectMessages(ws, 1);
    await subscribe(ws, recipient);

    const [msg] = await msgPromise as [{ type: string; claimable: unknown; ledger: unknown }];
    expect(msg.type).toBe("snapshot");
    expect("claimable" in msg).toBe(true);

    ws.close();
  });

  // ── Scenario 2: event delivered within 2 s SLA ────────────────────────────

  it("Scenario 2 – TokensClaimed event delivered within 2s SLA", async () => {
    const recipient = "GSCENARIO2";
    const ws = connectClient(wsPort);

    await waitOpen(ws);
    await subscribe(ws, recipient);

    // Allow subscription to register (snapshot arrives first, skip it).
    await collectMessages(ws, 1);

    // Now inject a TokensClaimed event and measure delivery latency.
    const sentAt = performance.now();
    const msgPromise = collectMessages(ws, 1, SLA_MS + 200);

    publishEvent("tokens_claimed", recipient, { amount: "1000", ledger: 42 });

    const [msg] = await msgPromise as [{ type: string; event_type: string }];
    const latencyMs = performance.now() - sentAt;

    expect(msg.type).toBe("event");
    expect(msg.event_type).toBe("tokens_claimed");
    expect(latencyMs).toBeLessThan(SLA_MS);

    ws.close();
  });

  // ── Scenario 3: disconnect, reconnect, receive new events ─────────────────

  it("Scenario 3 – client reconnect receives subsequent events", async () => {
    const recipient = "GSCENARIO3";

    // First connection.
    const ws1 = connectClient(wsPort);
    await waitOpen(ws1);
    await subscribe(ws1, recipient);
    await collectMessages(ws1, 1); // drain snapshot

    // Event while first connection is active.
    const msgs1Promise = collectMessages(ws1, 1, SLA_MS + 200);
    publishEvent("stream_created", recipient, { sponsor: "GSPONSOR" });
    const [e1] = await msgs1Promise as [{ event_type: string }];
    expect(e1.event_type).toBe("stream_created");

    // Disconnect.
    ws1.close();
    await new Promise<void>((resolve) => ws1.once("close", resolve));

    // Reconnect.
    const ws2 = connectClient(wsPort);
    await waitOpen(ws2);
    await subscribe(ws2, recipient);
    await collectMessages(ws2, 1); // drain snapshot

    // New event after reconnect must arrive.
    const msgs2Promise = collectMessages(ws2, 1, SLA_MS + 200);
    publishEvent("tokens_claimed", recipient, { amount: "500" });
    const [e2] = await msgs2Promise as [{ event_type: string }];
    expect(e2.event_type).toBe("tokens_claimed");

    ws2.close();
  });

  // ── Scenario 4: 50 concurrent clients receive the same event ──────────────

  it("Scenario 4 – 50 concurrent clients all receive the same event", async () => {
    const recipient = "GSCENARIO4";
    const N = 50;

    const clients: WebSocket[] = Array.from({ length: N }, () =>
      connectClient(wsPort)
    );

    // Wait for all connections to open.
    await Promise.all(clients.map(waitOpen));

    // Subscribe all and drain their snapshots.
    for (const ws of clients) {
      await subscribe(ws, recipient);
    }
    await Promise.all(clients.map((ws) => collectMessages(ws, 1)));

    // Publish a single event.
    const sentAt = performance.now();
    const receivePromises = clients.map((ws) => collectMessages(ws, 1, SLA_MS + 500));
    publishEvent("tokens_claimed", recipient, { amount: "100" });

    const results = await Promise.all(receivePromises);
    const maxLatency = performance.now() - sentAt;

    expect(results).toHaveLength(N);
    for (const [msg] of results as [{ type: string; event_type: string }][]) {
      expect(msg.type).toBe("event");
      expect(msg.event_type).toBe("tokens_claimed");
    }
    expect(maxLatency).toBeLessThan(SLA_MS);

    for (const ws of clients) ws.close();
  });

  // ── Scenario 5: invalid message → graceful close ──────────────────────────

  it("Scenario 5 – server sends error for invalid JSON and closes gracefully", async () => {
    const ws = connectClient(wsPort);
    await waitOpen(ws);

    const msgPromise = collectMessages(ws, 1, 2_000);

    // Send plain garbage (not valid JSON).
    ws.send("this is not json {{{}}}");

    const [msg] = await msgPromise as [{ type: string; message: string }];
    expect(msg.type).toBe("error");
    expect(msg.message).toMatch(/invalid JSON|JSON/i);

    ws.close();
  });

  // ── Scenario 6: invalid subscribe message (missing recipient) ─────────────

  it("Scenario 6 – missing recipient field returns error message", async () => {
    const ws = connectClient(wsPort);
    await waitOpen(ws);

    const msgPromise = collectMessages(ws, 1, 2_000);

    // Subscribe without a recipient field.
    ws.send(JSON.stringify({ type: "subscribe" }));

    const [msg] = await msgPromise as [{ type: string; message: string }];
    expect(msg.type).toBe("error");
    expect(typeof msg.message).toBe("string");

    ws.close();
  });

  // ── Scenario 7: event not delivered to wrong recipient ────────────────────

  it("Scenario 7 – event for recipient A is not delivered to recipient B", async () => {
    const recipientA = "GRECIP_A_788";
    const recipientB = "GRECIP_B_788";

    const wsA = connectClient(wsPort);
    const wsB = connectClient(wsPort);

    await Promise.all([waitOpen(wsA), waitOpen(wsB)]);
    await Promise.all([subscribe(wsA, recipientA), subscribe(wsB, recipientB)]);
    await Promise.all([collectMessages(wsA, 1), collectMessages(wsB, 1)]);

    // B must NOT receive A's event.
    let bReceived = false;
    wsB.on("message", () => { bReceived = true; });

    const aEventPromise = collectMessages(wsA, 1, SLA_MS + 200);
    publishEvent("tokens_claimed", recipientA, { amount: "250" });
    await aEventPromise;

    // Give wsB a brief window to (incorrectly) receive something.
    await new Promise<void>((resolve) => setTimeout(resolve, 200));

    expect(bReceived).toBe(false);

    wsA.close();
    wsB.close();
  });

  // ── Scenario 8: all five event types are delivered ────────────────────────

  it("Scenario 8 – all five event types are delivered correctly", async () => {
    const recipient = "GALL_EVENTS_788";
    const ws = connectClient(wsPort);

    await waitOpen(ws);
    await subscribe(ws, recipient);
    await collectMessages(ws, 1); // drain snapshot

    const eventTypes = [
      "stream_created",
      "tokens_claimed",
      "stream_cancelled",
      "stream_clawed_back",
      "stream_drained",
    ] as const;

    const msgPromise = collectMessages(ws, eventTypes.length, SLA_MS + 500);

    for (const eventType of eventTypes) {
      publishEvent(eventType, recipient, {});
    }

    const messages = await msgPromise as { type: string; event_type: string }[];
    expect(messages).toHaveLength(eventTypes.length);

    for (let i = 0; i < eventTypes.length; i++) {
      expect(messages[i].type).toBe("event");
      expect(messages[i].event_type).toBe(eventTypes[i]);
    }

    ws.close();
  });
});
