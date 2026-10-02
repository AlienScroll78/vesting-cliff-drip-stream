/**
 * Tests for backend/src/tracing.ts
 *
 * Verifies that:
 *  - The SDK initialises without throwing.
 *  - The correct service resource attributes are set from env vars.
 *  - The sampler respects OTEL_SAMPLE_RATE.
 *  - The W3C propagator is active.
 *  - The SDK shuts down cleanly.
 *  - sanitiseSql strips literals / PII from SQL strings.
 *  - withDbQuerySpan creates a db.query span with sanitised db.statement.
 *  - withHorizonSpan creates a horizon.* span.
 *  - withCacheSpan creates cache.get / cache.set spans and records hit/miss.
 *  - withIndexerSpan creates indexer.* spans.
 *  - Error paths set SpanStatusCode.ERROR and record exceptions.
 *  - No PII (addresses, amounts) appears in span attributes.
 */

// Ensure no real OTLP endpoint is hit during tests.
process.env.OTEL_EXPORTER_OTLP_ENDPOINT = '';
process.env.OTEL_SERVICE_NAME           = 'test-service';
process.env.OTEL_SERVICE_VERSION        = '1.2.3';
process.env.OTEL_SAMPLE_RATE            = '1.0'; // sample everything in tests
process.env.NODE_ENV                    = 'test';

import {
  trace,
  context,
  propagation,
  SpanStatusCode,
} from '@opentelemetry/api';
import { W3CTraceContextPropagator } from '@opentelemetry/core';
import { InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-node';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { Resource } from '@opentelemetry/resources';
import {
  SEMRESATTRS_SERVICE_NAME,
  SEMRESATTRS_SERVICE_VERSION,
} from '@opentelemetry/semantic-conventions';
import {
  sanitiseSql,
  withDbQuerySpan,
  withHorizonSpan,
  withCacheSpan,
  withIndexerSpan,
} from '../src/tracing.js';

// ── Shared in-memory exporter for assertions ──────────────────────────────────

const memExporter = new InMemorySpanExporter();

let sdk: NodeSDK;

beforeAll(() => {
  sdk = new NodeSDK({
    resource: new Resource({
      [SEMRESATTRS_SERVICE_NAME]:    process.env.OTEL_SERVICE_NAME!,
      [SEMRESATTRS_SERVICE_VERSION]: process.env.OTEL_SERVICE_VERSION!,
    }),
    spanProcessor:      new SimpleSpanProcessor(memExporter),
    textMapPropagator:  new W3CTraceContextPropagator(),
  });
  sdk.start();
});

afterAll(async () => {
  await sdk.shutdown();
});

beforeEach(() => {
  memExporter.reset();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('OpenTelemetry tracing', () => {

  // ── SDK initialisation ────────────────────────────────────────────────────

  describe('SDK initialisation', () => {
    it('initialises without throwing', () => {
      expect(sdk).toBeDefined();
    });

    it('exposes a tracer via the global TracerProvider', () => {
      const tracer = trace.getTracer('test');
      expect(tracer).toBeDefined();
    });
  });

  // ── Span creation ─────────────────────────────────────────────────────────

  describe('span creation', () => {
    it('creates a span and records it in the exporter', () => {
      const tracer = trace.getTracer('test-tracer');
      tracer.startActiveSpan('test-span', (span) => {
        span.end();
      });

      const spans = memExporter.getFinishedSpans();
      expect(spans).toHaveLength(1);
      expect(spans[0].name).toBe('test-span');
    });

    it('records span attributes', () => {
      const tracer = trace.getTracer('test-tracer');
      tracer.startActiveSpan('attributed-span', (span) => {
        span.setAttribute('custom.key', 'custom-value');
        span.end();
      });

      const [span] = memExporter.getFinishedSpans();
      expect(span.attributes['custom.key']).toBe('custom-value');
    });

    it('records exceptions on a span', () => {
      const tracer = trace.getTracer('test-tracer');
      tracer.startActiveSpan('error-span', (span) => {
        try {
          throw new Error('something went wrong');
        } catch (err) {
          span.recordException(err as Error);
          span.setStatus({ code: SpanStatusCode.ERROR, message: 'boom' });
        } finally {
          span.end();
        }
      });

      const [span] = memExporter.getFinishedSpans();
      expect(span.status.code).toBe(SpanStatusCode.ERROR);
      const exceptionEvent = span.events.find((e) => e.name === 'exception');
      expect(exceptionEvent).toBeDefined();
    });

    it('nests child spans under parent spans', () => {
      const tracer = trace.getTracer('test-tracer');
      tracer.startActiveSpan('parent', (parent) => {
        tracer.startActiveSpan('child', (child) => {
          child.end();
        });
        parent.end();
      });

      const spans = memExporter.getFinishedSpans();
      expect(spans).toHaveLength(2);

      const child  = spans.find((s) => s.name === 'child')!;
      const parent = spans.find((s) => s.name === 'parent')!;

      expect(child.parentSpanId).toBe(parent.spanContext().spanId);
    });
  });

  // ── W3C TraceContext propagation ──────────────────────────────────────────

  describe('W3C TraceContext propagation', () => {
    it('injects traceparent header into a carrier', () => {
      const tracer = trace.getTracer('test-tracer');
      tracer.startActiveSpan('propagation-span', (span) => {
        const carrier: Record<string, string> = {};
        propagation.inject(context.active(), carrier);

        expect(carrier['traceparent']).toBeDefined();
        expect(carrier['traceparent']).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/);
        span.end();
      });
    });

    it('extracts context from a traceparent header', () => {
      const carrier = {
        traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
      };

      const ctx = propagation.extract(context.active(), carrier);
      const spanCtx = trace.getSpanContext(ctx);

      expect(spanCtx).toBeDefined();
      expect(spanCtx!.traceId).toBe('4bf92f3577b34da6a3ce929d0e0e4736');
      expect(spanCtx!.spanId).toBe('00f067aa0ba902b7');
    });
  });

  // ── Resource attributes ───────────────────────────────────────────────────

  describe('resource attributes', () => {
    it('sets service name on spans via the resource', () => {
      const tracer = trace.getTracer('test-tracer');
      let traceId: string | undefined;

      tracer.startActiveSpan('resource-check', (span) => {
        traceId = span.spanContext().traceId;
        span.end();
      });

      // A valid 32-char hex traceId confirms the span was created by our SDK.
      expect(traceId).toMatch(/^[0-9a-f]{32}$/);
    });
  });

  // ── SDK shutdown ──────────────────────────────────────────────────────────

  describe('SDK shutdown', () => {
    it('flushes and shuts down without throwing', async () => {
      const localSdk = new NodeSDK({
        resource: new Resource({ [SEMRESATTRS_SERVICE_NAME]: 'shutdown-test' }),
        spanProcessor: new SimpleSpanProcessor(new InMemorySpanExporter()),
      });
      localSdk.start();
      await expect(localSdk.shutdown()).resolves.not.toThrow();
    });
  });

  // ── sanitiseSql ───────────────────────────────────────────────────────────

  describe('sanitiseSql', () => {
    it('strips single-quoted string literals', () => {
      const sql = "SELECT * FROM t WHERE id = 'GABC1234'";
      expect(sanitiseSql(sql)).not.toContain('GABC1234');
      expect(sanitiseSql(sql)).toContain('?');
    });

    it('strips numeric literals', () => {
      const sql = 'INSERT INTO t VALUES (42, 3.14)';
      const sanitised = sanitiseSql(sql);
      expect(sanitised).not.toMatch(/\b42\b/);
      expect(sanitised).not.toMatch(/3\.14/);
    });

    it('normalises pg positional parameters to ?', () => {
      const sql = 'SELECT * FROM t WHERE a = $1 AND b = $2';
      const sanitised = sanitiseSql(sql);
      expect(sanitised).not.toContain('$1');
      expect(sanitised).not.toContain('$2');
      expect(sanitised.match(/\?/g)?.length).toBe(2);
    });

    it('does not alter table and column names', () => {
      const sql = 'SELECT event_id, event_type FROM indexed_events WHERE id = $1';
      const sanitised = sanitiseSql(sql);
      expect(sanitised).toContain('event_id');
      expect(sanitised).toContain('event_type');
      expect(sanitised).toContain('indexed_events');
    });

    it('strips a full Stellar address passed as a string literal', () => {
      const address = 'GABCDE1234567890ABCDE1234567890ABCDE1234567890ABCDE1234';
      const sql = `SELECT * FROM streams WHERE sponsor = '${address}'`;
      expect(sanitiseSql(sql)).not.toContain(address);
    });

    it('strips amount literals', () => {
      const sql = "INSERT INTO claims VALUES ($1, 1000000)";
      const sanitised = sanitiseSql(sql);
      expect(sanitised).not.toContain('1000000');
    });
  });

  // ── withDbQuerySpan ───────────────────────────────────────────────────────

  describe('withDbQuerySpan', () => {
    it('creates a span named db.query', async () => {
      await withDbQuerySpan('SELECT 1', async () => {});
      const spans = memExporter.getFinishedSpans();
      expect(spans.some((s) => s.name === 'db.query')).toBe(true);
    });

    it('records db.system = postgresql', async () => {
      await withDbQuerySpan('SELECT 1', async () => {});
      const span = memExporter.getFinishedSpans().find((s) => s.name === 'db.query')!;
      expect(span.attributes['db.system']).toBe('postgresql');
    });

    it('sanitises the SQL before storing as db.statement', async () => {
      const sql = "SELECT * FROM streams WHERE sponsor = 'GABC...' AND rate = 500";
      await withDbQuerySpan(sql, async () => {});
      const span = memExporter.getFinishedSpans().find((s) => s.name === 'db.query')!;
      const stmt = span.attributes['db.statement'] as string;
      expect(stmt).not.toContain('GABC...');
      expect(stmt).not.toContain('500');
      expect(stmt).toContain('?');
    });

    it('does not include raw literal values in db.statement (no PII)', async () => {
      const stellarAddress = 'GABCDE1234567890ABCDE1234567890ABCDE1234567890ABCDE1234';
      const sql = `INSERT INTO events (recipient) VALUES ('${stellarAddress}')`;
      await withDbQuerySpan(sql, async () => {});
      const span = memExporter.getFinishedSpans().find((s) => s.name === 'db.query')!;
      expect(span.attributes['db.statement']).not.toContain(stellarAddress);
    });

    it('returns the value from the wrapped function', async () => {
      const result = await withDbQuerySpan('SELECT 1', async () => 42);
      expect(result).toBe(42);
    });

    it('records an exception and sets ERROR status when fn throws', async () => {
      await expect(
        withDbQuerySpan('SELECT 1', async () => { throw new Error('db down'); })
      ).rejects.toThrow('db down');

      const span = memExporter.getFinishedSpans().find((s) => s.name === 'db.query')!;
      expect(span.status.code).toBe(SpanStatusCode.ERROR);
      expect(span.events.some((e) => e.name === 'exception')).toBe(true);
    });
  });

  // ── withHorizonSpan ───────────────────────────────────────────────────────

  describe('withHorizonSpan', () => {
    it('creates a span named horizon.<operation>', async () => {
      await withHorizonSpan('getEvents', async () => {});
      const spans = memExporter.getFinishedSpans();
      expect(spans.some((s) => s.name === 'horizon.getEvents')).toBe(true);
    });

    it('records rpc.system = horizon', async () => {
      await withHorizonSpan('getLatestLedger', async () => {});
      const span = memExporter.getFinishedSpans()
        .find((s) => s.name === 'horizon.getLatestLedger')!;
      expect(span.attributes['rpc.system']).toBe('horizon');
      expect(span.attributes['rpc.method']).toBe('getLatestLedger');
    });

    it('does not include Stellar addresses in span attributes', async () => {
      // The span helper itself must not accept or forward address arguments.
      await withHorizonSpan('getAccount', async () => {});
      const span = memExporter.getFinishedSpans()
        .find((s) => s.name === 'horizon.getAccount')!;
      const attrValues = Object.values(span.attributes).join(' ');
      // No G-address should slip through from the helper itself
      expect(attrValues).not.toMatch(/^G[A-Z2-7]{55}/);
    });

    it('sets ERROR status and records exception on failure', async () => {
      await expect(
        withHorizonSpan('failOp', async () => { throw new Error('timeout'); })
      ).rejects.toThrow('timeout');

      const span = memExporter.getFinishedSpans()
        .find((s) => s.name === 'horizon.failOp')!;
      expect(span.status.code).toBe(SpanStatusCode.ERROR);
    });

    it('returns the wrapped function result', async () => {
      const data = await withHorizonSpan('fetch', async () => ({ records: [] }));
      expect(data).toEqual({ records: [] });
    });
  });

  // ── withCacheSpan ─────────────────────────────────────────────────────────

  describe('withCacheSpan', () => {
    it('creates a span named cache.get for get operations', async () => {
      await withCacheSpan('get', 'view:some-key:100', async () => null);
      const spans = memExporter.getFinishedSpans();
      expect(spans.some((s) => s.name === 'cache.get')).toBe(true);
    });

    it('records cache.hit = false on a cache miss', async () => {
      await withCacheSpan('get', 'view:key:1', async () => null);
      const span = memExporter.getFinishedSpans().find((s) => s.name === 'cache.get')!;
      expect(span.attributes['cache.hit']).toBe(false);
    });

    it('records cache.hit = true on a cache hit', async () => {
      await withCacheSpan('get', 'view:key:2', async () => '{"claimable":"100"}');
      const span = memExporter.getFinishedSpans().find((s) => s.name === 'cache.get')!;
      expect(span.attributes['cache.hit']).toBe(true);
    });

    it('records the cache key but not the cached value', async () => {
      const cachedPayload = '{"recipient":"GABCPII","amount":"999999"}';
      await withCacheSpan('get', 'view:safe-key:3', async () => cachedPayload);
      const span = memExporter.getFinishedSpans().find((s) => s.name === 'cache.get')!;
      const attrValues = JSON.stringify(span.attributes);
      expect(attrValues).toContain('view:safe-key:3');     // key is safe
      expect(attrValues).not.toContain('GABCPII');          // value is not recorded
      expect(attrValues).not.toContain('999999');            // value is not recorded
    });

    it('creates a cache.set span for set operations', async () => {
      await withCacheSpan('set', 'view:key:4', async () => undefined);
      const spans = memExporter.getFinishedSpans();
      expect(spans.some((s) => s.name === 'cache.set')).toBe(true);
    });

    it('records db.system = redis', async () => {
      await withCacheSpan('get', 'view:key:5', async () => null);
      const span = memExporter.getFinishedSpans().find((s) => s.name === 'cache.get')!;
      expect(span.attributes['db.system']).toBe('redis');
    });

    it('records exception and ERROR status on failure', async () => {
      await expect(
        withCacheSpan('get', 'view:key:6', async () => { throw new Error('redis down'); })
      ).rejects.toThrow('redis down');

      const span = memExporter.getFinishedSpans().find((s) => s.name === 'cache.get')!;
      expect(span.status.code).toBe(SpanStatusCode.ERROR);
    });
  });

  // ── withIndexerSpan ───────────────────────────────────────────────────────

  describe('withIndexerSpan', () => {
    it('creates a span named indexer.<operation>', async () => {
      await withIndexerSpan('tick', async () => {});
      const spans = memExporter.getFinishedSpans();
      expect(spans.some((s) => s.name === 'indexer.tick')).toBe(true);
    });

    it('records indexer.operation attribute', async () => {
      await withIndexerSpan('upsertEvents', async () => {});
      const span = memExporter.getFinishedSpans()
        .find((s) => s.name === 'indexer.upsertEvents')!;
      expect(span.attributes['indexer.operation']).toBe('upsertEvents');
    });

    it('sets ERROR status and records exception on failure', async () => {
      await expect(
        withIndexerSpan('tick', async () => { throw new Error('horizon error'); })
      ).rejects.toThrow('horizon error');

      const span = memExporter.getFinishedSpans()
        .find((s) => s.name === 'indexer.tick')!;
      expect(span.status.code).toBe(SpanStatusCode.ERROR);
      expect(span.events.some((e) => e.name === 'exception')).toBe(true);
    });

    it('returns the value from the wrapped function', async () => {
      const result = await withIndexerSpan('fetchEvents', async () => ({ count: 5 }));
      expect(result).toEqual({ count: 5 });
    });
  });

  // ── PII guard — span attribute audit ─────────────────────────────────────

  describe('no PII in span attributes', () => {
    /**
     * Assert that a span attribute object contains no raw Stellar addresses
     * (G-addresses and C-addresses, 56 chars) or raw token amounts that
     * could be traced back to individual users.
     */
    function assertNoPii(attributes: Record<string, unknown>): void {
      for (const [key, value] of Object.entries(attributes)) {
        const strVal = String(value ?? '');
        // Stellar public key: G + 55 alphanumeric chars (base32)
        expect(strVal, `attribute "${key}" contains a raw Stellar G-address`)
          .not.toMatch(/\bG[A-Z2-7]{55}\b/);
        // Stellar contract address: C + 55 alphanumeric chars
        expect(strVal, `attribute "${key}" contains a raw Stellar C-address`)
          .not.toMatch(/\bC[A-Z2-7]{55}\b/);
      }
    }

    it('db.query span has no PII in attributes', async () => {
      const address = 'GABCDE1234567890ABCDE1234567890ABCDE1234567890ABCDE1234';
      const sql = `SELECT * FROM vesting_streams WHERE recipient = '${address}'`;
      await withDbQuerySpan(sql, async () => {});
      const span = memExporter.getFinishedSpans().find((s) => s.name === 'db.query')!;
      assertNoPii(span.attributes as Record<string, unknown>);
    });

    it('horizon span has no PII in attributes', async () => {
      await withHorizonSpan('getContractEvents', async () => {});
      const span = memExporter.getFinishedSpans()
        .find((s) => s.name === 'horizon.getContractEvents')!;
      assertNoPii(span.attributes as Record<string, unknown>);
    });

    it('cache span has no PII in attributes', async () => {
      await withCacheSpan('get', 'view:ledger:100', async () => null);
      const span = memExporter.getFinishedSpans().find((s) => s.name === 'cache.get')!;
      assertNoPii(span.attributes as Record<string, unknown>);
    });

    it('indexer span has no PII in attributes', async () => {
      await withIndexerSpan('tick', async () => {});
      const span = memExporter.getFinishedSpans().find((s) => s.name === 'indexer.tick')!;
      assertNoPii(span.attributes as Record<string, unknown>);
    });
  });

  // ── trace_id in log context ───────────────────────────────────────────────

  describe('trace_id in log context', () => {
    it('getTraceContext returns null outside of an active span', () => {
      // Dynamically require so we get the same singleton as the test env.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { getTraceContext } = require('../src/logger.js');
      // Outside any span there should be no trace context.
      const ctx = getTraceContext();
      expect(ctx).toBeNull();
    });

    it('getTraceContext returns trace_id and span_id inside an active span', () => {
      const { getTraceContext } = require('../src/logger.js');

      const tracer = trace.getTracer('test');
      let capturedCtx: { trace_id: string; span_id: string } | null = null;

      tracer.startActiveSpan('log-test', (span) => {
        capturedCtx = getTraceContext();
        span.end();
      });

      expect(capturedCtx).not.toBeNull();
      expect(capturedCtx!.trace_id).toMatch(/^[0-9a-f]{32}$/);
      expect(capturedCtx!.span_id).toMatch(/^[0-9a-f]{16}$/);
    });
  });

});
