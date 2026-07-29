/**
 * Issue #28 — WebSocket endpoint for real-time claimable balance updates.
 *
 * Protocol:
 *   Client → server: { "recipient": "G..." }
 *   Server → client: { "claimable": "500", "ledger": 12345 }
 *   Server → client: { "error": "..." }          (on failure)
 *
 * Uses Horizon SSE (/ledgers?order=asc&cursor=now) to detect new ledgers,
 * then calls claimable_amount via Soroban RPC for each subscribed recipient.
 * Reconnects automatically when the Horizon SSE stream drops.
 */

import { IncomingMessage, Server as HttpServer } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { networkConfig } from "./config/network.js";

const HORIZON_URL = process.env.HORIZON_URL ?? "https://horizon-testnet.stellar.org";
const SSE_RECONNECT_MS = parseInt(process.env.SSE_RECONNECT_MS ?? "5000", 10);

// Subscriptions: recipient → Set of WebSocket clients
const subscriptions = new Map<string, Set<WebSocket>>();

// ── Horizon SSE watcher ───────────────────────────────────────────────────────

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

// ── Broadcast claimable amounts to all subscribers ────────────────────────────

async function broadcastLedger(ledger: number): Promise<void> {
  const recipients = Array.from(subscriptions.keys());
  if (recipients.length === 0) return;

  await Promise.allSettled(
    recipients.map(async (recipient) => {
      const clients = subscriptions.get(recipient);
      if (!clients || clients.size === 0) return;

      try {
        const claimable = await fetchClaimable(recipient);
        const msg = JSON.stringify({ claimable, ledger });
        for (const ws of clients) {
          if (ws.readyState === WebSocket.OPEN) ws.send(msg);
        }
      } catch (err: any) {
        const errMsg = JSON.stringify({ error: String(err?.message ?? err) });
        const clients2 = subscriptions.get(recipient);
        if (clients2) {
          for (const ws of clients2) {
            if (ws.readyState === WebSocket.OPEN) ws.send(errMsg);
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
    let subscribedRecipient: string | null = null;

    ws.on("message", (raw) => {
      let msg: any;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        ws.send(JSON.stringify({ error: "invalid JSON" }));
        return;
      }

      const { recipient } = msg;
      if (!recipient || typeof recipient !== "string") {
        ws.send(JSON.stringify({ error: "recipient required" }));
        return;
      }

      // Unsubscribe previous recipient if switching.
      if (subscribedRecipient && subscribedRecipient !== recipient) {
        removeSubscription(subscribedRecipient, ws);
      }

      subscribedRecipient = recipient;
      if (!subscriptions.has(recipient)) subscriptions.set(recipient, new Set());
      subscriptions.get(recipient)!.add(ws);

      // Send immediate snapshot on subscribe.
      fetchClaimable(recipient)
        .then((claimable) => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ claimable, ledger: null }));
          }
        })
        .catch(() => {});
    });

    ws.on("close", () => {
      if (subscribedRecipient) removeSubscription(subscribedRecipient, ws);
    });

    ws.on("error", () => {
      if (subscribedRecipient) removeSubscription(subscribedRecipient, ws);
    });
  });

  // Start the Horizon SSE watcher once when the WS server is created.
  startHorizonSSE();

  return wss;
}

function removeSubscription(recipient: string, ws: WebSocket): void {
  const clients = subscriptions.get(recipient);
  if (!clients) return;
  clients.delete(ws);
  if (clients.size === 0) subscriptions.delete(recipient);
}
