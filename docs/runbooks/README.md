# Operations Runbooks

Operational procedures for the vesting-cliff-drip-stream production infrastructure.

## Infrastructure

| Runbook | When to use |
|---------|-------------|
| [Drift Reconciliation](./drift-reconciliation.md) | A daily drift-detection run has reported that live infrastructure diverges from Terraform configuration |
| [Emergency Override](./emergency-override.md) | You must make a manual infrastructure change immediately to mitigate an active incident |

## Database

| Runbook | When to use |
|---------|-------------|
| [RDS Restore](./rds-restore.md) | Restore the production database from a snapshot |
| [Disaster Recovery](./disaster-recovery.md) | Full system recovery — database, indexer re-sync, contract re-deploy |
| [Backfill Stream Events](./backfill-stream-events.md) | Replay Horizon events into `stream_events` after indexer downtime or a decoder bug fix |

## Observability

| Runbook | When to use |
|---------|-------------|
| [CloudWatch Logs](./cloudwatch-logs.md) | Query application logs, set up alarms, export log data |
| [Cost Monitoring](./cost-monitoring.md) | AWS cost anomaly alerts, budget notifications, and Slack relay |

---

## Alerting channels

| Channel | Purpose |
|---------|---------|
| `#ops` | Drift alerts, backup failures, non-critical infrastructure events |
| `#incidents` | Active production incidents |

Escalate to PagerDuty if no IC response within 15 minutes of an incident declaration.
