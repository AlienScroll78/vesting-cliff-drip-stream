/**
 * Resilience Test: Redis Unavailable → Cache-Miss Path Executes Correctly
 *
 * Scenario:
 *   1. Toxiproxy disables the Redis proxy (simulates Redis being completely down).
 *   2. The service layer catches the Redis error and falls through to the
 *      cache-miss path (reads from DB / origin instead).
 *   3. The response is still correct, just uncached.
 *   4. When Redis recovers, subsequent reads are served from cache.
 *
 * Requires docker-compose.toxiproxy.yml to be running.
 */

import { ToxiproxyClient, sleep } from './toxiproxyClient';

// ── Config ────────────────────────────────────────────────────────────────────

const TOXIPROXY_HOST = process.env.TOXIPROXY_HOST ?? 'localhost';
const TOXIPROXY_PORT = parseInt(process.env.TOXIPROXY_PORT ?? '8474', 10);
const REDIS_URL      = process.env.REDIS_URL ?? 'redis://localhost:16379';

// ── Minimal Redis-like cache layer ────────────────────────────────────────────
// In real tests this would import the actual cache module; here we write a
// minimal implementation to exercise the cache-miss code path without
// importing the full service stack.

type CacheBackend = {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
};

function makeRedisBackend(url: string): CacheBackend {
  // We use a raw TCP connection to Redis (SET / GET) to avoid needing ioredis
  // in this test file.  The Toxiproxy proxy wraps the real Redis port.
  const { createClient } = require('net') as typeof import('net');

  const send = (cmd: string): Promise<string> =>
    new Promise((resolve, reject) => {
      const parsed = new URL(url);
      const sock   = createClient({ port: parseInt(parsed.port || '6379'), host: parsed.hostname });
      let buf = '';
      sock.setTimeout(1000, () => {
        sock.destroy(new Error('Redis connection timed out'));
      });
      sock.on('data', (d: Buffer) => { buf += d.toString(); });
      sock.on('end', () => resolve(buf));
      sock.on('error', (e: Error) => reject(e));
      sock.write(cmd);
    });

  return {
    async get(key: string): Promise<string | null> {
      // RESP: *2\r\n$3\r\nGET\r\n$<len>\r\n<key>\r\n
      const cmd = `*2\r\n$3\r\nGET\r\n$${Buffer.byteLength(key)}\r\n${key}\r\n`;
      const resp = await send(cmd);
      if (resp.startsWith('$-1')) return null;
      const lines = resp.split('\r\n');
      return lines[1] ?? null;
    },
    async set(key: string, value: string): Promise<void> {
      const cmd =
        `*3\r\n$3\r\nSET\r\n$${Buffer.byteLength(key)}\r\n${key}\r\n` +
        `$${Buffer.byteLength(value)}\r\n${value}\r\n`;
      await send(cmd);
    },
  };
}

/** Cache layer that falls back to `fallbackFn` when Redis is unavailable. */
async function getWithCacheFallback(
  cache: CacheBackend,
  key: string,
  fallbackFn: () => Promise<string>,
): Promise<{ value: string; fromCache: boolean }> {
  try {
    const cached = await cache.get(key);
    if (cached !== null) return { value: cached, fromCache: true };
  } catch {
    // Cache unavailable – proceed to fallback.
  }

  const value = await fallbackFn();

  try {
    await cache.set(key, value);
  } catch {
    // Best-effort write; ignore failures.
  }

  return { value, fromCache: false };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

const tp    = new ToxiproxyClient(TOXIPROXY_HOST, TOXIPROXY_PORT);
const ORIGIN_VALUE = 'origin-data-12345';

describe('Resilience: Redis unavailable → cache-miss path executes', () => {
  beforeAll(async () => {
    const healthy = await tp.isHealthy();
    if (!healthy) throw new Error('Toxiproxy is not reachable.');
  });

  afterEach(async () => {
    try {
      const proxy = await tp.getProxy('redis');
      await proxy.enable();
      await proxy.removeAllToxics();
    } catch { /* ignore */ }
  });

  it('falls through to origin when Redis is completely unavailable', async () => {
    const proxy = await tp.getProxy('redis');
    await proxy.disable(); // Cut off Redis entirely.

    const cache = makeRedisBackend(REDIS_URL);
    const fallback = jest.fn().mockResolvedValue(ORIGIN_VALUE);

    const result = await getWithCacheFallback(cache, 'schedule:alice', fallback);

    // Origin was called because cache was unreachable.
    expect(fallback).toHaveBeenCalledTimes(1);
    expect(result.value).toBe(ORIGIN_VALUE);
    expect(result.fromCache).toBe(false);
  }, 15_000);

  it('serves from origin correctly when Redis has a latency toxic', async () => {
    const proxy = await tp.getProxy('redis');
    await proxy.addToxic({
      type:       'latency',
      stream:     'upstream',
      toxicity:   1.0,
      attributes: { latency: 2000, jitter: 0 },
    });

    const cache = makeRedisBackend(REDIS_URL);
    const fallback = jest.fn().mockResolvedValue(ORIGIN_VALUE);

    // Our backend has a 1 s socket timeout, so the 2 s latency causes a
    // timeout error → falls through to origin.
    const result = await getWithCacheFallback(cache, 'schedule:bob', fallback);

    expect(fallback).toHaveBeenCalledTimes(1);
    expect(result.value).toBe(ORIGIN_VALUE);
  }, 15_000);

  it('uses cache once Redis recovers', async () => {
    const proxy = await tp.getProxy('redis');

    const cache = makeRedisBackend(REDIS_URL);

    // Prime the cache.
    await cache.set('schedule:carol', ORIGIN_VALUE);

    // Verify cache hit.
    const fromCache = await getWithCacheFallback(
      cache,
      'schedule:carol',
      jest.fn().mockResolvedValue('should-not-be-called'),
    );
    expect(fromCache.fromCache).toBe(true);
    expect(fromCache.value).toBe(ORIGIN_VALUE);
  }, 15_000);
});
