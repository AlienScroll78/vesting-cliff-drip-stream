# Disaster Recovery Runbook

## RTO / RPO

| Target | Value | Definition |
|--------|-------|------------|
| **RTO** | 2 hours | Maximum time from incident declaration to service restored |
| **RPO** | 24 hours | Maximum acceptable data loss (one daily backup cycle) |

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

## Tabletop Exercise Checklist

Run quarterly (or after any real incident).

| Step | Owner | Action |
|------|-------|--------|
| 1 | IC | Announce exercise in `#incidents`, confirm participants |
| 2 | On-call engineer | Walk through each scenario above verbally, narrate decisions |
| 3 | DB lead | Verify RDS snapshot exists and is restorable in staging |
| 4 | Backend lead | Confirm ECS task definitions are current |
| 5 | Contract lead | Confirm deployer key is funded and WASM builds cleanly |
| 6 | IC | Time each scenario — confirm within RTO budget |
| 7 | All | Note gaps → create follow-up tickets |

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
