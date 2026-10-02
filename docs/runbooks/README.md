# Operations Runbooks

Operational procedures for the vesting-cliff-drip-stream production infrastructure.

## Contract

| Runbook | When to use |
|---------|-------------|
| [Contract Upgrade](./contract-upgrade.md) | Upgrade the on-chain Soroban contract to a new WASM binary |
| [Schema Migration](./schema-migration.md) | Migrate on-chain `VestingSchedule` records after a struct field addition |
| [Contract Upgrade](./contract-upgrade.md) | Upgrade the on-chain Soroban contract to a new WASM binary (planned release) |
| [Emergency Contract Upgrade](./emergency-contract-upgrade.md) | Accelerated upgrade path during an active security incident or critical regression |

## Infrastructure

| Runbook | When to use |
|---------|-------------|
| [Terraform Bootstrap](./terraform-bootstrap.md) | First-time remote state setup per environment, backend migration, stale state locks, state recovery, or MFA delete verification |
| [Drift Reconciliation](./drift-reconciliation.md) | A daily drift-detection run has reported that live infrastructure diverges from Terraform configuration |
| [Emergency Override](./emergency-override.md) | You must make a manual infrastructure change immediately to mitigate an active incident |
| [Secrets Management](./secrets-management.md) | Rotate a secret manually, investigate a rotation failure, or audit who read a secret |

## Database

| Runbook | When to use |
|---------|-------------|
| [RDS Restore](./rds-restore.md) | Restore the production database from a snapshot |
| [Backup Restore Verification](./backup-restore-verification.md) | The weekly restore check failed, or you want to test a restore on demand without touching production |
| [Disaster Recovery](./disaster-recovery.md) | Full system recovery — database, indexer re-sync, contract re-deploy |
| [Backfill Stream Events](./backfill-stream-events.md) | Replay Horizon events into `stream_events` after indexer downtime or a decoder bug fix |

## Observability

| Runbook | When to use |
|---------|-------------|
| [CloudWatch Logs](./cloudwatch-logs.md) | Query application logs, set up alarms, export log data |
| [Alert Response](./alert-response.md) | A Grafana/CloudWatch alert has fired (indexer lag, error rate, DB pool, RPC, WASM deploy) |
| [Cost Monitoring](./cost-monitoring.md) | AWS cost anomaly alerts, budget notifications, and Slack relay |

---

## Alerting channels

| Channel | Purpose |
|---------|---------|
| `#ops` | Drift alerts, backup failures, non-critical infrastructure events |
| `#incidents` | Active production incidents |

Escalate to PagerDuty if no IC response within 15 minutes of an incident declaration.
