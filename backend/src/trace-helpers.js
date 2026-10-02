"use strict";

const { trace, context } = require("@opentelemetry/api");

const tracer = trace.getTracer("vesting-backend");

function withSpan(name, attributes, fn) {
  return tracer.startActiveSpan(name, { attributes }, async (span) => {
    try {
      return await fn();
    } catch (err) {
      span.recordException(err);
      throw err;
    } finally {
      span.end();
    }
  });
}

const withHttpSpan = (name, fn) =>
  withSpan(name, { "http.route": name }, fn);

const withDbSpan = (name, fn) =>
  withSpan(name, { "db.system": "postgresql" }, fn);

const withRpcSpan = (name, fn) =>
  withSpan(name, { "rpc.system": "soroban" }, fn);

module.exports = { withHttpSpan, withDbSpan, withRpcSpan };
