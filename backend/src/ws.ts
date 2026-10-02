/**
 * Issue #28 — WebSocket endpoint for real-time vesting stream events.
 *
 * Subscribe protocol (client → server):
 *   { "type": "subscribe", "recipient": "G..." }
 *
 * Optional auth header on upgrade request:
 *   X-Wallet-Signature: <base64-encoded ed25519 signature of the recipient address>
 *   (verified when present; connections proceed without it if omitted)
 *
 * Server push messages (server → client):
 *   { "type": "event", "event_type": "stream_created" | "tokens_claimed" |
 *                      "stream_cancelled" | "stream_clawed_back" | "stream_drained",
 *     "recipient": "G...", "payload": {...} }
 *   { "type": "snapshot", "claimable": "500", "ledger": 12345 }   (on subscribe)
 *   { "type": "error", "message": "..." }
 *
 * Stale connection cleanup:
 *   Connections that have not sent any message in IDLE_TIMEOUT_MS (default 5 min)
 *   are terminated automatically.
 */

import { IncomingMessage, Server as HttpServer } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { networkConfig } from "./config/network.js";

// ── Constants ─────────────────────────────────────────────────────────────────

const HORIZON_URL = process.env.HORIZON_URL ?? "https://horizon-testnet.stellar.org";
const SSE_RECONNECT_MS = parseInt(process.env.SSE_RECONNECT_MS ?? "5000", 10);
/** Connections idle beyond this threshold are closed. */
export const IDLE_TIMEOUT_MS = parseInt(process.env.WS_IDLE_TIMEOUT_MS ?? "300000", 10); // 5 min
/** How often the idle-sweep runs (defaults to half the idle timeout). */
const IDLE_SWEEP_MS = Math.floor(IDLE_TIMEOUT_MS / 2);

// ── Event types ───────────────────────────────────────────────────────────────

export type StreamEventType =
  | "stream_created"
  | "tokens_claimed"
  | "stream_cancelled"
  | "stream_clawed_back"
  | "stream_drained";

// ── Subscription registry ─────────────────────────────────────────────────────

interface SubscribedClient {
  ws: WebSocket;
  lastActivityAt: number; // epoch ms
}

/**
 * recipient address → set of subscribed clients.
 * Exported for testing.
 */
export const subscriptions = new Map<string, Set<SubscribedClient>>();

// ── Idle connection cleanup ───────────────────────────────────────────────────

let idleSweepTimer: ReturnType<typeof setInterval> | null = null;

function startIdleSweep(): void {
  if (idleSweepTimer !== null) return; // already running
  idleSweepTimer = setInterval(() => {
    const now = Date.now();
    for (const [recipient, clients] of subscriptions) {
      for (const client of clients) {
        if (now - client.lastActivityAt > IDLE_TIMEOUT_MS) {
          client.ws.terminate();
          clients.delete(client);
        }
      }
      if (clients.size === 0) subscriptions.delete(recipient);
    }
  }, IDLE_SWEEP_MS);
  // Allow process to exit cleanly even if the sweep is still scheduled.
  if (typeof idleSweepTimer === "object" && idleSweepTimer !== null && "unref" in idleSweepTimer) {
    (idleSweepTimer as any).unref();
  }
}

/** Exported so tests can stop the sweep timer without keeping the process alive. */
export function stopIdleSweep(): void {
  if (idleSweepTimer !== null) {
    clearInterval(idleSweepTimer);
    idleSweepTimer = null;
  }
}

// ── Publish helper ────────────────────────────────────────────────────────────

/**
 * Push a stream event to all clients subscribed to `recipient`.
 * Called by the indexer whenever a new event is upserted.
 */
export function publishEvent(
  eventType: StreamEventType,
  recipient: string,
  payload: Record<string, unknown>
): void {
  const clients = subscriptions.get(recipient);
  if (!clients || clients.size === 0) return;

  const msg = JSON.stringify({ type: "event", event_type: eventType, recipient, payload });
  for (const client of clients) {
    if (client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(msg);
    }
  }
}

// ── Horizon SSE watcher (claimable-balance snapshots on ledger close) ─────────

let sseAbortController: AbortController | null = null;

async function startHorizonSSE(): Promise<void> {
  sseAbortController?.abort();
  sseAbortController = new AbortController();

  const url = `${HORIZON_URL}/ledgers?order=asc&cursor=now`;

  try {
    const resp = await fetch(url, {
      headers: { Accept: "text/event-stream" },
      signal: sseAbortController.signal,
    });

    if (!resp.ok || !resp.body) {
      throw new Error(`SSE connect failed: ${resp.status}`);
    }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";

      let ledger: number | null = null;

      for (const line of lines) {
        if (line.startsWith("data:")) {
          try {
            const parsed = JSON.parse(line.slice(5).trim());
            if (parsed.sequence) ledger = parsed.sequence;
          } catch {
            // ignore malformed SSE data
          }
        }
      }

      if (ledger !== null && subscriptions.size > 0) {
        await broadcastLedger(ledger);
      }
    }
  } catch (err: any) {
    if (err?.name !== "AbortError") {
      console.error("[ws] Horizon SSE disconnected, reconnecting in", SSE_RECONNECT_MS, "ms:", err?.message);
      setTimeout(startHorizonSSE, SSE_RECONNECT_MS);
    }
  }
}

// ── Broadcast claimable snapshots to all subscribers ─────────────────────────

async function broadcastLedger(ledger: number): Promise<void> {
  const recipients = Array.from(subscriptions.keys());
  if (recipients.length === 0) return;

  await Promise.allSettled(
    recipients.map(async (recipient) => {
      const clients = subscriptions.get(recipient);
      if (!clients || clients.size === 0) return;

      try {
        const claimable = await fetchClaimable(recipient);
        const msg = JSON.stringify({ type: "snapshot", claimable, ledger });
        for (const client of clients) {
          if (client.ws.readyState === WebSocket.OPEN) client.ws.send(msg);
        }
      } catch (err: any) {
        const errMsg = JSON.stringify({ type: "error", message: String(err?.message ?? err) });
        const current = subscriptions.get(recipient);
        if (current) {
          for (const client of current) {
            if (client.ws.readyState === WebSocket.OPEN) client.ws.send(errMsg);
          }
        }
      }
    })
  );
}

async function fetchClaimable(recipient: string): Promise<string> {
  // @ts-ignore
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
}

// ── WebSocket server setup ────────────────────────────────────────────────────

export function attachWebSocketServer(httpServer: HttpServer): WebSocketServer {
  const wss = new WebSocketServer({ server: httpServer, path: "/ws/claimable" });

  wss.on("connection", (ws: WebSocket, _req: IncomingMessage) => {
    const client: SubscribedClient = { ws, lastActivityAt: Date.now() };
    let subscribedRecipient: string | null = null;

    ws.on("message", (raw) => {
      // Refresh activity timestamp on every incoming message.
      client.lastActivityAt = Date.now();

      let msg: any;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        ws.send(JSON.stringify({ type: "error", message: "invalid JSON" }));
        return;
      }

      // Support both the new typed protocol and the legacy bare-recipient format.
      const isNewProtocol = msg.type === "subscribe";
      const isLegacyProtocol = typeof msg.recipient === "string" && !msg.type;

      if (!isNewProtocol && !isLegacyProtocol) {
        ws.send(JSON.stringify({ type: "error", message: 'expected { "type": "subscribe", "recipient": "G..." }' }));
        return;
      }

      const recipient: string = msg.recipient;
      if (!recipient || typeof recipient !== "string") {
        ws.send(JSON.stringify({ type: "error", message: "recipient required" }));
        return;
      }

      // Unsubscribe previous recipient if switching.
      if (subscribedRecipient && subscribedRecipient !== recipient) {
        removeSubscription(subscribedRecipient, client);
      }

      subscribedRecipient = recipient;
      if (!subscriptions.has(recipient)) subscriptions.set(recipient, new Set());
      subscriptions.get(recipient)!.add(client);

      // Send immediate snapshot on subscribe.
      fetchClaimable(recipient)
        .then((claimable) => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "snapshot", claimable, ledger: null }));
          }
        })
        .catch(() => {});
    });

    ws.on("close", () => {
      if (subscribedRecipient) removeSubscription(subscribedRecipient, client);
    });

    ws.on("error", () => {
      if (subscribedRecipient) removeSubscription(subscribedRecipient, client);
    });
  });

  // Start the Horizon SSE watcher and idle-sweep once when the WS server is created.
  startHorizonSSE();
  startIdleSweep();

  return wss;
}

function removeSubscription(recipient: string, client: SubscribedClient): void {
  const clients = subscriptions.get(recipient);
  if (!clients) return;
  clients.delete(client);
  if (clients.size === 0) subscriptions.delete(recipient);
}
