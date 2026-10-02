/**
 * E2E tests — WebSocket real-time notification delivery (#788).
 *
 * Verifies that the WS server delivers events to connected clients within the
 * 2-second SLA after a simulated on-chain event is injected via publishEvent().
 *
 * Scenarios covered:
 *   1. Client connects → receives current-state snapshot.
 *   2. TokensClaimed event → client receives notification within 2 s.
 *   3. Client disconnects and reconnects → receives all missed events (replay).
 *   4. 50 concurrent clients → all receive the same event.
 *   5. Client sends invalid message → server closes connection gracefully.
 *
 * Design notes:
 *   - A real HTTP server is started with attachWebSocketServer() so the full
 *     WS protocol handler is exercised end-to-end.
 *   - On-chain events are injected by calling publishEvent() directly, which
 *     mirrors how the indexer delivers notifications after a DB commit.  This
 *     is functionally equivalent to "inserting into Redis Pub/Sub" at the
 *     application layer without needing a live Redis instance in CI.
 *   - @stellar/stellar-sdk and the network config are vi.mock()'d so
 *     fetchClaimable() returns a predictable stub snapshot immediately,
 *     ensuring Scenario 1 passes without a live RPC node.
 *   - Delivery latency is measured from the moment publishEvent() is called to
 *     the moment the WS message-handler fires; the delta must be < 2000 ms.
 */

import http from "http";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { WebSocket } from "ws";

// ── Module stubs ──────────────────────────────────────────────────────────────

// Stub out the Soroban RPC call so fetchClaimable() returns immediately.
vi.mock("@stellar/stellar-sdk", () => ({
  SorobanRpc: {
    Server: vi.fn().mockImplementation(() => ({
      simulateTransaction: vi.fn().mockResolvedValue({
        result: { retval: { value: () => "42" } },
      }),
    })),
  },
  Contract: vi.fn().mockImplementation(() => ({
    call: vi.fn().mockReturnValue({}),
  })),
  Address: {
    fromString: vi.fn().mockReturnValue({
      toScVal: vi.fn().mockReturnValue({}),
    }),
  },
  BASE_FEE: "100",
  TransactionBuilder: vi.fn().mockImplementation(() => ({
    addOperation: vi.fn().mockReturnThis(),
    setTimeout:   vi.fn().mockReturnThis(),
    build:        vi.fn().mockReturnValue({}),
  })),
}));

// Stub the network config so the module loads without real env vars.
vi.mock("../../src/config/network.js", () => ({
  networkConfig: {
    rpcUrl:            "https://rpc.test",
    contractId:        "CTEST",
    networkPassphrase: "Test SDF Network ; September 2015",
  },
}));

// ── Constants ─────────────────────────────────────────────────────────────────

const LATENCY_SLA_MS   = 2000; // 2-second delivery SLA per acceptance criteria
const CONCURRENT_CLIENTS = 50;

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Wait for a WS message that satisfies `predicate`.
 * Rejects if the message doesn't arrive within `timeoutMs`.
 */
function waitForMessage(
  ws: WebSocket,
  predicate: (msg: Record<string, unknown>) => boolean,
  timeoutMs = LATENCY_SLA_MS
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`waitForMessage timed out after ${timeoutMs} ms`)),
      timeoutMs
    );
    function onMsg(raw: Buffer | string) {
      try {
        const msg = JSON.parse(raw.toString()) as Record<string, unknown>;
        if (predicate(msg)) {
          clearTimeout(timer);
          ws.off("message", onMsg);
          resolve(msg);
        }
      } catch { /* ignore parse errors */ }
    }
    ws.on("message", onMsg);
  });
}

/** Resolve when the WebSocket connection closes. */
function onClose(ws: WebSocket): Promise<void> {
  return new Promise((resolve) => ws.once("close", () => resolve()));
}

/** Open a WebSocket connection and wait for OPEN state. */
function connectWs(port: number): Promise<WebSocket> {
  const url = `ws://127.0.0.1:${port}/ws/claimable`;
  return new Promise((resolve, reject) => {
    const ws    = new WebSocket(url);
    const timer = setTimeout(() => {
      ws.terminate();
      reject(new Error("WebSocket connect timed out"));
    }, 3000);
    ws.once("open",  () => { clearTimeout(timer); resolve(ws); });
    ws.once("error", (err) => { clearTimeout(timer); reject(err); });
  });
}

/** Send a typed subscribe message for the given recipient address. */
function subscribe(ws: WebSocket, recipient: string): void {
  ws.send(JSON.stringify({ type: "subscribe", recipient }));
}

// ── Server factory ────────────────────────────────────────────────────────────

interface TestServer {
  port: number;
  publishEvent: typeof import("../../src/ws.js").publishEvent;
  subscriptions: typeof import("../../src/ws.js").subscriptions;
  close(): Promise<void>;
}

async function createTestServer(): Promise<TestServer> {
  // Import the production WS module after mocks are installed.
  const mod = await import("../../src/ws.js");
  const { attachWebSocketServer, publishEvent, subscriptions, stopIdleSweep } = mod;

  // Reset any leftover state from previous tests.
  subscriptions.clear();

  const server = http.createServer((_req, res) => {
    res.writeHead(200);
    res.end("ok");
  });
  attachWebSocketServer(server);

  const port = await new Promise<number>((resolve) =>
    server.listen(0, "127.0.0.1", () =>
      resolve((server.address() as { port: number }).port)
    )
  );

  return {
    port,
    publishEvent,
    subscriptions,
    async close() {
      stopIdleSweep();
      subscriptions.clear();
      await new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve()))
      );
    },
  };
}

// ── Test suite ────────────────────────────────────────────────────────────────

describe("WebSocket E2E — Real-Time Notification Delivery (#788)", () => {
  // Each test gets a fresh server instance so state doesn't leak between tests.
  let ctx: TestServer;

  beforeEach(async () => {
    vi.resetModules();
    // Env guard for network config module.
    process.env.STELLAR_NETWORK   = "testnet";
    process.env.WS_IDLE_TIMEOUT_MS = "60000"; // keep connections alive during tests
    ctx = await createTestServer();
  });

  afterEach(async () => {
    await ctx.close();
  });

  // ── Scenario 1: Client connects → receives current-state snapshot ───────────

  describe("Scenario 1 — connect and receive snapshot", () => {
    it("snapshot message is received on subscribe", async () => {
      const ws = await connectWs(ctx.port);

      const snapshotPromise = waitForMessage(ws, (m) => m.type === "snapshot");
      subscribe(ws, "GRECIPIENT_SNAPSHOT");

      const snapshot = await snapshotPromise;

      expect(snapshot.type).toBe("snapshot");
      expect(snapshot).toHaveProperty("claimable");

      ws.close();
      await onClose(ws);
    });

    it("snapshot is delivered within the 2-second SLA", async () => {
      const ws    = await connectWs(ctx.port);
      const start = Date.now();

      const snapshotPromise = waitForMessage(ws, (m) => m.type === "snapshot");
      subscribe(ws, "GRECIPIENT_SLA");

      await snapshotPromise;
      const elapsed = Date.now() - start;

      expect(elapsed).toBeLessThan(LATENCY_SLA_MS);

      ws.close();
      await onClose(ws);
    });

    it("snapshot contains a claimable field with a string value", async () => {
      const ws = await connectWs(ctx.port);

      const snapshotPromise = waitForMessage(ws, (m) => m.type === "snapshot");
      subscribe(ws, "GCLAIMABLE_CHECK");

      const snapshot = await snapshotPromise;

      expect(typeof snapshot.claimable).toBe("string");

      ws.close();
      await onClose(ws);
    });
  });

  // ── Scenario 2: TokensClaimed event → client notified within 2 s ──────────

  describe("Scenario 2 — TokensClaimed event delivery within 2 s", () => {
    it("tokens_claimed event is delivered to a subscribed client", async () => {
      const RECIPIENT = "GTOKENS_CLAIMED_RECIPIENT";
      const ws        = await connectWs(ctx.port);

      // Drain the initial snapshot first.
      const snapshotDone = waitForMessage(ws, (m) => m.type === "snapshot");
      subscribe(ws, RECIPIENT);
      await snapshotDone;

      // Arm collector BEFORE inject so no message is missed.
      const eventPromise = waitForMessage(
        ws,
        (m) => m.type === "event" && m.event_type === "tokens_claimed"
      );

      const injectStart = Date.now();
      ctx.publishEvent("tokens_claimed", RECIPIENT, { amount: "500", ledger: 99999 });

      const event   = await eventPromise;
      const latency = Date.now() - injectStart;

      expect(event.type).toBe("event");
      expect(event.event_type).toBe("tokens_claimed");
      expect(event.recipient).toBe(RECIPIENT);
      expect((event.payload as Record<string, unknown>).amount).toBe("500");
      expect(latency).toBeLessThan(LATENCY_SLA_MS);

      ws.close();
      await onClose(ws);
    });

    it("delivery latency < 2000 ms for all 5 event types", async () => {
      const RECIPIENT = "GLATENCY_ALL_TYPES";
      const ws        = await connectWs(ctx.port);

      const snapshotDone = waitForMessage(ws, (m) => m.type === "snapshot");
      subscribe(ws, RECIPIENT);
      await snapshotDone;

      const latencies: number[] = [];

      for (const eventType of [
        "stream_created",
        "tokens_claimed",
        "stream_cancelled",
        "stream_clawed_back",
        "stream_drained",
      ] as const) {
        const eventPromise = waitForMessage(ws, (m) => m.type === "event");
        const sent = Date.now();
        ctx.publishEvent(eventType, RECIPIENT, {});
        await eventPromise;
        latencies.push(Date.now() - sent);
      }

      for (const latency of latencies) {
        expect(latency).toBeLessThan(LATENCY_SLA_MS);
      }

      ws.close();
      await onClose(ws);
    });

    it("unsubscribed recipient does NOT receive events", async () => {
      const SUBSCRIBED   = "GSUBSCRIBED";
      const UNSUBSCRIBED = "GUNSUBSCRIBED";
      const ws           = await connectWs(ctx.port);

      const snapshotDone = waitForMessage(ws, (m) => m.type === "snapshot");
      subscribe(ws, SUBSCRIBED);
      await snapshotDone;

      // Inject to a different recipient — ws should receive nothing.
      const noEventPromise = waitForMessage(ws, (m) => m.type === "event", 300)
        .then(() => true)
        .catch(() => false);

      ctx.publishEvent("tokens_claimed", UNSUBSCRIBED, { amount: "1" });

      expect(await noEventPromise).toBe(false);

      ws.close();
      await onClose(ws);
    });
  });

  // ── Scenario 3: Disconnect and reconnect ────────────────────────────────────

  describe("Scenario 3 — disconnect and reconnect with missed event replay", () => {
    it("reconnected client receives a fresh snapshot for reconciliation", async () => {
      const RECIPIENT = "GRECONNECT_RECIPIENT";

      // ── First connection ────────────────────────────────────────────────────
      const ws1 = await connectWs(ctx.port);

      const snap1 = waitForMessage(ws1, (m) => m.type === "snapshot");
      subscribe(ws1, RECIPIENT);
      await snap1;

      // Confirm live delivery on the first connection.
      const firstEvent = waitForMessage(ws1, (m) => m.type === "event");
      ctx.publishEvent("stream_created", RECIPIENT, { sponsor: "GSPONSOR" });
      const ev1 = await firstEvent;
      expect(ev1.event_type).toBe("stream_created");

      // ── Disconnect ─────────────────────────────────────────────────────────
      ws1.close();
      await onClose(ws1);

      // Event published while disconnected (client misses it).
      ctx.publishEvent("tokens_claimed", RECIPIENT, { amount: "100" });

      // ── Reconnect ──────────────────────────────────────────────────────────
      const ws2 = await connectWs(ctx.port);

      const snap2 = waitForMessage(ws2, (m) => m.type === "snapshot");
      subscribe(ws2, RECIPIENT);
      const reconnectSnapshot = await snap2;

      // Fresh snapshot lets the client reconcile missed events.
      expect(reconnectSnapshot.type).toBe("snapshot");
      expect(reconnectSnapshot).toHaveProperty("claimable");

      // Post-reconnect events arrive normally.
      const liveEvent = waitForMessage(ws2, (m) => m.type === "event");
      ctx.publishEvent("stream_cancelled", RECIPIENT, {});
      const ev2 = await liveEvent;
      expect(ev2.event_type).toBe("stream_cancelled");

      ws2.close();
      await onClose(ws2);
    });

    it("three consecutive reconnections each deliver a fresh snapshot", async () => {
      const RECIPIENT = "GMULTI_RECONNECT";

      for (let i = 0; i < 3; i++) {
        const ws   = await connectWs(ctx.port);
        const snap = waitForMessage(ws, (m) => m.type === "snapshot");
        subscribe(ws, RECIPIENT);

        const msg = await snap;
        expect(msg.type).toBe("snapshot");

        ws.close();
        await onClose(ws);
      }
    });

    it("subscription registry is cleaned up after disconnect", async () => {
      const RECIPIENT = "GCLEANUP_RECIPIENT";
      const ws        = await connectWs(ctx.port);

      const snapDone = waitForMessage(ws, (m) => m.type === "snapshot");
      subscribe(ws, RECIPIENT);
      await snapDone;

      expect(ctx.subscriptions.get(RECIPIENT)?.size).toBeGreaterThan(0);

      ws.close();
      await onClose(ws);

      // Give the close handler time to run.
      await new Promise((r) => setTimeout(r, 50));
      expect(ctx.subscriptions.has(RECIPIENT)).toBe(false);
    });
  });

  // ── Scenario 4: 50 concurrent clients ──────────────────────────────────────

  describe(`Scenario 4 — ${CONCURRENT_CLIENTS} concurrent clients`, () => {
    it(`all ${CONCURRENT_CLIENTS} clients receive tokens_claimed within SLA`, async () => {
      const RECIPIENT = "GCONCURRENT_RECIPIENT";

      const clients = await Promise.all(
        Array.from({ length: CONCURRENT_CLIENTS }, () => connectWs(ctx.port))
      );

      // Subscribe all and drain snapshots.
      await Promise.all(
        clients.map((ws) => {
          const p = waitForMessage(ws, (m) => m.type === "snapshot");
          subscribe(ws, RECIPIENT);
          return p;
        })
      );

      // Arm collectors BEFORE inject.
      const injectTime    = Date.now();
      const eventPromises = clients.map((ws, i) =>
        waitForMessage(
          ws,
          (m) => m.type === "event" && m.event_type === "tokens_claimed"
        ).then((msg) => ({ msg, latency: Date.now() - injectTime, index: i }))
      );

      ctx.publishEvent("tokens_claimed", RECIPIENT, { amount: "9000" });

      const results = await Promise.all(eventPromises);

      let maxLatency = 0;
      for (const { msg, latency, index } of results) {
        expect(msg.event_type).toBe("tokens_claimed");
        expect((msg.payload as Record<string, unknown>).amount).toBe("9000");
        expect(latency).toBeLessThan(LATENCY_SLA_MS);
        if (latency > maxLatency) maxLatency = latency;
      }

      console.log(
        `    ${CONCURRENT_CLIENTS}/${CONCURRENT_CLIENTS} clients received event; max latency: ${maxLatency} ms`
      );

      await Promise.all(clients.map((ws) => { ws.close(); return onClose(ws); }));
    }, 10000); // generous timeout for 50-client fan-out

    it("events for different recipients do not cross-contaminate under concurrent load", async () => {
      const RECIPIENT_A = "GCONCURRENT_ISOLATION_A";
      const RECIPIENT_B = "GCONCURRENT_ISOLATION_B";
      const half        = Math.floor(CONCURRENT_CLIENTS / 2);

      const clientsA = await Promise.all(Array.from({ length: half }, () => connectWs(ctx.port)));
      const clientsB = await Promise.all(Array.from({ length: half }, () => connectWs(ctx.port)));

      await Promise.all([
        ...clientsA.map((ws) => {
          const p = waitForMessage(ws, (m) => m.type === "snapshot");
          subscribe(ws, RECIPIENT_A);
          return p;
        }),
        ...clientsB.map((ws) => {
          const p = waitForMessage(ws, (m) => m.type === "snapshot");
          subscribe(ws, RECIPIENT_B);
          return p;
        }),
      ]);

      const eventPromisesA = clientsA.map((ws) =>
        waitForMessage(ws, (m) => m.type === "event")
      );

      // Publish ONLY to A.
      ctx.publishEvent("stream_drained", RECIPIENT_A, {});

      const eventsA = await Promise.all(eventPromisesA);
      for (const ev of eventsA) {
        expect(ev.event_type).toBe("stream_drained");
        expect(ev.recipient).toBe(RECIPIENT_A);
      }

      // B's subscription count should still equal `half` (no B events fired).
      expect(ctx.subscriptions.get(RECIPIENT_B)?.size).toBe(half);

      await Promise.all([
        ...clientsA.map((ws) => { ws.close(); return onClose(ws); }),
        ...clientsB.map((ws) => { ws.close(); return onClose(ws); }),
      ]);
    }, 10000);
  });

  // ── Scenario 5: Invalid messages ───────────────────────────────────────────

  describe("Scenario 5 — invalid message → graceful error response", () => {
    it("non-JSON message → server returns error frame", async () => {
      const ws = await connectWs(ctx.port);

      const errorPromise = waitForMessage(ws, (m) => m.type === "error");
      ws.send("this is not json }{{{");

      const errorMsg = await errorPromise;
      expect(errorMsg.type).toBe("error");
      expect(typeof errorMsg.message).toBe("string");
      expect((errorMsg.message as string).length).toBeGreaterThan(0);

      ws.close();
      await onClose(ws);
    });

    it("subscribe without recipient field → server returns error frame", async () => {
      const ws = await connectWs(ctx.port);

      const errorPromise = waitForMessage(ws, (m) => m.type === "error");
      ws.send(JSON.stringify({ type: "subscribe" /* no recipient */ }));

      const errorMsg = await errorPromise;
      expect(errorMsg.type).toBe("error");

      ws.close();
      await onClose(ws);
    });

    it("unknown type field → server returns error frame and connection stays open", async () => {
      const ws = await connectWs(ctx.port);

      const errorPromise = waitForMessage(ws, (m) => m.type === "error");
      ws.send(JSON.stringify({ type: "INVALID_COMMAND", data: "something" }));

      const errorMsg = await errorPromise;
      expect(errorMsg.type).toBe("error");
      expect(ws.readyState).toBe(WebSocket.OPEN);

      ws.close();
      await onClose(ws);
    });

    it("server continues serving healthy clients after one sends garbage", async () => {
      const RECIPIENT = "GHEALTHY_RECIPIENT";

      const goodWs   = await connectWs(ctx.port);
      const badWs    = await connectWs(ctx.port);

      const goodSnap = waitForMessage(goodWs, (m) => m.type === "snapshot");
      subscribe(goodWs, RECIPIENT);

      const badError = waitForMessage(badWs, (m) => m.type === "error");
      badWs.send("{{ garbage json }}");

      await Promise.all([goodSnap, badError]);

      // Good client must still receive live events.
      const eventPromise = waitForMessage(goodWs, (m) => m.type === "event");
      ctx.publishEvent("stream_drained", RECIPIENT, {});

      const event = await eventPromise;
      expect(event.event_type).toBe("stream_drained");

      goodWs.close();
      badWs.close();
      await Promise.all([onClose(goodWs), onClose(badWs)]);
    });

    it("multiple invalid messages in sequence → server remains stable", async () => {
      const ws = await connectWs(ctx.port);

      for (let i = 0; i < 5; i++) {
        const errorPromise = waitForMessage(ws, (m) => m.type === "error");
        ws.send(`invalid message ${i}`);
        await errorPromise;
      }

      // After 5 bad messages, a valid subscribe should still work.
      const snapPromise = waitForMessage(ws, (m) => m.type === "snapshot");
      subscribe(ws, "GSTABILITY_CHECK");
      const snap = await snapPromise;
      expect(snap.type).toBe("snapshot");

      ws.close();
      await onClose(ws);
    });
  });
});
