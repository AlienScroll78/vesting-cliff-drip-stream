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
 *
 * Additionally, the current request_id is forwarded as `X-Request-ID` so that
 * Horizon-side logs can be correlated back to the originating request.
 */

import * as http from 'http';
import * as https from 'https';
import { context, trace, SpanKind, SpanStatusCode } from '@opentelemetry/api';

// Import request_id accessor from logger.  The import is resolved at runtime;
// if the module is unavailable in a test environment the fallback returns null.
let getRequestIdFn: () => string | null = () => null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const loggerModule = require('./logger.js');
  if (typeof loggerModule.getRequestId === 'function') {
    getRequestIdFn = loggerModule.getRequestId;
  }
} catch {
  // logger not available — proceed without request_id propagation
}

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
 * The `X-Request-ID` header is forwarded so Horizon-side logs can be
 * correlated with the originating request.
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
  // Read the current request_id from AsyncLocalStorage so we can forward it.
  const requestId = getRequestIdFn();

  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;

    const options: http.RequestOptions = { method: 'GET' };
    if (requestId) {
      options.headers = { 'X-Request-ID': requestId };
    }

    const req = lib.get(url, options, (res) => {
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
