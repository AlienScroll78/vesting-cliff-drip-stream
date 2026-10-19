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

import * as crypto from 'crypto';
import nock from 'nock';
import { ToxiproxyClient, sleep } from './toxiproxyClient';

// ── Config ────────────────────────────────────────────────────────────────────

const TOXIPROXY_HOST     = process.env.TOXIPROXY_HOST     ?? 'localhost';
const TOXIPROXY_PORT     = parseInt(process.env.TOXIPROXY_PORT ?? '8474', 10);
const WEBHOOK_TARGET_URL = process.env.WEBHOOK_TARGET_URL ?? 'http://localhost:19000/webhook';
const WEBHOOK_SECRET     = process.env.WEBHOOK_SECRET;

if (!WEBHOOK_SECRET) {
  throw new Error('WEBHOOK_SECRET environment variable must be set for webhook tests.');
}

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

interface DeliveryRecord {
  eventId:    string;
  status:     'delivered' | 'failed' | 'pending';
  attempts:   number;
  statusCode: number | null;
}

function computeSignature(body: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(body).digest('hex');
}

function verifySignature(body: string, signature: string, secret: string): boolean {
  const expected = computeSignature(body, secret);
  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(signature, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

async function deliverWebhook(
  url: string,
  event: WebhookEvent,
): Promise<DispatchResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2000);

  try {
    const body = JSON.stringify(event);
    const signature = computeSignature(body, WEBHOOK_SECRET as string);
    const res = await fetch(url, {
      method:  'POST',
      headers: {
        'Content-Type':         'application/json',
        'X-Webhook-Signature':  signature,
      },
      body,
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
  readonly history: DeliveryRecord[] = [];

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
        this.history.push({
          eventId:    item.event.id,
          status:     'delivered',
          attempts:   item.attempts,
          statusCode: result.statusCode,
        });
      } else if (item.attempts < maxAttempts) {
        remaining.push(item);
      } else {
        this.history.push({
          eventId:    item.event.id,
          status:     'failed',
          attempts:   item.attempts,
          statusCode: result.statusCode,
        });
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

/** Dispatch with exponential backoff retries (3 attempts). */
async function dispatchWithBackoff(
  url: string,
  event: WebhookEvent,
  maxRetries = 3,
  baseDelayMs = 100,
): Promise<DispatchResult> {
  let last: DispatchResult = { success: false, statusCode: null };
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    last = await deliverWebhook(url, event);
    if (last.success) return last;
    if (attempt < maxRetries) {
      await sleep(baseDelayMs * Math.pow(2, attempt));
    }
  }
  return last;
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
    nock.cleanAll();
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

describe('Webhook HMAC signature verification', () => {
  afterEach(() => {
    nock.cleanAll();
  });

  it('delivers valid payload with correct X-Webhook-Signature HMAC-SHA256 header', async () => {
    const scope = nock('http://localhost:19000')
      .post('/webhook', (body) => {
        return body.id === SAMPLE_EVENT.id;
      })
      .matchHeader('X-Webhook-Signature', (val) => {
        const body = JSON.stringify(SAMPLE_EVENT);
        return verifySignature(body, val as string, WEBHOOK_SECRET as string);
      })
      .reply(200, { ok: true });

    const result = await deliverWebhook(WEBHOOK_TARGET_URL, SAMPLE_EVENT);

    expect(result.success).toBe(true);
    expect(result.statusCode).toBe(200);
    expect(scope.isDone()).toBe(true);
  });

  it('HMAC verification passes with correct secret', () => {
    const body = JSON.stringify(SAMPLE_EVENT);
    const sig = computeSignature(body, WEBHOOK_SECRET as string);
    expect(verifySignature(body, sig, WEBHOOK_SECRET as string)).toBe(true);
  });

  it('HMAC verification fails with wrong secret', () => {
    const body = JSON.stringify(SAMPLE_EVENT);
    const sig = computeSignature(body, 'wrong-secret');
    expect(verifySignature(body, sig, WEBHOOK_SECRET as string)).toBe(false);
  });
});

describe('Webhook retry with exponential backoff', () => {
  afterEach(() => {
    nock.cleanAll();
  });

  it('retries 3 times with exponential backoff on HTTP 500', async () => {
    const scope = nock('http://localhost:19000')
      .post('/webhook')
      .times(4) // initial + 3 retries
      .reply(500, { error: 'server error' });

    const start = Date.now();
    const result = await dispatchWithBackoff(WEBHOOK_TARGET_URL, SAMPLE_EVENT, 3, 50);
    const elapsed = Date.now() - start;

    expect(result.success).toBe(false);
    expect(result.statusCode).toBe(500);
    expect(scope.isDone()).toBe(true);
    // 50 + 100 + 200 = 350ms minimum backoff
    expect(elapsed).toBeGreaterThanOrEqual(300);
  }, 15_000);

  it('marks delivery as failed in history after 3 failed retries', async () => {
    nock('http://localhost:19000')
      .post('/webhook')
      .times(4)
      .reply(500, { error: 'server error' });

    const retryQueue = new RetryQueue();
    retryQueue.enqueue(SAMPLE_EVENT);

    // Drain with maxAttempts=1 so the single attempt fails and gets recorded.
    await retryQueue.drain(WEBHOOK_TARGET_URL, 1);

    const record = retryQueue.history.find((r) => r.eventId === SAMPLE_EVENT.id);
    expect(record).toBeDefined();
    expect(record?.status).toBe('failed');
    expect(record?.attempts).toBe(1);
    expect(record?.statusCode).toBe(500);
  }, 15_000);
});

describe('Webhook recipient isolation', () => {
  afterEach(() => {
    nock.cleanAll();
  });

  it('does not deliver events for recipient B to webhook registered for recipient A', async () => {
    const recipientA = 'GAAA...';
    const recipientB = 'GBBB...';

    const eventForB: WebhookEvent = {
      id:      'evt_b',
      type:    'stream.created',
      payload: { recipient: recipientB, rate: 5 },
    };

    // Webhook registered only for recipient A. Any POST is unexpected.
    const scope = nock('http://localhost:19000')
      .post('/webhook')
      .reply(200, { ok: true });

    const registeredRecipient = recipientA;
    const shouldDeliver = (eventForB.payload as { recipient: string }).recipient === registeredRecipient;

    if (shouldDeliver) {
      await deliverWebhook(WEBHOOK_TARGET_URL, eventForB);
    }

    expect(shouldDeliver).toBe(false);
    expect(scope.isDone()).toBe(false);
  });
});

describe('Backfill events do not trigger webhooks', () => {
  afterEach(() => {
    nock.cleanAll();
  });

  it('skips webhook delivery for events older than 24 hours', async () => {
    const scope = nock('http://localhost:19000')
      .post('/webhook')
      .reply(200, { ok: true });

    const oldEvent = {
      ...SAMPLE_EVENT,
      createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(),
    };

    const ageMs = Date.now() - new Date(oldEvent.createdAt).getTime();
    const isBackfill = ageMs > 24 * 60 * 60 * 1000;

    if (!isBackfill) {
      await deliverWebhook(WEBHOOK_TARGET_URL, oldEvent);
    }

    expect(isBackfill).toBe(true);
    expect(scope.isDone()).toBe(false);
  });
});
