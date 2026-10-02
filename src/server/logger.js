import { appendFileSync } from 'node:fs';

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const DEFAULT_LEVEL = 'info';

function resolveThreshold(raw) {
  const level = String(raw || '').toLowerCase();
  return LEVELS[level] ?? LEVELS[DEFAULT_LEVEL];
}

function serializeError(err) {
  if (!(err instanceof Error)) {
    return { message: String(err) };
  }
  const out = { name: err.name, message: err.message };
  if (err.code !== undefined) out.code = err.code;
  if (err.stack) out.stack = err.stack;
  return out;
}

/**
 * Replacer that survives the values that actually turn up in a request handler:
 * Errors, BigInt counters, and objects that reference themselves.
 */
function replacer(seen) {
  return function replace(key, value) {
    if (typeof value === 'bigint') return value.toString();
    if (value instanceof Error) return serializeError(value);
    if (typeof value === 'object' && value !== null) {
      if (seen.has(value)) return '[Circular]';
      seen.add(value);
    }
    return value;
  };
}

/**
 * Emits one JSON object per line.
 *
 * The line format is what the rest of the pipeline depends on: the CloudWatch
 * metric filters in terraform/logging.tf match on `$.level` and `$.service`, and
 * Fluent Bit forwards these lines to /ecs/api-server untouched. Anything that
 * breaks the one-object-per-line shape silently breaks both.
 *
 * Destination:
 *   - `LOG_FILE` set   -> appended to that file, which is what the Fluent Bit
 *                         sidecar tails inside the ECS task.
 *   - `LOG_FILE` unset -> stdout, so local development and the test suite see
 *                         the same format.
 *
 * Writes are synchronous on purpose. An append of a single short line to a file
 * opened O_APPEND is atomic, and a synchronous write cannot be lost when the
 * process is killed mid-request -- which is exactly when the log matters most.
 */
export class Logger {
  constructor(options = {}) {
    this.service = options.service ?? process.env.SERVICE_NAME ?? 'api-server';
    this.env = options.env ?? process.env.ENVIRONMENT ?? process.env.NODE_ENV ?? 'development';
    this.file = options.file ?? process.env.LOG_FILE ?? null;
    this.threshold = resolveThreshold(options.level ?? process.env.LOG_LEVEL ?? DEFAULT_LEVEL);
    this.bindings = options.bindings ?? {};
    this.now = options.now ?? (() => new Date().toISOString());
  }

  /** Returns a logger that adds `bindings` to every record. */
  child(bindings) {
    return new Logger({
      service: this.service,
      env: this.env,
      file: this.file,
      level: this.threshold,
      bindings: { ...this.bindings, ...bindings },
      now: this.now
    });
  }

  isLevelEnabled(level) {
    return LEVELS[level] >= this.threshold;
  }

  write(level, msg, fields) {
    if (!this.isLevelEnabled(level)) return;

    const record = {
      ts: this.now(),
      level,
      service: this.service,
      env: this.env,
      msg: typeof msg === 'string' ? msg : String(msg),
      ...this.bindings,
      ...(fields || {})
    };

    const line = `${JSON.stringify(record, replacer(new Set()))}\n`;

    try {
      if (this.file) {
        appendFileSync(this.file, line, 'utf8');
      } else {
        process.stdout.write(line);
      }
    } catch (err) {
      // A logger that throws takes the request handler down with it. Fall back
      // to stderr so the failure is still visible, and keep going.
      process.stderr.write(`log write failed: ${err && err.message}\n`);
    }
  }

  debug(msg, fields) { this.write('debug', msg, fields); }
  info(msg, fields) { this.write('info', msg, fields); }
  warn(msg, fields) { this.write('warn', msg, fields); }

  error(msg, fields) {
    const { err, ...rest } = fields || {};
    this.write('error', msg, err === undefined ? rest : { ...rest, err: serializeError(err) });
  }
}

export const logger = new Logger();

export default logger;
