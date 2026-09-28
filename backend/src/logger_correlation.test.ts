/**
 * Tests for structured logging correlation ID propagation.
 * Verifies that request_id, trace_id, and correlation_id are injected
 * into every log line during a request via AsyncLocalStorage.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Set required env before importing db-dependent modules
process.env.DATABASE_URL = 'postgresql://test:test@localhost/test';

const {
  logger,
  getRequestId,
  getTraceId,
  getCorrelationId,
  runWithIds,
  runWithCorrelationId,
} = await import('../backend/src/logger.js');

describe('logger correlation ID propagation', () => {
  describe('outside a request context', () => {
    it('getRequestId() returns null', () => {
      expect(getRequestId()).toBeNull();
    });
    it('getTraceId() returns null', () => {
      expect(getTraceId()).toBeNull();
    });
    it('getCorrelationId() returns null', () => {
      expect(getCorrelationId()).toBeNull();
    });
  });

  describe('inside runWithIds()', () => {
    it('propagates all three IDs', () => {
      runWithIds({ requestId: 'req-123', traceId: 'trace-abc', correlationId: 'corr-xyz' }, () => {
        expect(getRequestId()).toBe('req-123');
        expect(getTraceId()).toBe('trace-abc');
        expect(getCorrelationId()).toBe('corr-xyz');
      });
    });

    it('returns null for IDs not supplied', () => {
      runWithIds({ requestId: 'req-only' }, () => {
        expect(getRequestId()).toBe('req-only');
        expect(getTraceId()).toBeNull();
        expect(getCorrelationId()).toBeNull();
      });
    });

    it('restores null after context exits', () => {
      runWithIds({ requestId: 'req-temp' }, () => {});
      expect(getRequestId()).toBeNull();
    });
  });

  describe('backwards compat — runWithCorrelationId()', () => {
    it('sets correlationId accessible via getCorrelationId()', () => {
      runWithCorrelationId('legacy-id', () => {
        expect(getCorrelationId()).toBe('legacy-id');
      });
    });
  });

  describe('log output contains correlation fields', () => {
    it('injects request_id, trace_id, correlation_id into every log line', () => {
      const lines: string[] = [];
      const origWrite = process.stdout.write.bind(process.stdout);
      vi.spyOn(process.stdout, 'write').mockImplementation((chunk: any) => {
        lines.push(String(chunk));
        return true;
      });

      runWithIds({ requestId: 'req-999', traceId: 'tid-777', correlationId: 'cid-888' }, () => {
        logger.info({ event: 'test_event' }, 'test message');
      });

      process.stdout.write = origWrite;

      expect(lines.length).toBeGreaterThan(0);
      const logLine = JSON.parse(lines[0].trim());
      expect(logLine.request_id).toBe('req-999');
      expect(logLine.trace_id).toBe('tid-777');
      expect(logLine.correlation_id).toBe('cid-888');
    });

    it('omits missing correlation fields from log output', () => {
      const lines: string[] = [];
      vi.spyOn(process.stdout, 'write').mockImplementation((chunk: any) => {
        lines.push(String(chunk));
        return true;
      });

      runWithIds({ requestId: 'req-only' }, () => {
        logger.info('msg with only request_id');
      });

      vi.restoreAllMocks();

      const logLine = JSON.parse(lines[0].trim());
      expect(logLine.request_id).toBe('req-only');
      expect(logLine.trace_id).toBeUndefined();
      expect(logLine.correlation_id).toBeUndefined();
    });
  });
});
