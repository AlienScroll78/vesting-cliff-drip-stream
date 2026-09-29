# Configuration Reference

All runtime configuration is supplied via environment variables. Copy `.env.example` to `.env` and fill in the required values before starting any service.

```bash
cp .env.example .env
```

The backend validates all variables at startup using a Zod schema (`backend/src/config.ts`). Missing required variables cause an immediate process exit with a clear error message, preventing silent misconfiguration.

---

## Table of Contents

- [Backend](#backend)
  - [Server](#server)
  - [Stellar / Horizon](#stellar--horizon)
  - [Database (PostgreSQL)](#database-postgresql)
  - [Cache (Redis)](#cache-redis)
  - [Authentication & JWT](#authentication--jwt)
  - [Rate Limiting](#rate-limiting)
  - [Webhooks](#webhooks)
  - [OpenTelemetry](#opentelemetry)
  - [Logging](#logging)
  - [Admin / Bulk Claim](#admin--bulk-claim)
  - [GraphQL](#graphql)
- [Frontend](#frontend)
- [Contract Deployment](#contract-deployment)
- [ESO-Managed Variables (Production)](#eso-managed-variables-production)
- [Environment Examples](#environment-examples)
- [Breaking Changes](#breaking-changes)
- [Security Notes](#security-notes)

---

## Backend

### Server

| Variable | Type | Default | Required | Description | Example |
|---|---|---|---|---|---|
| `PORT` | `number` | `3000` | No | TCP port the HTTP server listens on. Must be 1–65535. | `3001` |
| `NODE_ENV` | `string` | `development` | No | Deployment environment. Accepted: `development`, `test`, `staging`, `production`. | `production` |
| `CORS_ALL_ORIGINS` | `boolean` | `false` | No | Enable CORS for all origins. Set to `true` in development only. Never enable in production. | `true` |

### Stellar / Horizon

| Variable | Type | Default | Required | Description | Example |
|---|---|---|---|---|---|
| `HORIZON_URL` | `string` (URL) | — | **Yes** | Horizon REST API base URL. Use the testnet or mainnet endpoint matching `NETWORK_PASSPHRASE`. | `https://horizon-testnet.stellar.org` |
| `NETWORK_PASSPHRASE` | `string` | — | **Yes** | Stellar network passphrase. Must exactly match the network the contract is deployed on. | `Test SDF Network ; September 2015` |
| `VESTING_CONTRACT_ID` | `string` | — | **Yes** | Soroban contract address of the deployed `vesting_cliff_drip_stream` contract. Starts with `C`. | `CABC...XYZ` |
| `SOROBAN_RPC_URL` | `string` (URL) | — | **Yes** | Soroban RPC endpoint for transaction simulation and submission. | `https://soroban-testnet.stellar.org` |
| `HORIZON_API_KEY` | `string` | — | No | 🔒 Optional API key for authenticated Horizon requests. Injected by ESO in production. | `hzn_live_abc123` |
| `REQUEST_TIMEOUT_MS` | `number` | `30000` | No | Maximum milliseconds to wait for a Soroban RPC response before aborting. | `15000` |
| `STELLAR_NETWORK` | `string` | `testnet` | No | Network label used by some scripts. Accepted: `testnet`, `mainnet`, `standalone`. | `testnet` |

> **Note:** `VESTING_CONTRACT_ID` was renamed from `CONTRACT_ID` in v0.3.0. See [Breaking Changes](#breaking-changes).

### Database (PostgreSQL)

| Variable | Type | Default | Required | Description | Example |
|---|---|---|---|---|---|
| `DATABASE_URL` | `string` (URL) | — | **Yes** | 🔒 PostgreSQL connection string. Injected by ESO in production. | `postgres://vesting:vesting@localhost:5432/vesting` |
| `DB_POOL_MAX` | `number` | `10` | No | Maximum number of pooled PostgreSQL connections. | `20` |

The indexer (`backend/src/indexer.ts`) mirrors on-chain events to PostgreSQL. If `DATABASE_URL` is not set, the indexer is disabled and the server continues without it. All REST endpoints backed by the DB will be unavailable.

### Cache (Redis)

| Variable | Type | Default | Required | Description | Example |
|---|---|---|---|---|---|
| `REDIS_URL` | `string` (URL) | — | **Yes** | 🔒 Redis connection string. Used for rate limiting, auth nonces, and view-function caching. Injected by ESO in production. | `redis://localhost:6379` |
| `REDIS_TTL_SECONDS` | `number` | `300` | No | Default TTL (in seconds) for cached entries. Applies to view-function responses cached per ledger. | `60` |

Redis is required for:
- Rate limiting (per-IP and per-API-key counters, issue #32)
- Auth nonce storage (5-minute window for challenge–response, issue #30)
- View-function response caching (per `recipient:ledger`, ~5 s TTL)
- Export rate limiting (1 export per minute per sponsor)

### Authentication & JWT

| Variable | Type | Default | Required | Description | Example |
|---|---|---|---|---|---|
| `JWT_SECRET` | `string` | — | **Yes** | 🔒 Secret used to sign JWT access tokens. Must be **at least 32 characters**. Generate with `openssl rand -base64 32`. Injected by ESO in production. | *(random 32+ byte secret)* |
| `JWT_EXPIRES_IN` | `string` | `1h` | No | JWT expiry as a [vercel/ms](https://github.com/vercel/ms) duration string. | `2h`, `7d` |
| `AUTH_SIGNATURE_WINDOW_MS` | `number` | `300000` | No | Maximum age (ms) of a Stellar signature accepted during the challenge–response auth flow. Default is 5 minutes. | `600000` |

The auth flow:
1. `GET /api/auth/challenge?address=G…` — issues a nonce stored in Redis for 5 minutes.
2. `POST /api/auth/token` — verifies the Stellar signature over `address:nonce:timestamp` and returns a JWT.
3. Subsequent requests pass `Authorization: Bearer <token>`.

### Rate Limiting

| Variable | Type | Default | Required | Description | Example |
|---|---|---|---|---|---|
| `RATE_LIMIT_IP_MAX` | `number` | `100` | No | Maximum requests per IP address per window. | `200` |
| `RATE_LIMIT_KEY_MAX` | `number` | `1000` | No | Maximum requests per API key per window. | `500` |
| `RATE_LIMIT_WINDOW_SEC` | `number` | `60` | No | Sliding window size in seconds. | `30` |
| `RATE_LIMIT_BYPASS_IPS` | `string` | — | No | Comma-separated list of IP addresses that bypass rate limiting (e.g. internal load-balancer health-check IPs). | `10.0.0.1,10.0.0.2` |
| `RATE_LIMIT_BYPASS_KEYS` | `string` | — | No | Comma-separated API keys that bypass rate limiting. Keep this list short. | `internal-monitor-key` |

Rate limiting is implemented in `backend/src/middleware/rateLimit.ts` and uses Redis for distributed counters. The middleware applies to all public routes.

### Webhooks

| Variable | Type | Default | Required | Description | Example |
|---|---|---|---|---|---|
| `WEBHOOK_SECRET` | `string` | — | **Yes** | 🔒 Shared secret for signing outgoing webhook payloads with HMAC-SHA256. Must be at least 16 characters. | *(random 32+ byte secret)* |
| `WEBHOOK_ALLOWED_URLS` | `string` | `""` | No | Comma-separated list of allowed webhook destination URLs. Empty string disables outgoing webhooks. | `https://example.com/hook,https://app.io/webhook` |

Webhook payloads include an `X-Webhook-Signature` header: `sha256=<hmac>` computed over the raw body with `WEBHOOK_SECRET`. Receivers should verify this header before processing.

### OpenTelemetry

| Variable | Type | Default | Required | Description | Example |
|---|---|---|---|---|---|
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `string` (URL) | `""` | No | OTLP HTTP endpoint for trace export. Empty string disables tracing. | `http://localhost:4318` |
| `OTEL_SERVICE_NAME` | `string` | `vesting-backend` | No | Logical service name reported in all traces and spans. | `vesting-backend-staging` |
| `OTEL_SERVICE_VERSION` | `string` | `0.0.0` | No | Service version reported in traces. Set to the deployed image tag. | `1.4.2` |
| `OTEL_SAMPLE_RATE` | `number` | `0.1` | No | Tail-sampling rate as a fraction between 0.0 and 1.0. `0.1` = 10% of traces exported. Set to `1.0` in development for full trace capture. | `0.25` |

See [docs/opentelemetry.md](opentelemetry.md) for the full tracing setup, Jaeger integration, and span naming conventions.

### Logging

| Variable | Type | Default | Required | Description | Example |
|---|---|---|---|---|---|
| `LOG_LEVEL` | `string` | `info` | No | Minimum log level. Accepted: `trace`, `debug`, `info`, `warn`, `error`, `fatal`. | `debug` |

### Admin / Bulk Claim

These variables are only required if you use the `POST /admin/bulk-claim` endpoint.

| Variable | Type | Default | Required | Description | Example |
|---|---|---|---|---|---|
| `ADMIN_API_KEY` | `string` | — | Conditional | 🔒 Bearer token callers must supply in `Authorization: Bearer <key>`. Use a strong random value (≥ 32 bytes). Injected by ESO in production. | *(random 32+ byte secret)* |
| `SPONSOR_SECRET_KEY` | `string` | — | Conditional | 🔒 Stellar secret key (`S…`) of the account that signs claim transactions on behalf of recipients. **Never commit this value.** Injected by ESO in production. | `SABC...XYZ` |
| `SIGNING_SECRET_KEY` | `string` | — | Conditional | 🔒 Service keypair secret key for automated `POST /tx/submit` transaction signing. **Never commit.** | `SDEF...ABC` |

### GraphQL

| Variable | Type | Default | Required | Description | Example |
|---|---|---|---|---|---|
| `GRAPHQL_MAX_DEPTH` | `number` | `5` | No | Maximum allowed query depth for the GraphQL endpoint. Prevents deeply nested query abuse. | `3` |

---

## Frontend

Frontend variables are prefixed with `VITE_` and are compiled into the browser bundle at build time. They must not contain secrets.

| Variable | Type | Default | Required | Description | Example |
|---|---|---|---|---|---|
| `VITE_API_URL` | `string` (URL) | — | **Yes** | Base URL of the backend API, without a trailing slash. | `http://localhost:3001` |
| `VITE_NETWORK` | `string` | `testnet` | No | Stellar network the frontend targets. Accepted: `testnet`, `mainnet`. Controls which Horizon/RPC URLs are used for client-side queries. | `mainnet` |
| `VITE_CONTRACT_ID` | `string` | — | **Yes** | Contract address shown in the UI and used for client-side Soroban simulations. Must match the backend's `VESTING_CONTRACT_ID`. | `CABC...XYZ` |
| `VITE_HORIZON_URL` | `string` (URL) | — | **Yes** | Horizon URL used by the frontend for client-side queries (e.g. account balances). | `https://horizon-testnet.stellar.org` |
| `VITE_POSTHOG_KEY` | `string` | — | No | PostHog project API key. Leave empty to disable analytics. | `phc_abc123` |
| `VITE_POSTHOG_HOST` | `string` (URL) | `https://app.posthog.com` | No | PostHog ingestion host. Override to use a self-hosted instance or proxy. | `https://eu.posthog.com` |

Frontend variables are set in `frontend/.env` (local) or in the CI/CD environment at build time. They are **not** secret; the compiled bundle is public.

---

## Contract Deployment

These variables are used by the deployment scripts in `scripts/` and are only needed when deploying or interacting with the contract via CLI.

| Variable | Type | Default | Required | Description | Example |
|---|---|---|---|---|---|
| `STELLAR_NETWORK` | `string` | `testnet` | No | Network for `stellar` CLI commands. Accepted: `testnet`, `mainnet`, `standalone`. | `testnet` |
| `STELLAR_ACCOUNT` | `string` | `default` | No | Key alias used by the Stellar CLI for the deployer/admin account. | `deployer` |
| `VESTING_CONTRACT` | `string` | — | After deploy | Contract ID set after running `deploy.sh`. Export it to use with `invoke_create.sh` and `invoke_claim.sh`. | `CABC...XYZ` |
| `SPONSOR` | `string` | — | For invocations | Key alias of the sponsor account used in `invoke_create.sh`. | `default` |
| `RECIPIENT` | `string` | — | For invocations | Stellar public key of the stream recipient. | `GABC...XYZ` |
| `TOKEN` | `string` | — | For invocations | Contract address of the SAC token to vest. | `CABC...XYZ` |
| `RATE` | `number` | — | For invocations | Tokens per ledger for the vesting stream. | `10` |
| `CLIFF_DURATION` | `number` | — | For invocations | Ledgers until the cliff (e.g. `17280` ≈ 1 day at 5 s/ledger). | `17280` |
| `TOTAL_DURATION` | `number` | — | For invocations | Total stream length in ledgers (must exceed `CLIFF_DURATION`). | `172800` |

---

## ESO-Managed Variables (Production)

When deployed via Helm with `externalSecret.enabled=true` (the default), the following variables are injected from the ExternalSecret Operator (ESO) sourced from AWS Secrets Manager or HashiCorp Vault. **Do not set these in ConfigMap or hardcode them anywhere.**

| Variable | Secret Store Path |
|---|---|
| `DATABASE_URL` | `vesting/prod/database-url` |
| `REDIS_URL` | `vesting/prod/redis-url` |
| `ADMIN_API_KEY` | `vesting/prod/admin-api-key` |
| `SPONSOR_SECRET_KEY` | `vesting/prod/sponsor-secret-key` |
| `SIGNING_SECRET_KEY` | `vesting/prod/signing-secret-key` |
| `JWT_SECRET` | `vesting/prod/jwt-secret` |
| `WEBHOOK_SECRET` | `vesting/prod/webhook-secret` |
| `HORIZON_API_KEY` | `vesting/prod/horizon-api-key` |

For local development without ESO, set these variables directly in your `.env` file. See `infra/secrets/` for the full AWS Secrets Manager setup, IAM policy, and rotation configuration.

---

## Environment Examples

### Testnet (local dev against public testnet)

```dotenv
# Backend
PORT=3001
NODE_ENV=development
HORIZON_URL=https://horizon-testnet.stellar.org
SOROBAN_RPC_URL=https://soroban-testnet.stellar.org
NETWORK_PASSPHRASE=Test SDF Network ; September 2015
VESTING_CONTRACT_ID=CABC...XYZ

DATABASE_URL=postgres://vesting:vesting@localhost:5432/vesting
REDIS_URL=redis://localhost:6379

JWT_SECRET=dev-only-secret-at-least-32-characters-long
WEBHOOK_SECRET=dev-only-webhook-secret-16chars

LOG_LEVEL=debug
CORS_ALL_ORIGINS=true
```

```dotenv
# Frontend (frontend/.env)
VITE_API_URL=http://localhost:3001
VITE_NETWORK=testnet
VITE_CONTRACT_ID=CABC...XYZ
VITE_HORIZON_URL=https://horizon-testnet.stellar.org
```

### Local Quickstart (stellar quickstart container)

```dotenv
HORIZON_URL=http://localhost:8000
SOROBAN_RPC_URL=http://localhost:8000/soroban/rpc
NETWORK_PASSPHRASE=Standalone Network ; February 2017
VESTING_CONTRACT_ID=CABC...XYZ

DATABASE_URL=postgres://vesting:vesting@localhost:5432/vesting
REDIS_URL=redis://localhost:6379
JWT_SECRET=dev-only-secret-at-least-32-characters-long
WEBHOOK_SECRET=dev-only-webhook-secret-16chars
```

### Mainnet

```dotenv
HORIZON_URL=https://horizon.stellar.org
SOROBAN_RPC_URL=https://soroban.stellar.org
NETWORK_PASSPHRASE=Public Global Stellar Network ; September 2015
VESTING_CONTRACT_ID=CABC...XYZ
NODE_ENV=production
LOG_LEVEL=info
OTEL_SAMPLE_RATE=0.1
```

> 🔒 In production, `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`, `WEBHOOK_SECRET`, `ADMIN_API_KEY`, and `SPONSOR_SECRET_KEY` are always injected by ESO. Never put them in a static config file.

---

## Breaking Changes

### v0.3.0 — `CONTRACT_ID` renamed to `VESTING_CONTRACT_ID`

The backend environment variable for the contract address was renamed from `CONTRACT_ID` to `VESTING_CONTRACT_ID` to avoid conflicts with generic tooling (Terraform, GitHub Actions) that uses `CONTRACT_ID` for other purposes.

**Migration:** Update your `.env`, CI secrets, and Helm values:

```diff
-CONTRACT_ID=CABC...XYZ
+VESTING_CONTRACT_ID=CABC...XYZ
```

The old `CONTRACT_ID` variable is no longer read by the backend. Startup will fail with a Zod validation error if `VESTING_CONTRACT_ID` is missing.

---

## Startup Validation

The backend validates all required environment variables at startup via `backend/src/config.ts`. If any required variable is missing or invalid, the process exits with code 1 and a clear error message:

```
[config] Invalid environment configuration:
  • vestingContractId: Required
  • jwtSecret: String must contain at least 32 character(s)
  • redisUrl: Invalid url
```

This prevents silent misconfiguration in production. To test your `.env` locally:

```bash
cd backend
npm run dev
# Watch for [config] errors on startup
```

---

## Security Notes

The following variables are security-sensitive. They are marked 🔒 in the tables above.

| Variable | Risk | Guidance |
|---|---|---|
| `JWT_SECRET` | Token forgery if leaked | ≥ 32 random bytes. Rotate every 90 days or after any suspected leak. Old tokens are immediately invalid once the secret changes. |
| `ADMIN_API_KEY` | Unauthorized bulk-claim execution | Strong random value. Rotate periodically. Store in AWS Secrets Manager, never in git. |
| `SPONSOR_SECRET_KEY` | Full control of the signing account's funds | Stellar secret key. Restrict IAM permissions to the ECS task only. Rotate if the account is ever compromised. |
| `SIGNING_SECRET_KEY` | Transaction submission on behalf of users | Same rules as `SPONSOR_SECRET_KEY`. |
| `DATABASE_URL` | Full database access | Use a dedicated DB user with only the permissions the app needs. Never log. |
| `REDIS_URL` | Auth nonce and rate-limit bypass | Use Redis AUTH and TLS in production. Never log. |
| `WEBHOOK_SECRET` | Spoofed webhook events | ≥ 32 random bytes. Never expose to the browser. |

General rules:
- Never commit `.env` to version control (`.gitignore` already excludes it).
- Never log secret values — the config module is intentionally not logged.
- Rotate secrets after any team member departure or suspected exposure.
- See `infra/secrets/` for the full AWS Secrets Manager setup and rotation policy.
