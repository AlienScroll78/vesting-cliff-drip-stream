/**
 * Thin wrapper around outbound Horizon HTTP calls.
 *
 * All requests are automatically traced by the HttpInstrumentation configured
 * in tracing.ts.  This module adds explicit manual span attributes for
 * Horizon-specific context (operation type, account, etc.) so that traces
 * are easy to filter in the observability backend.
 *
 * The W3C TraceContext propagator (configured in tracing.ts) injects
 * `traceparent` / `tracestate` headers into every outbound request, allowing
 * correlation across services that support the standard.
 */

import * as http from 'http';
import * as https from 'https';
import { context, trace, SpanKind, SpanStatusCode } from '@opentelemetry/api';

const tracer = trace.getTracer('horizon-client', '1.0.0');

export interface HorizonResponse<T = unknown> {
  status: number;
  data: T;
}

/**
 * Performs a GET request to the configured Horizon base URL and returns the
 * parsed JSON body.
 *
 * A child span named `horizon.get` is created and attached to the current
 * active context so it nests correctly inside the parent HTTP request span.
 */
export async function horizonGet<T = unknown>(
  baseUrl: string,
  path: string,
): Promise<HorizonResponse<T>> {
  return tracer.startActiveSpan(
    `horizon.get ${path}`,
    {
      kind: SpanKind.CLIENT,
      attributes: {
        'horizon.base_url': baseUrl,
        'horizon.path':     path,
        'http.method':      'GET',
        'http.url':         `${baseUrl}${path}`,
      },
    },
    async (span) => {
      try {
        const result = await httpGet<T>(`${baseUrl}${path}`);
        span.setAttributes({
          'http.status_code': result.status,
        });
        if (result.status >= 400) {
          span.setStatus({ code: SpanStatusCode.ERROR, message: `HTTP ${result.status}` });
        }
        return result;
      } catch (err) {
        span.setStatus({ code: SpanStatusCode.ERROR, message: String(err) });
        span.recordException(err as Error);
        throw err;
      } finally {
        span.end();
      }
    },
  );
}

// ── Internal HTTP helper ──────────────────────────────────────────────────────

function httpGet<T>(url: string): Promise<HorizonResponse<T>> {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(url, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => {
        try {
          const body = Buffer.concat(chunks).toString('utf8');
          const data = body ? (JSON.parse(body) as T) : ({} as T);
          resolve({ status: res.statusCode ?? 0, data });
        } catch (err) {
          reject(err);
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(10_000, () => {
      req.destroy(new Error('Horizon request timed out after 10 s'));
    });
  });
}
