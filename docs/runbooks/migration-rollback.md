# Database Migration Rollback Runbook

Rollback procedures for the backend database migrations. Use this when a
forward migration introduces a schema change that must be reverted during
an incident.

## Prerequisites

- `DATABASE_URL` environment variable pointing to the target database.
- Access to the `backend/` directory with `node-pg-migrate` installed.
- For production: confirm the rollback is safe (no dependent data will be lost).

## Quick Reference

| Action | Command |
|--------|---------|
| Roll back the last migration | `npm run migrate:down` |
| Roll back multiple migrations | `npm run migrate:down -- --count 3` |
| Roll back all migrations | `npm run migrate:down:all` |
| Re-apply all migrations | `npm run migrate` |
| Check migration status | `npx node-pg-migrate status` |

## Rollback Procedure

### 1. Assess Impact

Before rolling back, confirm:

- The migration being rolled back has no dependent data in production.
- The rollback does not break the running application.
- If unsure, take a database snapshot first (see [RDS Restore](./rds-restore.md)).

```bash
# Check which migrations are currently applied
npx node-pg-migrate status --migration-file-language ts
```

### 2. Roll Back

```bash
# From the backend/ directory
export DATABASE_URL="postgresql://user:pass@host:5432/vesting_prod"

# Roll back the most recent migration (rolls back 004 → 003)
npm run migrate:down

# Roll back multiple migrations (e.g., 004 → 003 → 002)
npm run migrate:down -- --count 3
```

Rollback steps are logged to stdout. Each line indicates which migration
was reversed.

### 3. Verify

After rollback, verify the schema matches the expected state:

```bash
# Check migration status — rolled-back migrations should show as "down"
npx node-pg-migrate status --migration-file-language ts

# Optionally query the pgmigrations table directly
psql "$DATABASE_URL" -c "SELECT name, run_on FROM pgmigrations ORDER BY run_on DESC LIMIT 5;"
```

### 4. Re-Apply (If Needed)

If the issue is resolved and you need to re-apply:

```bash
npm run migrate
```

## Migration Down Functions

All migrations export both `up` and `down` functions:

| Migration | `down` Reverts |
|-----------|---------------|
| 001 | Drops `vesting_streams` table |
| 002 | Drops `claim_events` table |
| 003 | Removes `cancelled_at`, `refunded_amount`, `cancellation_tx_hash` columns |
| 004 | Drops `stream_events`, `stream_events_dlq`, `horizon_worker_cursor` tables; drops `stream_event_type` enum |

## Automated Testing

Rollback is tested in CI via `backend/tests/migrations/rollback.test.ts`:

- **Full rollback**: all migrations rolled back, tables verified absent
- **Step-by-step rollback**: 004 → 003 → 002 → 001 with per-step schema verification
- **Re-apply after rollback**: all migrations re-applied, schema verified correct
- **Rollback logging**: confirms rollback steps execute and migration count decreases

Run the rollback tests locally:

```bash
cd backend
TEST_DATABASE_URL="postgresql://postgres:postgres@localhost:5432/vesting_test" \
  node --test --import tsx tests/migrations/rollback.test.ts
```

## Scripts Reference

| Script | Description |
|--------|-------------|
| `npm run migrate` | Apply all pending forward migrations |
| `npm run migrate:down` | Roll back the last applied migration |
| `npm run migrate:down:all` | Roll back all applied migrations |

## Emergency: Full Database Reset

If a rollback is insufficient and a clean slate is needed:

```bash
# WARNING: This destroys all data. Use only as a last resort.
npm run migrate:down:all
npm run migrate
```

**Always** take a snapshot before a full reset in production.

## Incident Checklist

- [ ] Incident declared and IC assigned
- [ ] Database snapshot taken (if time permits)
- [ ] Migration to roll back identified
- [ ] Rollback executed: `npm run migrate:down`
- [ ] Schema verified (pgmigrations + manual inspection)
- [ ] Application tested against rolled-back schema
- [ ] Incident channel updated with rollback details
- [ ] Post-incident: re-apply migration or file fix
