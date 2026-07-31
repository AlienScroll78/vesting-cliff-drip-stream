/**
 * Centralised configuration module.
 *
 * All environment variable access in the backend MUST go through this module.
 * The schema is validated once at startup; missing required variables cause an
 * immediate process exit with a clear error message.  The resulting config
 * object is frozen so it cannot be mutated at runtime.
 *
 * Usage:
 *   import { config } from './config';
 *   console.log(config.horizonUrl);
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Coerce a comma-separated string env var into a string array.
 * e.g. "http://a,http://b" → ["http://a", "http://b"]
 */
const csvArray = z
  .string()
  .transform((val) => val.split(',').map((s) => s.trim()).filter(Boolean));

/**
 * Coerce a string to a boolean.
 * Accepted truthy values: "true", "1", "yes"  (case-insensitive)
 */
const booleanString = z
  .string()
  .transform((val) => ['true', '1', 'yes'].includes(val.toLowerCase()));

// ---------------------------------------------------------------------------
// Schema definition
// ---------------------------------------------------------------------------

const configSchema = z.object({
  // ── Server ────────────────────────────────────────────────────────────────
  /** TCP port the HTTP server listens on. @default 3000 */
  port: z
    .string()
    .default('3000')
    .transform(Number)
    .pipe(z.number().int().min(1).max(65535)),

  /** Deployment environment. @default "development" */
  nodeEnv: z
    .enum(['development', 'test', 'staging', 'production'])
    .default('development'),

  // ── Stellar / Horizon ─────────────────────────────────────────────────────
  /** Base URL of the Horizon instance used for submitting transactions. */
  horizonUrl: z.string().url(),

  /** Stellar network passphrase (identifies mainnet vs testnet). */
  networkPassphrase: z.string().min(1),

  /** Deployed vesting contract address (Cᵥ… Strkey). */
  vestingContractId: z.string().min(1),

  // ── Database ──────────────────────────────────────────────────────────────
  /** PostgreSQL connection URL. e.g. postgres://user:pass@host:5432/dbname */
  databaseUrl: z.string().url(),

  /** Maximum number of pooled DB connections. @default 10 */
  dbPoolMax: z
    .string()
    .default('10')
    .transform(Number)
    .pipe(z.number().int().positive()),

  // ── Redis ─────────────────────────────────────────────────────────────────
  /** Redis connection URL. e.g. redis://localhost:6379 */
  redisUrl: z.string().url(),

  /** Default TTL for cached entries in seconds. @default 300 */
  redisTtlSeconds: z
    .string()
    .default('300')
    .transform(Number)
    .pipe(z.number().int().positive()),

  // ── Webhooks ──────────────────────────────────────────────────────────────
  /** Shared secret used to sign outgoing webhook payloads (HMAC-SHA256). */
  webhookSecret: z.string().min(16),

  /** Comma-separated list of allowed webhook destination URLs. @default "" */
  webhookAllowedUrls: z
    .string()
    .default('')
    .pipe(csvArray),

  // ── OpenTelemetry ─────────────────────────────────────────────────────────
  /** OTLP endpoint for trace export. @default "" (disabled) */
  otlpEndpoint: z.string().default(''),

  /** Logical service name reported in traces. @default "vesting-backend" */
  otelServiceName: z.string().default('vesting-backend'),

  /** Service version reported in traces. @default "0.0.0" */
  otelServiceVersion: z.string().default('0.0.0'),

  /**
   * Tail-sampling rate as a fraction between 0 and 1.
   * 0.1 = 10 % of traces are exported.
   * @default 0.1
   */
  otelSampleRate: z
    .string()
    .default('0.1')
    .transform(Number)
    .pipe(z.number().min(0).max(1)),

  // ── Auth / Security ───────────────────────────────────────────────────────
  /** Secret used to sign JWT access tokens. Must be at least 32 characters. */
  jwtSecret: z.string().min(32),

  /** JWT expiry expressed as a vercel/ms duration string. @default "1h" */
  jwtExpiresIn: z.string().default('1h'),

  /** Enable CORS for all origins (useful in development). @default false */
  corsAllOrigins: booleanString.default('false'),

  // ── Logging ───────────────────────────────────────────────────────────────
  /** Minimum log level. @default "info" */
  logLevel: z
    .enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal'])
    .default('info'),
});

// ---------------------------------------------------------------------------
// Parse & export
// ---------------------------------------------------------------------------

/**
 * Raw environment map that the schema is parsed from.
 * Exposed so tests can swap it out without touching `process.env`.
 */
export function parseConfig(env: NodeJS.ProcessEnv = process.env) {
  const result = configSchema.safeParse({
    port:                 env.PORT,
    nodeEnv:              env.NODE_ENV,
    horizonUrl:           env.HORIZON_URL,
    networkPassphrase:    env.NETWORK_PASSPHRASE,
    vestingContractId:    env.VESTING_CONTRACT_ID,
    databaseUrl:          env.DATABASE_URL,
    dbPoolMax:            env.DB_POOL_MAX,
    redisUrl:             env.REDIS_URL,
    redisTtlSeconds:      env.REDIS_TTL_SECONDS,
    webhookSecret:        env.WEBHOOK_SECRET,
    webhookAllowedUrls:   env.WEBHOOK_ALLOWED_URLS,
    otlpEndpoint:         env.OTEL_EXPORTER_OTLP_ENDPOINT,
    otelServiceName:      env.OTEL_SERVICE_NAME,
    otelServiceVersion:   env.OTEL_SERVICE_VERSION,
    otelSampleRate:       env.OTEL_SAMPLE_RATE,
    jwtSecret:            env.JWT_SECRET,
    jwtExpiresIn:         env.JWT_EXPIRES_IN,
    corsAllOrigins:       env.CORS_ALL_ORIGINS,
    logLevel:             env.LOG_LEVEL,
  });

  if (!result.success) {
    const messages = result.error.issues
      .map((issue) => `  • ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    // Emit to stderr so the error is visible even if log sinks are not set up.
    process.stderr.write(
      `\n[config] Invalid environment configuration:\n${messages}\n\n`,
    );
    process.exit(1);
  }

  return Object.freeze(result.data);
}

/**
 * The application configuration, validated and frozen at import time.
 *
 * Importing this module in production code will call `parseConfig()` once.
 * In unit tests, import `parseConfig` directly and pass a mock env map.
 */
export const config = parseConfig();

export type Config = z.infer<typeof configSchema>;
