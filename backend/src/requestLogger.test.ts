/**
 * Tests for requestLogger middleware.
 *
 * Verifies UUID request_id generation, X-Request-ID / X-Correlation-Id header
 * propagation, and AsyncLocalStorage correlation ID injection.
 *
 * We use vi.doMock + dynamic import to intercept the logger.js dependency
 * before requestLogger.js loads it, sidestepping the CJS/ESM interop issue
 * that affects vitest when static imports trigger require() in .js modules.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

process.env.DATABASE_URL = 'postgresql://test:test@localhost/test';

// ── Shared mock state ─────────────────────────────────────────────────────────

let capturedIds: Record<string, string | null> = {};
const mockLogger = {
  info:  vi.fn(),
  debug: vi.fn(),
  warn:  vi.fn(),
  error: vi.fn(),
};

// vi.doMock is applied before the dynamic import below, which loads
// requestLogger.js and causes it to require('./logger.js').
vi.doMock('./logger.js', () => ({
  logger: mockLogger,
  runWithIds: vi.fn((ids: any, fn: () => void) => {
    capturedIds = { ...ids };
    fn();
  }),
  getRequestId:     vi.fn(() => capturedIds.requestId ?? null),
  getCorrelationId: vi.fn(() => capturedIds.correlationId ?? null),
  getTraceId:       vi.fn(() => null),
  correlationStorage: { getStore: vi.fn(() => null) },
}));

// Dynamic import so it picks up the mock above.
const { requestLoggerMiddleware } = await import('./requestLogger.js') as any;

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeReq(headers: Record<string, string> = {}) {
  return { method: 'GET', url: '/test', headers } as any;
}

function makeRes() {
  const hdrs: Record<string, string> = {};
  return {
    setHeader: (k: string, v: string) => { hdrs[k] = v; },
    end: vi.fn(),
    statusCode: 200,
    _headers: hdrs,
  } as any;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('requestLoggerMiddleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedIds = {};
  });

  it('sets X-Request-ID as a UUID v4 when no header supplied', () => {
    const req = makeReq();
    const res = makeRes();
    requestLoggerMiddleware(req, res, vi.fn());
    expect(res._headers['X-Request-ID']).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it('echoes an existing X-Request-ID from the incoming header', () => {
    const req = makeReq({ 'x-request-id': 'client-provided-id' });
    const res = makeRes();
    requestLoggerMiddleware(req, res, vi.fn());
    expect(res._headers['X-Request-ID']).toBe('client-provided-id');
  });

  it('sets X-Correlation-Id from X-Correlation-Id request header', () => {
    const req = makeReq({ 'x-correlation-id': 'caller-corr' });
    const res = makeRes();
    requestLoggerMiddleware(req, res, vi.fn());
    expect(res._headers['X-Correlation-Id']).toBe('caller-corr');
  });

  it('falls back X-Correlation-Id to request_id when X-Correlation-Id absent', () => {
    const req = makeReq({ 'x-request-id': 'req-fallback' });
    const res = makeRes();
    requestLoggerMiddleware(req, res, vi.fn());
    expect(res._headers['X-Correlation-Id']).toBe('req-fallback');
  });

  it('calls runWithIds with requestId, correlationId, and traceId', () => {
    const req = makeReq({
      'x-request-id':     'req-111',
      'x-correlation-id': 'corr-222',
    });
    const res = makeRes();
    requestLoggerMiddleware(req, res, vi.fn());
    expect(capturedIds.requestId).toBe('req-111');
    expect(capturedIds.correlationId).toBe('corr-222');
    // traceId key must be present (null is fine when no OTel span is active)
    expect('traceId' in capturedIds).toBe(true);
  });

  it('calls next() inside the runWithIds context', () => {
    const req = makeReq();
    const res = makeRes();
    const next = vi.fn();
    requestLoggerMiddleware(req, res, next);
    expect(next).toHaveBeenCalledOnce();
  });

  it('generates a unique request_id for each request', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 10; i++) {
      const req = makeReq();
      const res = makeRes();
      requestLoggerMiddleware(req, res, vi.fn());
      ids.add(res._headers['X-Request-ID']);
    }
    expect(ids.size).toBe(10);
  });

  it('redacts Authorization header from request log', () => {
    const req = makeReq({
      authorization:    'Bearer secret-token',
      cookie:           'session=abc',
      'x-safe-header':  'visible',
    });
    const res = makeRes();
    requestLoggerMiddleware(req, res, vi.fn());
    const loggedHeaders = (mockLogger.info as ReturnType<typeof vi.fn>)
      .mock.calls[0]?.[0]?.headers ?? {};
    expect(loggedHeaders['authorization']).toBe('[REDACTED]');
    expect(loggedHeaders['cookie']).toBe('[REDACTED]');
    expect(loggedHeaders['x-safe-header']).toBe('visible');
  });
});
