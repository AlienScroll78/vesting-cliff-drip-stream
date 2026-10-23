/**
 * Issue #740 — WebSocket endpoint for real-time stream event notifications.
 *
 * Endpoint: ws://<host>/api/ws/streams/:recipient
 *
 * On connection the server:
 *   1. Validates the recipient address (G-prefixed Stellar public key).
 *   2. Sends a snapshot of the current stream state (claimable amount).
 *   3. Subscribes to Redis Pub/Sub channel `stream:events:<recipient>`.
 *   4. Replays the last 100 events from the Redis circular buffer
 *      `stream:events:buffer:<recipient>` (missed-event recovery on reconnect).
 *   5. Forwards any new events published to the channel in real time.
 *   6. Sends a heartbeat `{ "type": "ping" }` every 30 s; expects
 *      `{ "type": "pong" }` in return (stale connections are terminated after
 *      two missed heartbeats).
 *
 * Rate limiting:
 *   Max 100 concurrent WebSocket connections per source IP address.
 *
 * Message format (server → client):
 *   {
 *     "type": "TokensClaimed" | "StreamCreated" | "StreamCancelled" |
 *             "StreamClawedBack" | "StreamDrained" | "snapshot" | "ping" | "error",
 *     "recipient": "G...",
 *     "amount":    <number, for TokensClaimed>,
 *     "ledger":    <number>,
 *     "timestamp": "<ISO 8601>"
 *   }
 *
 * Redis channels:
 *   stream:events:<recipient>        — Pub/Sub channel for real-time events
 *   stream:events:buffer:<recipient> — Redis List acting as circular buffer
 *                                      (LPUSH + LTRIM to keep last 100)
 *
 * Publishing events (from the indexer or any backend worker):
 *   import { publishStreamEvent } from "./wsStreams.js";
 *   await publishStreamEvent(redisClient, "G...", { type: "TokensClaimed", ... });
 */

import { IncomingMessage, Server as HttpServer } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { createClient } from "redis";
import { networkConfig } from "./config/network.js";

// ── Constants ─────────────────────────────────────────────────────────────────

const HEARTBEAT_INTERVAL_MS = parseInt(
  process.env.WS_HEARTBEAT_INTERVAL_MS ?? "30000",
  10
);
const MAX_CONNECTIONS_PER_IP = parseInt(
  process.env.WS_MAX_CONNECTIONS_PER_IP ?? "100",
  10
);
const MAX_MISSED_HEARTBEATS = 2;
const EVENT_BUFFER_SIZE = 100;

// ── Redis helpers (lazy singleton subscribers per recipient) ──────────────────

/**
 * Build the Redis Pub/Sub channel name for a recipient.
 */
export function streamEventChannel(recipient: string): string {
  return `stream:events:${recipient}`;
}

/**
 * Build the Redis List key used as an event replay buffer.
 */
export function streamEventBufferKey(recipient: string): string {
  return `stream:events:buffer:${recipient}`;
}

/**
 * Create a dedicated Redis subscriber client.
 * Each WebSocket connection gets its own subscriber so it can be
 * un-subscribed independently on close.
 */
async function createSubscriberClient(): Promise<ReturnType<typeof createClient> | null> {
  const url = process.env.REDIS_URL;
  if (!url) return null;
  try {
    const sub = createClient({ url });
    sub.on("error", () => {});
    await sub.connect();
    return sub;
  } catch {
    return null;
  }
}

/**
 * Retrieve a shared "publisher" Redis client for writing to the event buffer
 * and publishing to channels. Falls back to null when Redis is unavailable.
 */
let _pubClient: ReturnType<typeof createClient> | null = null;

async function getPubClient(): Promise<ReturnType<typeof createClient> | null> {
  if (!process.env.REDIS_URL) return null;
  if (_pubClient?.isOpen) return _pubClient;
  try {
    _pubClient = createClient({ url: process.env.REDIS_URL });
    _pubClient.on("error", () => {});
    await _pubClient.connect();
    return _pubClient;
  } catch {
    return null;
  }
}

// ── In-process event bus (fallback when Redis is unavailable) ─────────────────

type StreamEventPayload = Record<string, unknown>;

/** recipient → Set of listener callbacks */
const _localBus = new Map<string, Set<(msg: string) => void>>();

/** In-process event buffer: recipient → circular array of the last 100 events */
const _localBuffer = new Map<string, string[]>();

function localBusSubscribe(
  recipient: string,
  callback: (msg: string) => void
): void {
  if (!_localBus.has(recipient)) _localBus.set(recipient, new Set());
  _localBus.get(recipient)!.add(callback);
}

function localBusUnsubscribe(
  recipient: string,
  callback: (msg: string) => void
): void {
  _localBus.get(recipient)?.delete(callback);
  if (_localBus.get(recipient)?.size === 0) _localBus.delete(recipient);
}

function localBusPublish(recipient: string, msg: string): void {
  // Push to local buffer
  if (!_localBuffer.has(recipient)) _localBuffer.set(recipient, []);
  const buf = _localBuffer.get(recipient)!;
  buf.unshift(msg);
  if (buf.length > EVENT_BUFFER_SIZE) buf.pop();

  // Broadcast
  _localBus.get(recipient)?.forEach((cb) => cb(msg));
}

function localBusGetBuffer(recipient: string): string[] {
  return _localBuffer.get(recipient) ?? [];
}

// ── Public publish API ────────────────────────────────────────────────────────

/**
 * Publish a stream event for a recipient.
 *
 * Call this from the indexer or any backend worker when an on-chain event
 * is confirmed. When Redis is available, the event is:
 *   - appended to the circular replay buffer (LPUSH + LTRIM)
 *   - published to the Pub/Sub channel
 *
 * When Redis is unavailable, the in-process bus is used as a fallback.
 *
 * @param recipient  Stellar G... address of the stream recipient
 * @param event      The event payload (must include `type`, `ledger`, `timestamp`)
 */
export async function publishStreamEvent(
  recipient: string,
  event: StreamEventPayload
): Promise<void> {
  const msg = JSON.stringify({ ...event, recipient });
  const redis = await getPubClient();

  if (redis) {
    try {
      const bufKey = streamEventBufferKey(recipient);
      const channel = streamEventChannel(recipient);
      await Promise.all([
        redis.lPush(bufKey, msg).then(() =>
          redis.lTrim(bufKey, 0, EVENT_BUFFER_SIZE - 1)
        ),
        redis.publish(channel, msg),
      ]);
      return;
    } catch {
      // Fall through to in-process bus
    }
  }

  localBusPublish(recipient, msg);
}

// ── IP-based connection rate limit ────────────────────────────────────────────

/** Source IP → number of open WebSocket connections */
const _ipConnectionCount = new Map<string, number>();

function incrementIpCount(ip: string): number {
  const current = _ipConnectionCount.get(ip) ?? 0;
  _ipConnectionCount.set(ip, current + 1);
  return current + 1;
}

function decrementIpCount(ip: string): void {
  const current = _ipConnectionCount.get(ip) ?? 1;
  if (current <= 1) {
    _ipConnectionCount.delete(ip);
  } else {
    _ipConnectionCount.set(ip, current - 1);
  }
}

// ── Stellar address validation ────────────────────────────────────────────────

const STELLAR_ADDRESS_RE = /^G[A-Z2-7]{55}$/;

function isValidStellarAddress(addr: string): boolean {
  return STELLAR_ADDRESS_RE.test(addr);
}

// ── Claimable snapshot helper ─────────────────────────────────────────────────

async function fetchClaimableSnapshot(
  recipient: string
): Promise<string> {
  try {
    // @ts-ignore — optional peer dep, loaded at runtime
    const sdk = await import("@stellar/stellar-sdk");
    const server = new sdk.SorobanRpc.Server(networkConfig.rpcUrl);
    const contract = new sdk.Contract(networkConfig.contractId);

    const dummyAcct = {
      accountId: () => recipient,
      sequenceNumber: () => "0",
      incrementSequenceNumber: () => {},
    };

    const tx = new sdk.TransactionBuilder(dummyAcct, {
      fee: sdk.BASE_FEE,
      networkPassphrase: networkConfig.networkPassphrase,
    })
      .addOperation(
        contract.call(
          "claimable_amount",
          sdk.Address.fromString(recipient).toScVal()
        )
      )
      .setTimeout(15)
      .build();

    const sim = await server.simulateTransaction(tx);
    return sim.result?.retval?.value()?.toString() ?? "0";
  } catch {
    return "0";
  }
}

// ── WebSocket server ──────────────────────────────────────────────────────────

/**
 * Attach a WebSocket server to the HTTP server at path `/api/ws/streams/:recipient`.
 *
 * Because the `ws` package's `WebSocketServer` does not support path
 * parameters natively, we handle routing inside the `connection` event by
 * parsing `req.url`.
 */
export function attachStreamWebSocketServer(
  httpServer: HttpServer
): WebSocketServer {
  const wss = new WebSocketServer({
    server: httpServer,
    path: undefined, // handle all WS upgrades; filter by URL below
  });

  wss.on("connection", async (ws: WebSocket, req: IncomingMessage) => {
    // ── URL routing: only handle /api/ws/streams/:recipient ───────────────
    const url = req.url ?? "";
    const match = url.match(/^\/api\/ws\/streams\/([^/?#]+)/);

    if (!match) {
      // Not our endpoint — close without action (let other WS handlers own it)
      ws.close(1008, "Unknown path");
      return;
    }

    const recipient = decodeURIComponent(match[1]);

    // ── Validate recipient address ─────────────────────────────────────────
    if (!isValidStellarAddress(recipient)) {
      ws.send(
        JSON.stringify({
          type: "error",
          message: "Invalid recipient address. Must be a Stellar G... public key.",
        })
      );
      ws.close(1008, "Invalid recipient");
      return;
    }

    // ── IP rate limiting ──────────────────────────────────────────────────
    const sourceIp =
      (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ??
      req.socket?.remoteAddress ??
      "unknown";

    const count = incrementIpCount(sourceIp);
    if (count > MAX_CONNECTIONS_PER_IP) {
      decrementIpCount(sourceIp);
      ws.send(
        JSON.stringify({
          type: "error",
          message: `Too many connections from this IP (max ${MAX_CONNECTIONS_PER_IP})`,
        })
      );
      ws.close(1008, "Rate limit exceeded");
      return;
    }

    // ── State for this connection ─────────────────────────────────────────
    let missedHeartbeats = 0;
    let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
    let subscriberClient: ReturnType<typeof createClient> | null = null;
    let localCallback: ((msg: string) => void) | null = null;
    let closed = false;

    function cleanup(): void {
      if (closed) return;
      closed = true;

      decrementIpCount(sourceIp);

      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }

      // Unsubscribe from Redis
      if (subscriberClient) {
        subscriberClient
          .unsubscribe(streamEventChannel(recipient))
          .catch(() => {})
          .finally(() => {
            subscriberClient?.quit().catch(() => {});
            subscriberClient = null;
          });
      }

      // Unsubscribe from local bus
      if (localCallback) {
        localBusUnsubscribe(recipient, localCallback);
        localCallback = null;
      }
    }

    ws.on("close", cleanup);
    ws.on("error", cleanup);

    // ── Step 1: send initial stream state snapshot ────────────────────────
    try {
      const [claimable, latestLedger] = await Promise.all([
        fetchClaimableSnapshot(recipient),
        (async () => {
          try {
            // @ts-ignore
            const sdk = await import("@stellar/stellar-sdk");
            const server = new sdk.SorobanRpc.Server(networkConfig.rpcUrl);
            return (await server.getLatestLedger()).sequence as number;
          } catch {
            return null;
          }
        })(),
      ]);

      if (ws.readyState === WebSocket.OPEN) {
        ws.send(
          JSON.stringify({
            type: "snapshot",
            recipient,
            claimable_amount: claimable,
            ledger: latestLedger,
            timestamp: new Date().toISOString(),
          })
        );
      }
    } catch {
      // Non-fatal — continue with subscription
    }

    // ── Step 2: replay missed events from buffer ──────────────────────────
    const redis = await getPubClient();
    if (redis) {
      try {
        const bufKey = streamEventBufferKey(recipient);
        const buffered = await redis.lRange(bufKey, 0, EVENT_BUFFER_SIZE - 1);
        // buffered is newest-first (LPUSH); reverse for chronological order
        for (const raw of buffered.reverse()) {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(raw);
          }
        }
      } catch {
        // Fall through — replay from local buffer
        const localEvents = localBusGetBuffer(recipient);
        for (const raw of [...localEvents].reverse()) {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(raw);
          }
        }
      }
    } else {
      const localEvents = localBusGetBuffer(recipient);
      for (const raw of [...localEvents].reverse()) {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(raw);
        }
      }
    }

    // ── Step 3: subscribe to Redis Pub/Sub (or local bus fallback) ────────
    subscriberClient = await createSubscriberClient();

    if (subscriberClient) {
      try {
        await subscriberClient.subscribe(
          streamEventChannel(recipient),
          (message: string) => {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(message);
            }
          }
        );
      } catch {
        subscriberClient = null;
        // Fall through to local bus
      }
    }

    if (!subscriberClient) {
      localCallback = (msg: string) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(msg);
        }
      };
      localBusSubscribe(recipient, localCallback);
    }

    // ── Step 4: heartbeat ping/pong every 30 s ────────────────────────────
    heartbeatTimer = setInterval(() => {
      if (ws.readyState !== WebSocket.OPEN) {
        cleanup();
        return;
      }

      missedHeartbeats += 1;
      if (missedHeartbeats > MAX_MISSED_HEARTBEATS) {
        ws.terminate();
        cleanup();
        return;
      }

      ws.send(JSON.stringify({ type: "ping", timestamp: new Date().toISOString() }));
    }, HEARTBEAT_INTERVAL_MS);

    // Unref so heartbeat timers do not prevent process from exiting cleanly
    if (
      heartbeatTimer &&
      typeof heartbeatTimer === "object" &&
      "unref" in heartbeatTimer
    ) {
      (heartbeatTimer as any).unref();
    }

    // ── Step 5: handle incoming client messages ───────────────────────────
    ws.on("message", (raw) => {
      let msg: any;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        ws.send(JSON.stringify({ type: "error", message: "invalid JSON" }));
        return;
      }

      if (msg?.type === "pong") {
        // Client acknowledged heartbeat — reset counter
        missedHeartbeats = 0;
        return;
      }

      // Unknown message types are silently ignored
    });
  });

  return wss;
}
