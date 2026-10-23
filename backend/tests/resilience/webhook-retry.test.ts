/**
 * Resilience Test: Webhook Delivery Failure → Retry Queue Populated
 *
 * Scenario:
 *   1. The webhook target is unavailable (Toxiproxy injects a connection reset).
 *   2. The webhook dispatcher attempts delivery and fails.
 *   3. The failed event is pushed onto the retry queue.
 *   4. When the target recovers, the retry queue is drained and delivery succeeds.
 *
 * Requires docker-compose.toxiproxy.yml to be running.
 */

import { ToxiproxyClient, sleep } from './toxiproxyClient';

// ── Config ────────────────────────────────────────────────────────────────────

const TOXIPROXY_HOST     = process.env.TOXIPROXY_HOST     ?? 'localhost';
const TOXIPROXY_PORT     = parseInt(process.env.TOXIPROXY_PORT ?? '8474', 10);
const WEBHOOK_TARGET_URL = process.env.WEBHOOK_TARGET_URL ?? 'http://localhost:19000/webhook';

// ── Minimal webhook dispatcher ────────────────────────────────────────────────

interface WebhookEvent {
  id:      string;
  type:    string;
  payload: unknown;
}

interface DispatchResult {
  success:    boolean;
  statusCode: number | null;
  error?:     string;
}

async function deliverWebhook(
  url: string,
  event: WebhookEvent,
): Promise<DispatchResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2000);

  try {
    const res = await fetch(url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(event),
      signal:  controller.signal,
    });
    clearTimeout(timer);
    return { success: res.status < 300, statusCode: res.status };
  } catch (err) {
    clearTimeout(timer);
    return {
      success:    false,
      statusCode: null,
      error:      err instanceof Error ? err.message : String(err),
    };
  }
}

/** In-memory retry queue. In production this would be a persistent queue (Redis, SQS). */
class RetryQueue {
  private queue: Array<{ event: WebhookEvent; attempts: number }> = [];

  enqueue(event: WebhookEvent): void {
    this.queue.push({ event, attempts: 0 });
  }

  size(): number { return this.queue.length; }

  /** Drain the queue, delivering each event.  Returns the number of successes. */
  async drain(url: string, maxAttempts = 5): Promise<number> {
    let successes = 0;
    const remaining: typeof this.queue = [];

    for (const item of this.queue) {
      item.attempts++;
      const result = await deliverWebhook(url, item.event);

      if (result.success) {
        successes++;
      } else if (item.attempts < maxAttempts) {
        remaining.push(item);
      }
      // Drop items that have exceeded maxAttempts.
    }

    this.queue = remaining;
    return successes;
  }
}

/** Dispatch with automatic retry-queue enqueue on failure. */
async function dispatchWithRetry(
  url: string,
  event: WebhookEvent,
  retryQueue: RetryQueue,
): Promise<DispatchResult> {
  const result = await deliverWebhook(url, event);
  if (!result.success) {
    retryQueue.enqueue(event);
  }
  return result;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

const tp = new ToxiproxyClient(TOXIPROXY_HOST, TOXIPROXY_PORT);

const SAMPLE_EVENT: WebhookEvent = {
  id:      'evt_001',
  type:    'stream.created',
  payload: { recipient: 'GABC...', rate: 10 },
};

describe('Resilience: webhook delivery failure → retry queue populated', () => {
  beforeAll(async () => {
    const healthy = await tp.isHealthy();
    if (!healthy) throw new Error('Toxiproxy is not reachable.');
  });

  afterEach(async () => {
    try {
      const proxy = await tp.getProxy('webhook');
      await proxy.enable();
      await proxy.removeAllToxics();
    } catch { /* ignore */ }
  });

  it('enqueues the event when the webhook target is unreachable', async () => {
    const proxy = await tp.getProxy('webhook');
    await proxy.disable(); // Webhook target is down.

    const retryQueue = new RetryQueue();
    const result = await dispatchWithRetry(WEBHOOK_TARGET_URL, SAMPLE_EVENT, retryQueue);

    expect(result.success).toBe(false);
    expect(retryQueue.size()).toBe(1);
  }, 15_000);

  it('enqueues when a latency toxic causes a timeout', async () => {
    const proxy = await tp.getProxy('webhook');
    await proxy.addToxic({
      type:       'latency',
      stream:     'upstream',
      toxicity:   1.0,
      attributes: { latency: 5000, jitter: 0 }, // 5 s > 2 s client timeout
    });

    const retryQueue = new RetryQueue();
    const result = await dispatchWithRetry(WEBHOOK_TARGET_URL, SAMPLE_EVENT, retryQueue);

    expect(result.success).toBe(false);
    expect(retryQueue.size()).toBe(1);
  }, 15_000);

  it('drains the retry queue successfully once the target recovers', async () => {
    const proxy = await tp.getProxy('webhook');

    // Fail initial delivery.
    await proxy.disable();
    const retryQueue = new RetryQueue();
    await dispatchWithRetry(WEBHOOK_TARGET_URL, SAMPLE_EVENT, retryQueue);
    expect(retryQueue.size()).toBe(1);

    // Recover target.
    await proxy.enable();
    await sleep(300); // allow WireMock to come back up through the proxy

    const successes = await retryQueue.drain(WEBHOOK_TARGET_URL);
    expect(successes).toBe(1);
    expect(retryQueue.size()).toBe(0);
  }, 20_000);

  it('drops an event after exceeding maxAttempts', async () => {
    const proxy = await tp.getProxy('webhook');
    await proxy.disable();

    const retryQueue = new RetryQueue();
    retryQueue.enqueue(SAMPLE_EVENT);

    // Drain 5 times while the target remains down.
    for (let i = 0; i < 5; i++) {
      await retryQueue.drain(WEBHOOK_TARGET_URL, 5);
    }

    // After 5 failed attempts the event should be dropped.
    expect(retryQueue.size()).toBe(0);
  }, 30_000);
});
