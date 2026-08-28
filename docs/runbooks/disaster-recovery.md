# Disaster Recovery Runbook

## RTO / RPO by Service

| Service | RTO | RPO | Definition |
|---------|-----|-----|------------|
| **PostgreSQL (RDS)** | 2 hours | 5 minutes | PITR replays WAL to a chosen recovery time within 35 days |
| **Redis cluster** | 30 minutes | 0 (cache only) | Ephemeral cache; rebuilds automatically from indexer on restart |
| **Backend API (ECS)** | 15 minutes | 0 | Stateless; redeploy from task definition |
| **Kubernetes workloads** | 15 minutes | 0 | Stateless; rollback via kubectl or Helm |
| **Event worker** | 30 minutes | 1 ledger gap | Resumes from last indexed ledger; backfill required |
| **Smart contract** | 1 hour | 0 | On-chain; immutable once deployed |
| **Secrets (AWS SM)** | 30 minutes | 0 | Rotation restores access; old secrets are invalidated |

**Overall RTO:** 2 hours (worst case: database restore + full redeploy)
**Overall RPO:** 5 minutes (database WAL replay window)

---

## Scenario 1 — Database Restore

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

## Tabletop Exercise Checklist

Run quarterly (or after any real incident).

| Step | Owner | Action |
|------|-------|--------|
| 1 | IC | Announce exercise in `#incidents`, confirm participants |
| 2 | On-call engineer | Walk through scenarios 1–8 verbally, narrate decisions |
| 3 | DB lead | Verify RDS snapshot exists and is restorable in staging |
| 4 | Backend lead | Confirm ECS task definitions are current |
| 5 | SRE | Verify Redis failover and k8s rollback procedures work |
| 6 | SRE | Confirm event worker backfill gap < 50 ledgers after restart |
| 7 | SRE | Test Helm rollback against staging environment |
| 8 | Security | Rotate a test secret and verify redeploy picks it up |
| 9 | Contract lead | Confirm deployer key is funded and WASM builds cleanly |
| 10 | IC | Time each scenario — confirm within per-service RTO budget |
| 11 | All | Note gaps → create follow-up tickets |

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

### Communications

- Primary channel: `#incidents` (Slack)
- Escalation: page on-call via PagerDuty if no IC response within 15 min
- Status page updates: every 30 min until resolved
