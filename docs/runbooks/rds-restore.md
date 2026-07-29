# RDS Restore Runbook

## Overview

This runbook covers restoring the PostgreSQL RDS instance from an automated or manual snapshot.

## Automated Backups

RDS automated backups are enabled with **35-day retention**. Amazon RDS
continuously archives PostgreSQL write-ahead logs (WAL) alongside automated
backups, enabling point-in-time recovery (PITR) to any restorable time in that
window. Storage, snapshots, backups, and WAL are encrypted with the
environment PostgreSQL KMS key; snapshot tags are copied for cost allocation.

To verify automated backups are enabled:
```bash
aws rds describe-db-instances \
  --db-instance-identifier $RDS_INSTANCE_ID \
  --query 'DBInstances[0].{BackupRetentionPeriod:BackupRetentionPeriod,PreferredBackupWindow:PreferredBackupWindow}'
```

## Manual Snapshots

Manual snapshots are triggered via the [RDS Backup workflow](../../.github/workflows/rds-backup.yml):

- **Scheduled**: runs daily at 02:00 UTC automatically.
- **On-demand**: go to Actions → RDS Backup → Run workflow.

List available snapshots:
```bash
aws rds describe-db-snapshots \
  --db-instance-identifier $RDS_INSTANCE_ID \
  --query 'DBSnapshots[*].{ID:DBSnapshotIdentifier,Created:SnapshotCreateTime,Status:Status}' \
  --output table
```

## Restore Procedure

### Point-in-time restore (preferred for data corruption)

Choose the latest safe UTC timestamp inside the 35-day recovery window and
restore to a new instance. RDS replays archived WAL up to this time.

```bash
aws rds restore-db-instance-to-point-in-time \
  --source-db-instance-identifier "$RDS_INSTANCE_ID" \
  --target-db-instance-identifier vesting-restored \
  --restore-time '2026-01-01T01:55:00Z' \
  --db-instance-class db.t3.micro
aws rds wait db-instance-available --db-instance-identifier vesting-restored
```

Then complete the data-integrity and promotion steps below. Do not restore over
the source instance: keeping it intact preserves additional recovery options.

### 1. Identify the snapshot

```bash
SNAPSHOT_ID="vesting-20260101-0200-scheduled"   # replace with target snapshot
```

### 2. Restore to a new instance

```bash
aws rds restore-db-instance-from-db-snapshot \
  --db-instance-identifier vesting-restored \
  --db-snapshot-identifier $SNAPSHOT_ID \
  --db-instance-class db.t3.medium \
  --no-multi-az

aws rds wait db-instance-available \
  --db-instance-identifier vesting-restored
```

### 3. Verify data integrity

```bash
# Get restored instance endpoint
ENDPOINT=$(aws rds describe-db-instances \
  --db-instance-identifier vesting-restored \
  --query 'DBInstances[0].Endpoint.Address' --output text)

# Connect and run sanity check
psql "postgresql://$DB_USER:$DB_PASS@$ENDPOINT:5432/$DB_NAME" \
  -c 'SELECT count(*) FROM vesting_schedules;'
```

### 4. Promote restored instance (if replacing production)

1. Update `DATABASE_URL` secret in GitHub and SSM/Secrets Manager.
2. Redeploy the application (trigger the staging or production workflow).
3. Delete the old instance once traffic is confirmed healthy:

```bash
aws rds delete-db-instance \
  --db-instance-identifier vesting-production-old \
  --skip-final-snapshot
```

## Staging Restore Test

Run this procedure monthly against staging to validate recoverability:

1. Trigger the RDS Backup workflow manually with suffix `staging-test`.
2. Follow steps 2–3 above targeting the `vesting-staging` instance.
3. Record results and confirm row counts match pre-snapshot counts.
4. Tear down the restored instance.

## Alert Response

If a **backup failure** Slack alert fires:

1. Open the failed Actions run linked in the alert.
2. Check the `Create snapshot` step for AWS API errors.
3. Verify `RDS_INSTANCE_ID` and `AWS_BACKUP_ROLE_ARN` secrets are set correctly.
4. Re-run the workflow once the issue is resolved.

RDS backup and failure events also publish to the Terraform-managed
`<environment>-vesting-rds-backup-failure` SNS topic. Confirm subscription
emails and investigate its event message, RDS events, KMS key access, backup
retention, and free storage before retrying.
