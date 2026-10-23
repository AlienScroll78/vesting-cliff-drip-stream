# Database Schema

PostgreSQL schema for persisting indexed on-chain data. Migrations are managed with [golang-migrate](https://github.com/golang-migrate/migrate) (or Flyway — both use the same `V{n}__description.sql` naming convention).

## Running Migrations

```bash
# Apply all pending migrations
migrate -path backend/migrations -database "$DATABASE_URL" up

# Roll back one migration
migrate -path backend/migrations -database "$DATABASE_URL" down 1
```

### Automatic at startup (Issue #1013)

The backend applies pending migrations automatically before the HTTP server
begins accepting traffic, so a deploy cannot serve requests against a stale
schema. This is wired into `src/server.ts` via `runMigrationsOrExit()`
(`src/migrate.ts`).

- **Ordering:** `runMigrationsOrExit()` is awaited before `httpServer.listen()`.
- **Concurrency:** migrations are guarded by a PostgreSQL advisory lock
  (`pg_try_advisory_lock`, lock id `7241865325823964`). In a multi-replica
  rollout, one replica applies migrations while the others detect the held lock,
  wait for a current schema, and continue booting.
- **Failure:** a migration that cannot be applied aborts startup with a
  non-zero exit code and a descriptive error, stopping a bad deploy from
  rolling forward.
- **Health:** `GET /health` and `GET /ready` report
  `db_migrations: "current" | "pending" | "failed"`.
- **Dry run:** set `MIGRATE_DRY_RUN=true` to log the migrations that would be
  applied without applying them. (`DB_MIGRATE_DRY_RUN` is a deprecated alias.)

```bash
# Preview pending migrations without applying them
MIGRATE_DRY_RUN=true npm run dev

# Equivalent one-off against the migration tool
npm run migrate:dry-run
```

#### Managed vs unmanaged migration tracks

The `migrations/` directory contains two conventions:

| Track | Example | Applied at startup? |
|-------|---------|---------------------|
| `node-pg-migrate` (`.ts`) | `001_create_vesting_streams.ts` | Yes — recorded in `pgmigrations` |
| `V{n}__*.sql` | `V1__create_schedules.sql` | No — reported as "unmanaged" in the startup log |

The `V*__*.sql` files are a separate track and are **not** applied on startup,
because running them against a schema where they are already applied can abort
the boot. They are listed in the startup log so drift stays visible.

## Seed (local development)

```bash
psql "$DATABASE_URL" -f backend/scripts/seed.sql
```

---

## Tables

### `schedules`

Stores every vesting schedule indexed from the smart contract.

| Column           | Type         | Notes                                          |
|------------------|--------------|------------------------------------------------|
| `id`             | BIGSERIAL PK |                                                |
| `recipient`      | TEXT UNIQUE  | Stellar address of the beneficiary             |
| `sponsor`        | TEXT         | Stellar address of the deposit payer           |
| `token`          | TEXT         | SAC token contract address                     |
| `rate_per_ledger`| NUMERIC      | Tokens released per ledger                     |
| `start_ledger`   | BIGINT       | Ledger when stream started                     |
| `cliff_ledger`   | BIGINT       | Ledger when cliff is reached                   |
| `end_ledger`     | BIGINT       | Ledger when stream ends                        |
| `total_deposit`  | NUMERIC      | `rate * (end_ledger - start_ledger)`           |
| `status`         | TEXT         | `active` \| `completed` \| `cancelled`        |
| `created_at`     | TIMESTAMPTZ  |                                                |
| `updated_at`     | TIMESTAMPTZ  |                                                |

Indexes: `sponsor`, `token`, `status`.

---

### `events`

Raw + decoded on-chain events emitted by the contract.

| Column       | Type         | Notes                                                        |
|--------------|--------------|--------------------------------------------------------------|
| `id`         | BIGSERIAL PK |                                                              |
| `ledger`     | BIGINT       | Ledger sequence where the event appeared                     |
| `tx_hash`    | TEXT         | Transaction hash                                             |
| `event_type` | TEXT         | `stream_created` \| `tokens_claimed` \| `stream_cancelled` \| `stream_completed` |
| `recipient`  | TEXT         | Beneficiary address                                          |
| `sponsor`    | TEXT         | Sponsor address (null for claim events)                      |
| `token`      | TEXT         | Token contract address                                       |
| `amount`     | NUMERIC      | Token amount (null where not applicable)                     |
| `raw_xdr`    | TEXT         | Base64-encoded raw XDR from Horizon                          |
| `created_at` | TIMESTAMPTZ  |                                                              |

Indexes: `recipient`, `ledger`, `event_type`, `tx_hash`.

---

### `claims`

Claim history — one row per successful `claim_vested` transaction.

| Column       | Type         | Notes                               |
|--------------|--------------|-------------------------------------|
| `id`         | BIGSERIAL PK |                                     |
| `recipient`  | TEXT         | FK → `schedules.recipient` (deferrable, set null on delete) |
| `token`      | TEXT         | Token contract address               |
| `amount`     | NUMERIC      | Tokens transferred in this claim    |
| `ledger`     | BIGINT       | Ledger at claim time                |
| `tx_hash`    | TEXT UNIQUE  | Transaction hash                    |
| `claimed_at` | TIMESTAMPTZ  |                                     |

Indexes: `recipient`, `token`.

---

## Migration Files

| File | Description |
|------|-------------|
| `V1__create_schedules.sql` | Creates the `schedules` table |
| `V2__create_events.sql`    | Creates the `events` table    |
| `V3__create_claims.sql`    | Creates the `claims` table    |

All migrations are idempotent when run via golang-migrate/Flyway (state tracked in `schema_migrations` / `flyway_schema_history`). To roll back, each `V{n}` migration has a corresponding down migration generated by `migrate create`.
