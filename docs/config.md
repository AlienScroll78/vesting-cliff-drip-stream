# Backend Configuration Reference

All backend configuration is read from environment variables.  The
application validates the entire set of variables at startup using a
[Zod](https://zod.dev) schema defined in
[`backend/src/config.ts`](../backend/src/config.ts).  Any missing or
invalid value causes an immediate exit with a human-readable error.

Copy `.env.example` to `.env` and fill in the required values before
running the server.

---

## Variable Reference

### Server

| Variable   | Required | Default         | Description |
|------------|----------|-----------------|-------------|
| `PORT`     | No       | `3000`          | TCP port the HTTP server listens on (1–65535). |
| `NODE_ENV` | No       | `development`   | Deployment environment: `development`, `test`, `staging`, or `production`. |

---

### Stellar / Horizon

| Variable               | Required | Default | Description |
|------------------------|----------|---------|-------------|
| `HORIZON_URL`          | **Yes**  | —       | Base URL of the Horizon instance used for submitting transactions (must be a valid URL). |
| `NETWORK_PASSPHRASE`   | **Yes**  | —       | Stellar network passphrase, e.g. `"Test SDF Network ; September 2015"`. |
| `VESTING_CONTRACT_ID`  | **Yes**  | —       | Deployed vesting contract address in C… Strkey format. |

---

### Database

| Variable       | Required | Default | Description |
|----------------|----------|---------|-------------|
| `DATABASE_URL` | **Yes**  | —       | PostgreSQL connection URL (`postgres://user:pass@host:port/db`). |
| `DB_POOL_MAX`  | No       | `10`    | Maximum number of connections in the pool (positive integer). |

---

### Redis

| Variable            | Required | Default | Description |
|---------------------|----------|---------|-------------|
| `REDIS_URL`         | **Yes**  | —       | Redis connection URL (`redis://[:password@]host[:port][/db]`). |
| `REDIS_TTL_SECONDS` | No       | `300`   | Default TTL for cached entries in seconds (positive integer). |

---

### Webhooks

| Variable                | Required | Default | Description |
|-------------------------|----------|---------|-------------|
| `WEBHOOK_SECRET`        | **Yes**  | —       | Shared secret for HMAC-SHA256 payload signatures (≥ 16 characters). |
| `WEBHOOK_ALLOWED_URLS`  | No       | `""`    | Comma-separated list of allowed webhook destination URLs. Empty disables outgoing webhooks. |

---

### OpenTelemetry

| Variable                       | Required | Default             | Description |
|--------------------------------|----------|---------------------|-------------|
| `OTEL_EXPORTER_OTLP_ENDPOINT`  | No       | `""` (disabled)     | OTLP HTTP endpoint for trace export. Leave empty to disable tracing entirely. |
| `OTEL_SERVICE_NAME`            | No       | `vesting-backend`   | Logical service name reported in every span. |
| `OTEL_SERVICE_VERSION`         | No       | `0.0.0`             | Service version string reported in every span. |
| `OTEL_SAMPLE_RATE`             | No       | `0.1`               | Tail-sampling rate as a fraction (0–1). `0.1` = 10 % sampled. |

---

### Auth / Security

| Variable          | Required | Default | Description |
|-------------------|----------|---------|-------------|
| `JWT_SECRET`      | **Yes**  | —       | Secret for signing JWT access tokens (≥ 32 characters). Use a strong random value in production. |
| `JWT_EXPIRES_IN`  | No       | `1h`    | JWT expiry as a [vercel/ms](https://github.com/vercel/ms) duration string, e.g. `15m`, `2h`, `7d`. |
| `CORS_ALL_ORIGINS`| No       | `false` | Set to `true` to allow CORS from all origins. **Do not enable in production.** |

---

### Logging

| Variable    | Required | Default | Description |
|-------------|----------|---------|-------------|
| `LOG_LEVEL` | No       | `info`  | Minimum log level: `trace`, `debug`, `info`, `warn`, `error`, or `fatal`. |

---

## Type coercions

The Zod schema performs the following automatic coercions so all raw
environment strings are returned as the correct TypeScript types:

| Target type      | Examples |
|------------------|----------|
| `number`         | `PORT`, `DB_POOL_MAX`, `REDIS_TTL_SECONDS`, `OTEL_SAMPLE_RATE` |
| `boolean`        | `CORS_ALL_ORIGINS` — truthy values: `"true"`, `"1"`, `"yes"` (case-insensitive) |
| `string[]`       | `WEBHOOK_ALLOWED_URLS` — split on commas, whitespace-trimmed |

---

## Using the config object

```typescript
import { config } from './config';

// Typed, frozen, validated at startup
console.log(config.horizonUrl);    // string
console.log(config.dbPoolMax);     // number
console.log(config.corsAllOrigins); // boolean
```

## Unit-testing config validation

Import `parseConfig` directly and pass a mock env map:

```typescript
import { parseConfig } from './config';

it('rejects missing HORIZON_URL', () => {
  const env = { ...validEnv, HORIZON_URL: undefined };
  // parseConfig calls process.exit(1) on failure; spy or mock as needed.
});
```

See [`backend/tests/config.test.ts`](../backend/tests/config.test.ts) for
the full test suite.
