# Alert Response Playbook — Grafana / CloudWatch

Procedure for responding to production alerts fired by Grafana and CloudWatch. This runbook is linked from the Grafana alert annotations — open the alert's annotation link to jump straight to the relevant section.

> **First 5 minutes (any alert):**
> 1. Acknowledge the page so the rotation knows someone is on it.
> 2. Declare status in `#incidents` (P1) or `#ops` (P2): *"Acknowledged `<alert name>`, investigating."*
> 3. Check the Grafana dashboard for the affected panel to confirm the alert is not a false positive.
> 4. Work the matching section below. Escalate per [Escalation criteria](#escalation-criteria) — do not sit on a P1.

## Alert index

| Alert | Severity | Fires when | Section |
|-------|----------|------------|---------|
| `indexer_lag_seconds` | P2 | `indexer_lag_seconds > 60` | [1. Indexer lag](#1-indexer-lag-seconds--60-p2) |
| `http_error_rate` | P1 | 5xx rate `> 5%` over 5 min | [2. HTTP error rate](#2-http-error-rate--5-p1) |
| `db_pool_exhausted` | P1 | No free pool connections for 2 min | [3. DB pool exhausted](#3-db-pool-exhausted-p1) |
| `rpc_node_unhealthy` | P2 | RPC health probe failing | [4. RPC node unhealthy](#4-rpc-node-unhealthy-p2) |
| `wasm_upload_failed` | P1 | Deploy pipeline WASM upload error | [5. WASM upload failed](#5-wasm-upload-failed-p1) |

---

## 1. `indexer_lag_seconds` > 60 — P2

The indexer is more than 60 seconds behind the chain tip. Stream data shown to users is stale.

### Diagnosis

1. Confirm lag and trend on the Grafana **Indexer** panel:
   ```bash
   curl -sf https://api.vesting.example.com/metrics/indexer | grep indexer_lag
   ```
2. Check indexer logs for crash loops, Horizon errors, or stalls:
   ```bash
   aws logs tail /ecs/vesting-indexer --since 15m --filter-pattern ERROR
   ```
3. Check Horizon connectivity from the indexer's network context:
   ```bash
   curl -sf "$HORIZON_URL/ledgers?order=desc&limit=1" | jq '._embedded.records[0].sequence'
   ```

### Remediation

1. If the task crashed or is restart-looping, restart it:
   ```bash
   aws ecs update-service --cluster vesting-prod --service vesting-indexer --force-new-deployment
   aws ecs wait services-stable --cluster vesting-prod --services vesting-indexer
   ```
2. If Horizon is degraded, the indexer usually recovers on its own once Horizon responds — keep watching the lag panel instead of restarting repeatedly.
3. If lag keeps growing past several minutes with no errors, follow Scenario 2 (Indexer Re-sync) in [disaster-recovery.md](./disaster-recovery.md).

### Escalation

Escalate to P1 and page the backend lead if lag exceeds **10 minutes** or the indexer keeps crash-looping after a restart.

---

## 2. `http_error_rate` > 5% — P1

API 5xx rate exceeds 5% of requests over a 5-minute window. Users are actively failing.

### Diagnosis

1. Identify which endpoints and status codes are erroring:
   ```bash
   aws logs tail /ecs/vesting-backend --since 10m \
     --filter-pattern "ERROR" | head -100
   ```
2. Correlate with recent deployments — a post-deploy regression is the most common cause:
   ```bash
   aws ecs describe-services --cluster vesting-prod --services vesting-backend \
     --query 'services[0].deployments'
   ```
3. Check dependencies on the health endpoint (DB, Redis, RPC, Horizon):
   ```bash
   curl -s https://api.vesting.example.com/health | jq .
   ```

### Remediation

1. **If the errors started right after a deploy — roll back first, investigate later:**
   ```bash
   aws ecs update-service --cluster vesting-prod --service vesting-backend \
     --task-definition vesting-backend:<previous-revision> --force-new-deployment
   ```
   On Kubernetes-managed services use `kubectl rollout undo` instead (see Scenario 5 in [disaster-recovery.md](./disaster-recovery.md)).
2. **If a dependency is unhealthy** (health endpoint shows DB/RPC/Horizon down), switch to the matching playbook section above/below, or to the relevant scenario in [disaster-recovery.md](./disaster-recovery.md).
3. **If errors come from a single endpoint** and there is no bad deploy, capture example failing request IDs and open a backend incident thread; consider temporarily disabling the offending feature behind a feature flag if one exists.

### Escalation

Escalate to the backend lead if the error rate stays above 5% for **15 minutes** despite rollback, or if any write path (create stream / claim) is affected. Declaring a customer-facing incident and updating the status page is required at this point.

---

## 3. `db_pool_exhausted` — P1

The backend cannot obtain a PostgreSQL connection from the pool (`DB_POOL_MAX` exceeded). Requests will queue and time out.

### Diagnosis

1. Look for slow or long-running queries holding connections:
   ```bash
   psql "$DATABASE_URL" -c "SELECT pid, now() - query_start AS duration, state, left(query, 120)
     FROM pg_stat_activity
     WHERE state != 'idle' AND now() - query_start > interval '30 seconds'
     ORDER BY duration DESC;"
   ```
2. Check pool wait/connection metrics on the Grafana **Database** panel.
3. Confirm whether a deploy or job (bulk claim, backfill) recently started — those can hold many connections.

### Remediation

1. **Kill long-running queries** (grab `pid` from the diagnosis query above):
   ```bash
   psql "$DATABASE_URL" -c "SELECT pg_terminate_backend(<pid>);"
   ```
   Only kill clearly-stuck queries; never terminate a migration mid-run.
2. **Scale out the API** to spread load across more pool capacity:
   ```bash
   aws ecs update-service --cluster vesting-prod --service vesting-backend --desired-count <N+1>
   ```
   Confirm `DB_POOL_MAX × task count` stays within the RDS `max_connections` headroom before scaling up.
3. If the pool is exhausted by a runaway job, stop the offending scheduled job via the admin API and restart the backend tasks:
   ```bash
   aws ecs update-service --cluster vesting-prod --service vesting-backend --force-new-deployment
   ```

### Escalation

Page the DB lead if pool exhaustion recurs within one hour, if `pg_stat_activity` shows lock contention you cannot attribute, or if a failover of RDS looks necessary (then follow Scenario 1 in [disaster-recovery.md](./disaster-recovery.md)).

---

## 4. `rpc_node_unhealthy` — P2

The Soroban RPC endpoint the backend depends on is failing health checks.

### Diagnosis

1. Probe the configured RPC endpoint:
   ```bash
   curl -sf "$SOROBAN_RPC_URL" -X POST -H 'Content-Type: application/json' \
     -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}' | jq .
   ```
2. Check backend logs for RPC timeouts/errors:
   ```bash
   aws logs tail /ecs/vesting-backend --since 10m --filter-pattern "RPC"
   ```
3. Determine scope: contract reads/writes failing, while `/health` DB checks pass → RPC-side issue.

### Remediation

1. **Switch to the backup RPC URL.** Update the secret/config and redeploy the backend so it picks up the new value:
   ```bash
   aws secretsmanager update-secret \
     --secret-id vesting/production/rpc-url \
     --secret-string "https://<backup-rpc-provider>/rpc"
   aws ecs update-service --cluster vesting-prod --service vesting-backend --force-new-deployment
   aws ecs wait services-stable --cluster vesting-prod --services vesting-backend
   ```
   Public fallback (testnet): `https://soroban-testnet.stellar.org` — use only as a last resort; it is rate-limited and not for sustained production traffic.
2. Verify health and transaction submission after the switch:
   ```bash
   curl -sf https://api.vesting.example.com/health | jq .
   ```

### Escalation

Page the Stellar team / infrastructure lead if the primary RPC provider stays down for more than **30 minutes**, if the backup provider also fails, or if sustained traffic would exceed the fallback's rate limits. File a ticket with the RPC provider with timestamps and error payloads from the logs.

---

## 5. `wasm_upload_failed` — P1

The deploy pipeline failed to upload/build the contract WASM artifact. A broken artifact means deploys cannot proceed and the released WASM may be stale or corrupt.

### Diagnosis

1. Open the failing CI run and locate the failing step (build, optimise, or upload).
2. Verify the built WASM exists and its checksum matches what the pipeline expects:
   ```bash
   make build
   sha256sum target/wasm32-unknown-unknown/release/vesting_cliff_drip_stream.wasm
   # Compare against the checksum published by the release workflow / release-please notes
   ```
3. Check whether the failure is transient (network, registry 5xx, rate limit) in the run logs.

### Remediation

1. **Transient error** → re-run the failed job once. Do not retry blindly more than once.
2. **Checksum mismatch** → build locally from the release tag, compare checksums, and never upload an artifact you cannot verify. If the source tag builds clean, re-run the pipeline from the tag.
3. **Persistent pipeline failure** → deploy manually following Scenario 3 (Contract Re-deploy) in [disaster-recovery.md](./disaster-recovery.md), and record the manual artifact checksum in the incident thread.

### Escalation

Escalate to the contract team if the checksum cannot be reproduced from the release tag, if the WASM builds but fails on-chain, or if two consecutive pipeline runs fail for the same non-transient reason.

---

## Escalation criteria

| Condition | Action |
|-----------|--------|
| P1 unresolved after 15 min of hands-on work | Page secondary on-call (PagerDuty) |
| P1 affects the write path (deposits, claims) or funds | Page backend lead immediately; declare customer-facing incident |
| P2 unresolved after 30 min, or worsens | Upgrade to P1 and follow the P1 escalation path |
| Suspected security issue | Follow [SECURITY.md](../../SECURITY.md) — do not discuss details in public channels |
| Data loss suspected | Page DB lead + IC; freeze deploys; follow [disaster-recovery.md](./disaster-recovery.md) |

## Alert annotations

Every Grafana alert that routes to this playbook must carry a runbook annotation:

```text
Runbook: https://github.com/Nikola-Tee/vesting-cliff-drip-stream/blob/main/docs/runbooks/alert-response.md#<anchor>
```

| Alert | Annotation anchor |
|-------|-------------------|
| `indexer_lag_seconds` | `#1-indexer-lag-seconds--60-p2` |
| `http_error_rate` | `#2-http-error-rate--5-p1` |
| `db_pool_exhausted` | `#3-db-pool-exhausted-p1` |
| `rpc_node_unhealthy` | `#4-rpc-node-unhealthy-p2` |
| `wasm_upload_failed` | `#5-wasm-upload-failed-p1` |

When adding a new alert, add its section here **before** enabling the alert, and include the annotation link in the alert definition.

## Review checklist for the on-call rotation

- [ ] Each on-call member has walked through all five sections at least once
- [ ] Backup RPC URL is current and reachable from the backend VPC
- [ ] `ADMIN_USER` / `ADMIN_PASS` and psql access are available to on-call via the secrets store
- [ ] Escalation contacts in [runbooks README](./README.md) are up to date

*Last updated: 2026-09-26.*
