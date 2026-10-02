// Must be required FIRST before any other imports.
'use strict';

const { NodeSDK } = require('@opentelemetry/sdk-node');
const { getNodeAutoInstrumentations } = require('@opentelemetry/auto-instrumentations-node');
const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-http');
const { Resource } = require('@opentelemetry/resources');
const { SEMRESATTRS_SERVICE_NAME, SEMRESATTRS_SERVICE_VERSION } = require('@opentelemetry/semantic-conventions');
const { SimpleSpanProcessor } = require('@opentelemetry/sdk-trace-base');

class SlowSpanProcessor {
  constructor(delegate) {
    this._delegate = delegate;
  }
  onStart(span, context) {
    this._delegate.onStart(span, context);
  }
  onEnd(span) {
    const duration = (span.endTime[0] - span.startTime[0]) * 1000 +
      (span.endTime[1] - span.startTime[1]) / 1e6;
    if (duration > 200) {
      console.warn(`[slow-span] ${span.name} took ${Math.round(duration)}ms`);
    }
    this._delegate.onEnd(span);
  }
  shutdown() { return this._delegate.shutdown(); }
  forceFlush() { return this._delegate.forceFlush(); }
}

const exporter = new OTLPTraceExporter({
  url: `${process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://localhost:4318'}/v1/traces`,
});

const sdk = new NodeSDK({
  resource: new Resource({
    [SEMRESATTRS_SERVICE_NAME]: process.env.SERVICE_NAME || 'vesting-backend',
    [SEMRESATTRS_SERVICE_VERSION]: process.env.SERVICE_VERSION || '0.0.0',
    'deployment.environment': process.env.NODE_ENV || 'development',
  }),
  spanProcessor: new SlowSpanProcessor(new SimpleSpanProcessor(exporter)),
  instrumentations: [getNodeAutoInstrumentations()],
});

sdk.start();

process.on('SIGTERM', () => sdk.shutdown());
