# Disaster Recovery Runbook

## RTO / RPO by Service

| Service | RTO | RPO | Definition |
|---------|-----|-----|------------|
| **PostgreSQL (RDS)** | 2 hours | < 1 minute (WAL-streaming replica failover) / 5 minutes (PITR) | Cross-AZ read replica streams WAL continuously; PITR replays archived WAL to a chosen recovery time within 35 days |
| **Redis cluster** | 30 minutes | 0 (cache only) | Ephemeral cache; rebuilds automatically from indexer on restart |
| **Backend API (ECS)** | 15 minutes | 0 | Stateless; redeploy from task definition |
| **Kubernetes workloads** | 15 minutes | 0 | Stateless; rollback via kubectl or Helm |
| **Event worker** | 30 minutes | 1 ledger gap | Resumes from last indexed ledger; backfill required |
| **Smart contract** | 1 hour | 0 | On-chain; immutable once deployed |
| **Secrets (AWS SM)** | 30 minutes | 0 | Rotation restores access; old secrets are invalidated |

**Primary targets:**

| Target | Value | How it is met |
|--------|-------|---------------|
| API availability RTO | **< 15 minutes** | Stateless ECS redeploy (Scenario 9) or rollback to the last stable task definition |
| Data-loss RPO | **< 1 minute** | Continuous WAL streaming to the cross-AZ read replica; promote the replica (Scenario 1, fast path) |

**Overall RTO:** 2 hours (worst case: database restore + full redeploy)
**Overall RPO:** < 1 minute with replica failover (Scenario 1 fast path); 5 minutes when replaying archived WAL via PITR; cross-region failover RPO is higher (snapshot replication) — see Scenario 11

---

## Scenario 1 — Database Restore

### Fast path — failover to the read replica (RTO < 15 min)

Use when the primary RDS instance is unavailable but the cross-AZ read replica is healthy. WAL streams to the replica continuously, so data loss is < 1 minute.

1. Confirm the primary is really down (not a network blip) and check replica health:
   ```bash
   aws rds describe-db-instances --db-instance-identifier $RDS_INSTANCE_ID \
     --query 'DBInstances[0].DBInstanceStatus'
   aws rds describe-db-instances --db-instance-identifier $RDS_REPLICA_ID \
     --query 'DBInstances[0].StatusInfos'   # includes replication lag
   ```
2. Promote the replica:
   ```bash
   aws rds promote-read-replica --db-instance-identifier $RDS_REPLICA_ID \
     --backup-retention-period 7
   aws rds wait db-instance-available --db-instance-identifier $RDS_REPLICA_ID
   ```
3. Point the application at the promoted instance: update `DATABASE_URL` in AWS Secrets Manager, then force an ECS redeploy (steps 4–5 of the snapshot procedure below).
4. Run the smoke test (step 6 below) and post the incident summary (step 8 below).
5. Follow-up (same day): provision a new read replica for the promoted primary — do not run production without one.

### Last resort — restore from snapshot

Full snapshot procedure is in [rds-restore.md](./rds-restore.md). DR-specific steps:

1. **Declare incident** in `#incidents` Slack channel; assign Incident Commander (IC).
2. Identify last healthy snapshot:
   ```bash
   aws rds describe-db-snapshots \
     --db-instance-identifier $RDS_INSTANCE_ID \
     --query 'DBSnapshots[?Status==`available`]|sort_by(@,&SnapshotCreateTime)[-1].DBSnapshotIdentifier' \
     --output text
   ```
3. Restore to a new instance (see rds-restore.md §Restore Procedure steps 2–3).
4. Update `DATABASE_URL` in AWS Secrets Manager:
   ```bash
   aws secretsmanager update-secret \
     --secret-id vesting/production/db-url \
     --secret-string "postgresql://$DB_USER:$DB_PASS@$NEW_ENDPOINT:5432/$DB_NAME"
   ```
5. Force ECS service redeploy to pick up the new secret:
   ```bash
   aws ecs update-service --cluster vesting-prod --service vesting-backend --force-new-deployment
   aws ecs wait services-stable --cluster vesting-prod --services vesting-backend
   ```
6. Run smoke test:
   ```bash
   curl -sf https://api.vesting.example.com/healthz
   ```
7. Delete old instance once traffic is confirmed healthy.
8. Post incident summary to `#incidents` within 24 h.

---

## Scenario 2 — Indexer Re-sync from Ledger X

Use when the indexer DB is corrupted or out of sync with the Stellar network.

**Manual cursor reset (no data wipe).** If the indexer is stalled but its tables are intact, reset the cursor instead of truncating:

1. Note the last successfully indexed ledger:
   ```bash
   psql "$DATABASE_URL" -c "SELECT MAX(ledger_sequence) FROM ledger_entries;"
   ```
2. Trigger a targeted reindex from that ledger via the admin API (no truncation):
   ```bash
   curl -X POST "https://admin.vesting.example.com/admin/indexer/reindex?from_ledger=$LAST_LEDGER" \
     -u "$ADMIN_USER:$ADMIN_PASS"
   ```
3. Watch `indexer_lag_seconds` return to < 60 s on Grafana. If it does not recover, proceed with the full re-sync below.

1. Stop the indexer task:
   ```bash
   TASK_ARN=$(aws ecs list-tasks --cluster vesting-prod --service-name vesting-indexer \
     --query 'taskArns[0]' --output text)
   aws ecs stop-task --cluster vesting-prod --task "$TASK_ARN"
   ```
2. Wipe indexer state in the DB:
   ```bash
   psql "$DATABASE_URL" -c "TRUNCATE ledger_entries, transactions, events RESTART IDENTITY;"
   ```
3. Determine the re-sync start ledger. Use the ledger at or just before the last known good state:
   ```bash
   # Query Horizon for a ledger ~24 h ago
   curl -s "https://horizon.stellar.org/ledgers?order=desc&limit=1" | jq '.._embedded.records[0].sequence'
   export START_LEDGER=<value>
   ```
4. Update the ECS task definition environment variable:
   ```bash
   # In your task definition JSON, set:
   # { "name": "START_LEDGER", "value": "$START_LEDGER" }
   aws ecs register-task-definition --cli-input-json file://task-def-indexer.json
   ```
5. Restart the indexer service:
   ```bash
   aws ecs update-service --cluster vesting-prod --service vesting-indexer \
     --task-definition vesting-indexer --force-new-deployment
   aws ecs wait services-stable --cluster vesting-prod --services vesting-indexer
   ```
6. Verify sync progress (check logs):
   ```bash
   aws logs tail /ecs/vesting-indexer --follow --since 5m
   ```
   Expect log lines: `Ingested ledger XXXXXX`. Wait until the current ledger is reached.
7. Confirm API returns fresh data:
   ```bash
   curl -sf "https://api.vesting.example.com/schedules?limit=1" | jq '.created_at'
   ```

---

## Scenario 3 — Contract Re-deploy After Network Reset

Use when the Stellar network is reset (testnet purge) or the contract must be redeployed from scratch.

1. Ensure Stellar CLI and funded key are available:
   ```bash
   stellar keys generate deployer --network testnet --fund
   stellar keys show deployer
   ```
2. Build and optimise the WASM:
   ```bash
   make build
   # Output: target/wasm32-unknown-unknown/release/vesting_cliff_drip_stream.wasm
   ```
3. Deploy the contract:
   ```bash
   CONTRACT_ID=$(stellar contract deploy \
     --wasm target/wasm32-unknown-unknown/release/vesting_cliff_drip_stream.wasm \
     --source deployer \
     --network testnet)
   echo "New contract: $CONTRACT_ID"
   ```
4. Update the contract ID in configuration:
   ```bash
   aws secretsmanager update-secret \
     --secret-id vesting/production/contract-id \
     --secret-string "$CONTRACT_ID"
   ```
5. Force redeploy to pick up the new contract ID:
   ```bash
   aws ecs update-service --cluster vesting-prod --service vesting-backend --force-new-deployment
   aws ecs wait services-stable --cluster vesting-prod --services vesting-backend
   ```
6. Run smoke test:
   ```bash
   ./scripts/smoke_test.sh
   ```
7. Re-create any vesting streams that were active before the reset (use the indexer DB as the source of truth, export stream parameters, and run `invoke_create.sh` for each).

---

## Scenario 4 — Redis Cluster Failure

Redis is used for caching (schedule queries) and rate limiting. A Redis failure degrades performance but does not break core functionality — the API falls back to direct database/RPC queries.

**Symptoms:** Cache hit rate drops to 0; increased API latency; rate limiting disabled.

1. **Assess Redis health:**
   ```bash
   # Check Redis from the backend container
   docker exec -it <backend-container> redis-cli -u $REDIS_URL ping
   # Expected: PONG

   # Or via ElastiCache (AWS)
   aws elasticache describe-cache-clusters \
     --cache-cluster-id vesting-prod-redis \
     --query 'CacheClusters[0].CacheClusterStatus'
   ```

2. **If Redis is down — check for auto-failover:**
   ```bash
   # ElastiCache Multi-AZ failover is automatic for cluster mode
   # Monitor until status changes from 'available' to 'modifying'
   aws elasticache describe-cache-clusters \
     --cache-cluster-id vesting-prod-redis
   ```

3. **If no auto-failover — manual restart:**
   ```bash
   # For self-managed Redis on ECS/k8s
   kubectl rollout restart deployment/redis -n vesting-prod
   # Or for Docker Compose
   docker compose restart redis
   ```

4. **Verify recovery:**
   ```bash
   redis-cli -u $REDIS_URL ping
   # PONG

   # Test API cache
   curl -sf https://api.vesting.example.com/api/v1/schedules/GTEST... \
     -H 'Authorization: Bearer $TOKEN' -w '\nX-Cache: %{header_json}'
   # Should show X-Cache: MISS (first request), then HIT
   ```

5. **Post-recovery:** No data loss — Redis is a read cache. The indexer repopulates cache entries as queries arrive.

---

## Scenario 5 — Kubernetes Deployment Rollback

Use when a bad deployment causes errors in the backend API, event worker, or frontend running on Kubernetes.

1. **Identify the failing deployment:**
   ```bash
   kubectl get deployments -n vesting-prod
   kubectl get pods -n vesting-prod --field-selector=status.phase!=Running
   ```

2. **Check recent rollout history:**
   ```bash
   kubectl rollout history deployment/vesting-backend-api -n vesting-prod
   kubectl rollout history deployment/vesting-event-worker -n vesting-prod
   ```

3. **Rollback to the previous revision:**
   ```bash
   kubectl rollout undo deployment/vesting-backend-api -n vesting-prod
   kubectl rollout undo deployment/vesting-event-worker -n vesting-prod
   ```

   Or rollback to a specific revision:
   ```bash
   kubectl rollout undo deployment/vesting-backend-api \
     --to-revision=<revision-number> -n vesting-prod
   ```

4. **Watch rollout progress:**
   ```bash
   kubectl rollout status deployment/vesting-backend-api -n vesting-prod --timeout=300s
   ```

5. **Verify health:**
   ```bash
   kubectl get pods -n vesting-prod -l app=vesting-backend-api
   curl -sf https://api.vesting.example.com/health
   ```

6. **If rollback fails — scale down and investigate:**
   ```bash
   kubectl scale deployment/vesting-backend-api --replicas=0 -n vesting-prod
   # Investigate pod logs
   kubectl logs -n vesting-prod -l app=vesting-backend-api --tail=100
   ```

---

## Scenario 6 — Event Worker Crash Recovery and Gap Backfill

The event worker polls Horizon for contract events and indexes them into PostgreSQL. If it crashes or is restarted, a gap in indexed ledgers may occur.

1. **Check event worker status:**
   ```bash
   kubectl get pods -n vesting-prod -l app=vesting-event-worker
   kubectl logs -n vesting-prod -l app=vesting-event-worker --tail=50
   ```

2. **Determine the gap:**
   ```bash
   # Check last indexed ledger in the database
   psql "$DATABASE_URL" -c \
     "SELECT MAX(ledger_sequence) AS last_indexed FROM stream_events;"

   # Check current chain tip
   curl -s 'https://horizon.stellar.org/ledgers?order=desc&limit=1' \
     | jq '.._embedded.records[0].sequence'
   ```

3. **Trigger gap backfill via admin API (if available):**
   ```bash
   curl -X POST "https://admin.vesting.example.com/admin/indexer/reindex?from_ledger=$LAST_INDEXED_LEDGER" \
     -u "$ADMIN_USER:$ADMIN_PASS"
   ```

4. **Or restart the worker (it will resume from last checkpoint):**
   ```bash
   kubectl rollout restart deployment/vesting-event-worker -n vesting-prod
   kubectl rollout status deployment/vesting-event-worker -n vesting-prod --timeout=300s
   ```

5. **Monitor catch-up progress:**
   ```bash
   kubectl logs -n vesting-prod -l app=vesting-event-worker --follow --since=5m
   # Expect: Ingested ledger XXXXXX
   ```

6. **Verify gap is closed:**
   ```bash
   psql "$DATABASE_URL" -c \
     "SELECT MAX(ledger_sequence) AS current_indexed FROM stream_events;"
   # Should match or be within 2-3 ledgers of chain tip
   ```

**Note:** A gap of up to 5 ledgers (~25 seconds) is normal during normal operation. Gaps > 50 ledgers (~4 minutes) indicate a crash that requires attention.

---

## Scenario 7 — Helm Release Rollback

Use when a Helm-managed deployment (backend, event worker, frontend) is broken and needs to be rolled back to a previous release.

1. **List Helm release history:**
   ```bash
   helm history vesting-backend -n vesting-prod
   ```

2. **Rollback to the previous revision:**
   ```bash
   helm rollback vesting-backend -n vesting-prod
   ```

   Or rollback to a specific revision:
   ```bash
   helm rollback vesting-backend <revision-number> -n vesting-prod
   ```

3. **Verify the rollback:**
   ```bash
   helm status vesting-backend -n vesting-prod
   kubectl get pods -n vesting-prod -l app.kubernetes.io/instance=vesting-backend
   curl -sf https://api.vesting.example.com/health
   ```

4. **Check values diff:**
   ```bash
   helm diff upgrade vesting-backend ./helm/vesting-backend \
     -n vesting-prod -f ./helm/vesting-backend/values-production.yaml
   ```

5. **If Helm rollback fails — fall back to kubectl:**
   ```bash
   kubectl rollout undo deployment/vesting-backend-api -n vesting-prod
   ```

---

## Scenario 8 — Secret Rotation During Incident

Use when secrets (database credentials, API keys, JWT signing keys) are compromised or must be rotated as part of incident response.

1. **Rotate the database password in RDS:**
   ```bash
   NEW_PASS=$(openssl rand -base64 32)
   aws rds modify-db-instance \
     --db-instance-identifier $RDS_INSTANCE_ID \
     --master-user-password "$NEW_PASS" \
     --apply-immediately
   ```

2. **Update the secret in AWS Secrets Manager:**
   ```bash
   DB_USER=$(aws secretsmanager get-secret-value \
     --secret-id vesting/production/db-url \
     --query 'SecretString' --output text | jq -r '.username // "vesting"')

   aws secretsmanager update-secret \
     --secret-id vesting/production/db-url \
     --secret-string "{\"host\":\"$DB_HOST\",\"port\":5432,\"username\":\"$DB_USER\",\"password\":\"$NEW_PASS\",\"database\":\"vesting\"}"
   ```

3. **Rotate JWT_SECRET:**
   ```bash
   NEW_JWT=$(openssl rand -base64 32)
   aws secretsmanager update-secret \
     --secret-id vesting/production/jwt-secret \
     --secret-string "$NEW_JWT"
   ```

   **Warning:** Rotating JWT_SECRET immediately invalidates all active sessions. Users will need to re-authenticate.

4. **Rotate ADMIN_API_KEY (if compromised):**
   ```bash
   NEW_ADMIN_KEY=$(openssl rand -hex 32)
   aws secretsmanager update-secret \
     --secret-id vesting/production/admin-api-key \
     --secret-string "$NEW_ADMIN_KEY"
   ```

5. **Force redeploy to pick up new secrets:**
   ```bash
   # ECS
   aws ecs update-service --cluster vesting-prod --service vesting-backend --force-new-deployment
   aws ecs wait services-stable --cluster vesting-prod --services vesting-backend

   # Kubernetes
   kubectl rollout restart deployment/vesting-backend-api -n vesting-prod
   ```

6. **Verify connectivity with new secrets:**
   ```bash
   curl -sf https://api.vesting.example.com/health
   curl -sf https://api.vesting.example.com/ready
   ```

7. **Rotate the Stellar deployer key (if compromised):**
   ```bash
   # Generate new keypair
   stellar keys generate deployer-v2 --network testnet
   # Fund it
   stellar keys fund deployer-v2 --network testnet
   # Transfer admin rights via contract call (requires old key)
   stellar contract invoke --id "$VESTING_CONTRACT" --source deployer --network testnet \
     -- transfer_admin --admin deployer --new_admin deployer-v2
   ```

---

## Scenario 9 — API Server Failure (All ECS Tasks Crashed)

Use when every `vesting-backend` task is stopped or crash-looping and the API is fully down.

1. Check the service state and recent events:
   ```bash
   aws ecs describe-services --cluster vesting-prod --services vesting-backend \
     --query 'services[0].{desired:desiredCount,running:runningCount,events:events[0:3]}'
   ```
2. Read the task logs for the crash cause (OOM kill, failed startup probe, bad secret):
   ```bash
   aws logs tail /ecs/vesting-backend --since 15m | tail -100
   ```
3. If tasks crash-loop on a bad task definition, roll back to the last stable revision:
   ```bash
   aws ecs update-service --cluster vesting-prod --service vesting-backend \
     --task-definition vesting-backend:<previous-revision> --force-new-deployment
   ```
4. If OOM-killed, bump CPU/memory in the task definition and redeploy.
5. If the service was simply scaled to zero, restore the desired count:
   ```bash
   aws ecs update-service --cluster vesting-prod --service vesting-backend --desired-count 2
   ```
6. Wait for stability and verify (target RTO < 15 minutes from first page):
   ```bash
   aws ecs wait services-stable --cluster vesting-prod --services vesting-backend
   curl -sf https://api.vesting.example.com/healthz
   ```

---

## Scenario 10 — Soroban RPC Unavailable (All RPC Nodes Offline)

Use when the primary RPC **and** the backup provider are both failing — contract reads/writes fail across the board. For a single-provider outage see the [alert-response playbook](./alert-response.md#4-rpc-node-unhealthy-p2).

1. Confirm scope — the RPC health call fails while DB checks pass:
   ```bash
   curl -sf "$SOROBAN_RPC_URL" -X POST -H 'Content-Type: application/json' \
     -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}'
   ```
2. Fail over to the public Stellar RPC as a temporary measure:
   ```bash
   aws secretsmanager update-secret \
     --secret-id vesting/production/rpc-url \
     --secret-string "https://soroban-testnet.stellar.org"   # mainnet: https://soroban.stellar.org
   aws ecs update-service --cluster vesting-prod --service vesting-backend --force-new-deployment
   ```
   The public node is rate-limited: expect degraded latency and do **not** run scheduled jobs or backfills against it.
3. Throttle non-critical RPC consumers: pause backfill / bulk-claim jobs via the admin API until a proper provider is restored.
4. Chase the provider incident (status page / support) and record timestamps and error payloads in the incident thread.
5. When a paid provider recovers, switch the secret back, redeploy, verify health, and resume the paused jobs.

---

## Scenario 11 — Complete AWS Region Failure (Multi-Region Failover)

Use when the primary AWS region is unavailable. Highest-RTO scenario: data is replicated cross-region by snapshot, not by live WAL.

1. Declare a region-level incident; the IC decides to fail over (this is a business decision, not an engineering one).
2. Restore the database in the secondary region — promote a cross-region replica if one exists, otherwise restore the latest replicated snapshot / PITR target:
   ```bash
   aws rds restore-db-instance-to-point-in-time \
     --source-db-instance-identifier $RDS_INSTANCE_ID \
     --db-instance-identifier vesting-prod-dr \
     --use-latest-restorable-time \
     --region us-west-2
   ```
3. Verify secrets exist in the secondary region (they must be replicated there in advance — Secrets Manager does not replicate automatically):
   ```bash
   aws secretsmanager list-secrets --region us-west-2
   ```
4. Register/run the ECS services in the secondary region (task definitions must already be registered there):
   ```bash
   aws ecs create-service --cluster vesting-prod --service vesting-backend \
     --task-definition vesting-backend --desired-count 2 --region us-west-2
   ```
5. Restart the indexer from the last indexed ledger — Scenario 2, manual cursor reset.
6. Point DNS at the secondary region (Route 53 failover record):
   ```bash
   aws route53 change-resource-record-sets --hosted-zone-id $ZONE_ID --change-batch file://failover.json
   ```
7. Run smoke tests and open the status page to "degraded / secondary region".

**Expected RPO:** snapshot replication interval (target < 15 min; a live cross-region replica reduces it to < 1 min at higher cost).
**Expected RTO:** 1–2 hours. **Failback:** once the primary region recovers, re-seed replicas from the secondary, switch DNS back, re-sync the indexer, then decommission the secondary deployment.

---

## Scenario 12 — Contract Compromise (Emergency Freeze / Upgrade)

Use when the contract, its admin key, or its deployer key is compromised, or a critical vulnerability is discovered. Detailed upgrade mechanics: [contract-upgrade.md](./contract-upgrade.md).

1. **Stop the bleeding first.** Page the contract lead + IC immediately (P1). This scenario overrides normal change control.
2. Freeze off-chain exposure: stop write-path services so users cannot submit transactions against the compromised contract:
   ```bash
   aws ecs update-service --cluster vesting-prod --service vesting-backend --desired-count 0
   aws ecs update-service --cluster vesting-prod --service vesting-indexer --desired-count 0
   ```
3. Rotate compromised Stellar keys (Scenario 8, step 7) and revoke the compromised key's authority wherever possible.
4. Assess exposure from the indexer DB: active streams, locked value per token, recent unexpected claims/cancellations.
5. Deploy a patched contract and run the upgrade/migration per [contract-upgrade.md](./contract-upgrade.md) — or use the token issuer's SAC admin powers (clawback / re-issue) if the asset allows it as a network-level freeze.
6. Migrate/re-create streams under the new contract, restore services, run smoke tests.
7. Publish an incident report within 72 h and notify affected sponsors/recipients with the migration plan.

---

## Tabletop Exercise Checklist

Run quarterly (or after any real incident). The runbook is only valid if it has been **tested in a DR drill** — record each drill (date, participants, gaps found) using the post-mortem template below.

| Step | Owner | Action |
|------|-------|--------|
| 1 | IC | Announce exercise in `#incidents`, confirm participants |
| 2 | On-call engineer | Walk through scenarios 1–12 verbally, narrate decisions |
| 3 | DB lead | Verify RDS snapshot exists and is restorable in staging |
| 4 | Backend lead | Confirm ECS task definitions are current |
| 5 | SRE | Verify Redis failover and k8s rollback procedures work |
| 6 | SRE | Confirm event worker backfill gap < 50 ledgers after restart |
| 7 | SRE | Test Helm rollback against staging environment |
| 8 | Security | Rotate a test secret and verify redeploy picks it up |
| 9 | Contract lead | Confirm deployer key is funded and WASM builds cleanly |
| 10 | IC | Time each scenario — confirm within per-service RTO budget |
| 11 | All | Note gaps → create follow-up tickets |
| 12 | SRE | Verify the Soroban RPC fallback switch works against the public node (Scenario 10) |
| 13 | Contract lead | Walk through the emergency freeze decision tree (Scenario 12) |

### Post-Mortem Template

```
Date:
Incident Commander:
Duration (detected → resolved):
Scenario triggered:

Timeline:
  HH:MM — <event>

Root cause:

Impact:

What went well:

What needs improvement:

Action items:
  [ ] Owner — Task — Due date
```

### Escalation contacts & on-call rotation

| Role | Responsibility | How to reach |
|------|----------------|--------------|
| Incident Commander (IC) | Runs the incident, owns all decisions | PagerDuty schedule `vesting-ic` |
| Primary on-call | First responder for every alert in [alert-response.md](./alert-response.md) | PagerDuty schedule `vesting-oncall` |
| Backend lead | API, ECS, indexer, RPC | `#incidents` / direct page |
| DB lead | RDS, failover, restores, pool exhaustion | `#incidents` / direct page |
| Contract lead | Contract freezes, upgrades, key rotation | `#incidents` / direct page |
| Security | Key compromise, vulnerability reports | [SECURITY.md](../../SECURITY.md) reporting channel |

Escalation rule: if no IC acknowledges a P1 page within **15 minutes**, escalate via PagerDuty to the secondary rotation (see [runbooks README](./README.md#alerting-channels)).

### Communications

- Primary channel: `#incidents` (Slack)
- Escalation: page on-call via PagerDuty if no IC response within 15 min
- Status page updates: every 30 min until resolved
