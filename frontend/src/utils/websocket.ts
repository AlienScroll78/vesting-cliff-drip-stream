/**
 * WebSocket manager with cross-browser compatible reconnection logic.
 *
 * Firefox handles WebSocket close/error events differently from Chrome/Safari.
 * This implementation uses a standard-compliant approach with exponential
 * backoff — no browser-specific detection or hacks.
 */

export interface WebSocketManagerOptions {
  /** WebSocket server URL */
  url: string;
  /** Called when a message is received */
  onMessage?: (event: MessageEvent) => void;
  /** Called after a connection is established (or re-established) */
  onOpen?: () => void;
  /** Called when the connection closes (before reconnect attempt) */
  onClose?: (event: CloseEvent) => void;
  /** Called on a connection error */
  onError?: (event: Event) => void;
  /** Initial reconnect delay in ms (default: 1000) */
  initialDelay?: number;
  /** Maximum reconnect delay in ms (default: 30000) */
  maxDelay?: number;
  /** Reconnect delay multiplier (default: 2) */
  backoffFactor?: number;
  /** Maximum number of reconnect attempts; 0 = unlimited (default: 0) */
  maxAttempts?: number;
}

export class WebSocketManager {
  private ws: WebSocket | null = null;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private destroyed = false;

  private readonly url: string;
  private readonly onMessage?: (e: MessageEvent) => void;
  private readonly onOpen?: () => void;
  private readonly onClose?: (e: CloseEvent) => void;
  private readonly onError?: (e: Event) => void;
  private readonly initialDelay: number;
  private readonly maxDelay: number;
  private readonly backoffFactor: number;
  private readonly maxAttempts: number;

  constructor(options: WebSocketManagerOptions) {
    this.url = options.url;
    this.onMessage = options.onMessage;
    this.onOpen = options.onOpen;
    this.onClose = options.onClose;
    this.onError = options.onError;
    this.initialDelay = options.initialDelay ?? 1000;
    this.maxDelay = options.maxDelay ?? 30_000;
    this.backoffFactor = options.backoffFactor ?? 2;
    this.maxAttempts = options.maxAttempts ?? 0;
  }

  /** Open the WebSocket connection. */
  connect(): void {
    if (this.destroyed) return;
    this.ws = new WebSocket(this.url);

    this.ws.onopen = () => {
      this.reconnectAttempts = 0;
      this.onOpen?.();
    };

    this.ws.onmessage = (event) => {
      this.onMessage?.(event);
    };

    // Standard close handler — works identically in Chromium, Firefox, WebKit.
    // Firefox may fire 'close' without a preceding 'error'; this handler covers
    // both normal and abnormal closure (code !== 1000) uniformly.
    this.ws.onclose = (event) => {
      this.onClose?.(event);
      if (!this.destroyed && event.code !== 1000) {
        this.scheduleReconnect();
      }
    };

    // Firefox can fire 'error' before 'close'; Chrome may only fire 'close'.
    // We don't reconnect here — we let onclose handle it to avoid double reconnects.
    this.ws.onerror = (event) => {
      this.onError?.(event);
    };
  }

  /** Send a message. No-op if not connected. */
  send(data: string | ArrayBufferLike | Blob | ArrayBufferView): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(data);
    }
  }

  /** Close the connection permanently and stop reconnection. */
  destroy(): void {
    this.destroyed = true;
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.onclose = null; // prevent reconnect loop on manual close
      this.ws.close(1000, 'Client destroyed');
      this.ws = null;
    }
  }

  get readyState(): number {
    return this.ws?.readyState ?? WebSocket.CLOSED;
  }

  private scheduleReconnect(): void {
    if (this.maxAttempts > 0 && this.reconnectAttempts >= this.maxAttempts) {
      return;
    }

    const delay = Math.min(
      this.initialDelay * Math.pow(this.backoffFactor, this.reconnectAttempts),
      this.maxDelay,
    );

    this.reconnectAttempts += 1;
    this.reconnectTimer = setTimeout(() => {
      if (!this.destroyed) this.connect();
    }, delay);
  }
}
