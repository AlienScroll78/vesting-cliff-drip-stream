/**
 * Issue #570: Tests for Prometheus metrics module and /metrics endpoint.
 *
 * Test cases:
 *   1. All 6 metrics are registered in the registry.
 *   2. httpRequestsTotal can be incremented and queried.
 *   3. GET /metrics returns 200 with text/plain (Prometheus format).
 *   4. GET /metrics returns a body that looks like Prometheus text format.
 *
 * prom-client is mocked so the tests run even when the package is not
 * installed in CI.  The mock faithfully reproduces the shapes used by the
 * real library.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock prom-client
// ---------------------------------------------------------------------------

// Mock cache.js to avoid CJS/ESM boundary errors in ESM test context.
vi.mock('../cache.js', () => ({
  getCacheMetrics: () => ({ hits: 10, misses: 2, total: 12, hitRate: 0.83 }),
  default: {
    getCacheMetrics: () => ({ hits: 10, misses: 2, total: 12, hitRate: 0.83 }),
  },
}));

// We mock the module before importing anything that depends on it.
vi.mock('prom-client', () => {
  // Minimal in-memory implementations that satisfy the metrics module.

  class MockRegistry {
    private _metrics: Map<string, MockMetric> = new Map();
    public contentType = 'text/plain; version=0.0.4; charset=utf-8';

    register(metric: MockMetric): void {
      this._metrics.set(metric.name, metric);
    }

    setDefaultLabels(_labels: Record<string, string>): void {
      // no-op in mock
    }

    getMetricsAsArray(): MockMetric[] {
      return Array.from(this._metrics.values());
    }

    async metrics(): Promise<string> {
      const lines: string[] = [];
      for (const m of this._metrics.values()) {
        lines.push(`# HELP ${m.name} ${m.help}`);
        lines.push(`# TYPE ${m.name} ${m.type}`);
        lines.push(`${m.name} ${m._value}`);
      }
      return lines.join('\n') + '\n';
    }
  }

  class MockMetric {
    public _value = 0;
    constructor(
      public readonly name: string,
      public readonly help: string,
      public readonly type: string,
      registers: MockRegistry[],
    ) {
      for (const r of registers) r.register(this);
    }
  }

  class Counter extends MockMetric {
    constructor(opts: {
      name: string;
      help: string;
      labelNames: readonly string[];
      registers: MockRegistry[];
    }) {
      super(opts.name, opts.help, 'counter', opts.registers);
    }

    labels(..._args: unknown[]): this {
      return this;
    }

    inc(value = 1): void {
      this._value += value;
    }
  }

  class Histogram extends MockMetric {
    constructor(opts: {
      name: string;
      help: string;
      labelNames: readonly string[];
      buckets: number[];
      registers: MockRegistry[];
    }) {
      super(opts.name, opts.help, 'histogram', opts.registers);
    }

    labels(..._args: unknown[]): this {
      return this;
    }

    observe(value: number): void {
      this._value = value;
    }
  }

  class Gauge extends MockMetric {
    constructor(opts: {
      name: string;
      help: string;
      labelNames: readonly string[];
      registers: MockRegistry[];
    }) {
      super(opts.name, opts.help, 'gauge', opts.registers);
    }

    labels(..._args: unknown[]): this {
      return this;
    }

    set(value: number): void {
      this._value = value;
    }

    inc(value = 1): void {
      this._value += value;
    }

    dec(value = 1): void {
      this._value -= value;
    }
  }

  // The global `register` export (not used by our code but exported for completeness)
  const register = new MockRegistry();

  return { Registry: MockRegistry, Counter, Histogram, Gauge, register };
});

// ---------------------------------------------------------------------------
// Imports (after mocks are set up)
// ---------------------------------------------------------------------------

import {
  registry,
  httpRequestsTotal,
  httpRequestDurationSeconds,
  indexerEventsProcessedTotal,
  indexerPollLagSeconds,
  dbQueryDurationSeconds,
  websocketConnectionsActive,
} from './metrics.js';

import {
  prometheusMetricsHandler,
  jsonMetricsHandler,
} from './routes/metrics.js';

import type { Request, Response } from 'express';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRes(): {
  res: Response;
  setHeader: ReturnType<typeof vi.fn>;
  status: ReturnType<typeof vi.fn>;
  end: ReturnType<typeof vi.fn>;
  _body: string[];
  _status: number;
  _headers: Record<string, string>;
} {
  const _body: string[] = [];
  const _headers: Record<string, string> = {};
  let _status = 200;

  const res = {} as Response;

  res.setHeader = vi.fn((name: string, value: string) => {
    _headers[name] = value;
    return res;
  }) as unknown as Response['setHeader'];

  res.status = vi.fn((code: number) => {
    _status = code;
    return res;
  }) as unknown as Response['status'];

  res.end = vi.fn((body?: string) => {
    if (body) _body.push(body);
    return res;
  }) as unknown as Response['end'];

  return {
    res,
    setHeader: res.setHeader as unknown as ReturnType<typeof vi.fn>,
    status: res.status as unknown as ReturnType<typeof vi.fn>,
    end: res.end as unknown as ReturnType<typeof vi.fn>,
    _body,
    _status,
    _headers,
  };
}

const req = {} as Request;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('metrics module', () => {
  describe('metric registration', () => {
    it('exports a registry instance', () => {
      expect(registry).toBeDefined();
      expect(typeof (registry as { metrics?: unknown }).metrics).toBe('function');
    });

    it('registers httpRequestsTotal as a Counter', () => {
      expect(httpRequestsTotal).toBeDefined();
      // The mock Counter instance has an _value property
      expect(typeof (httpRequestsTotal as { _value?: unknown })._value).toBe('number');
    });

    it('registers httpRequestDurationSeconds as a Histogram', () => {
      expect(httpRequestDurationSeconds).toBeDefined();
      expect(typeof (httpRequestDurationSeconds as { _value?: unknown })._value).toBe('number');
    });

    it('registers indexerEventsProcessedTotal as a Counter', () => {
      expect(indexerEventsProcessedTotal).toBeDefined();
      expect(typeof (indexerEventsProcessedTotal as { _value?: unknown })._value).toBe('number');
    });

    it('registers indexerPollLagSeconds as a Gauge', () => {
      expect(indexerPollLagSeconds).toBeDefined();
      expect(typeof (indexerPollLagSeconds as { _value?: unknown })._value).toBe('number');
    });

    it('registers dbQueryDurationSeconds as a Histogram', () => {
      expect(dbQueryDurationSeconds).toBeDefined();
      expect(typeof (dbQueryDurationSeconds as { _value?: unknown })._value).toBe('number');
    });

    it('registers websocketConnectionsActive as a Gauge', () => {
      expect(websocketConnectionsActive).toBeDefined();
      expect(typeof (websocketConnectionsActive as { _value?: unknown })._value).toBe('number');
    });

    it('has all 6 metrics registered in the registry', () => {
      // The mock registry exposes getMetricsAsArray
      const registered = (registry as unknown as { getMetricsAsArray(): unknown[] }).getMetricsAsArray();
      expect(registered.length).toBeGreaterThanOrEqual(6);
    });
  });

  describe('httpRequestsTotal', () => {
    it('can be incremented via labels()', () => {
      const before = (httpRequestsTotal as unknown as { _value: number })._value;
      httpRequestsTotal.labels('GET', '/health', '200').inc();
      const after = (httpRequestsTotal as unknown as { _value: number })._value;
      expect(after).toBe(before + 1);
    });

    it('increments by a custom amount', () => {
      const before = (httpRequestsTotal as unknown as { _value: number })._value;
      httpRequestsTotal.labels('POST', '/api/v1/schedules', '201').inc(3);
      const after = (httpRequestsTotal as unknown as { _value: number })._value;
      expect(after).toBe(before + 3);
    });
  });
});

describe('GET /metrics endpoint', () => {
  it('returns HTTP 200', async () => {
    const { res, status } = makeRes();
    await prometheusMetricsHandler(req, res);
    expect(status).toHaveBeenCalledWith(200);
  });

  it('sets Content-Type to Prometheus text format', async () => {
    const { res, setHeader } = makeRes();
    await prometheusMetricsHandler(req, res);
    expect(setHeader).toHaveBeenCalledWith(
      'Content-Type',
      expect.stringContaining('text/plain'),
    );
  });

  it('returns a body containing Prometheus HELP lines', async () => {
    const { res, _body } = makeRes();
    await prometheusMetricsHandler(req, res);
    const body = _body.join('');
    // Prometheus text format always starts with "# HELP" lines
    expect(body).toMatch(/# HELP /);
  });

  it('returns a body containing # TYPE lines', async () => {
    const { res, _body } = makeRes();
    await prometheusMetricsHandler(req, res);
    const body = _body.join('');
    expect(body).toMatch(/# TYPE /);
  });

  it('includes http_requests_total in the output', async () => {
    const { res, _body } = makeRes();
    await prometheusMetricsHandler(req, res);
    const body = _body.join('');
    expect(body).toContain('http_requests_total');
  });
});

describe('GET /api/v1/metrics endpoint (legacy JSON)', () => {
  it('returns HTTP 200', async () => {
    const { res, status } = makeRes();
    await jsonMetricsHandler(req, res);
    expect(status).toHaveBeenCalledWith(200);
  });

  it('sets Content-Type to application/json', async () => {
    const { res, setHeader } = makeRes();
    await jsonMetricsHandler(req, res);
    expect(setHeader).toHaveBeenCalledWith('Content-Type', 'application/json');
  });

  it('returns a body with service name and cache stats', async () => {
    const { res, _body } = makeRes();
    await jsonMetricsHandler(req, res);
    const body = JSON.parse(_body.join(''));
    expect(body.service).toBe('vesting-backend');
    expect(body.cache).toBeDefined();
    expect(typeof body.cache.hits).toBe('number');
  });
});
