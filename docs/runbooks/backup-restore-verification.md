# RDS Backup Restore Verification

Weekly proof that the automated backups actually restore.

## Why this exists

RDS automated backups are only useful if they can be restored. The failure mode
this guards against is quiet and expensive: retention looks correct, the
`backup_failure` event subscription reports nothing, and the first person to
find out the backups do not restore is the day they are needed. A backup that
has never been restored is a hypothesis.

Every Sunday at 03:00 UTC the `backup-verify` function restores the most recent
automated snapshot into a throwaway `db.t3.micro`, counts the rows in the
application tables, publishes a verdict, and deletes the instance again.

```
                    cron(0 3 ? * SUN *)
                            |
                            v
  DescribeDBSnapshots  ──> pick newest automated, status=available
                            |
                            v
  RestoreDBInstanceFromDBSnapshot  ──> vesting-restore-test-<timestamp>
                            |             tag RestoreTest=true
                            |             backup retention 0, not public
                            v
  wait for `available`  ──> connect over TLS, SCRAM-SHA-256
                            |
                            v
  SELECT count(*) FROM schedules / events / claims / indexer_cursor
                            |
              +-------------+-------------+
              |                           |
              v                           v
   PutMetricData BackupRestoreSuccess    DeleteDBInstance
        1 or 0                          SkipFinalSnapshot
              |                           wait for gone
              v
   CloudWatch alarm ──> SNS ──> PagerDuty
```

## How a verdict becomes a page

The metric is `VestingApp/BackupRestoreSuccess`, one data point per week, with
an `Environment` dimension. The alarm is deliberately strict:

| Setting | Value | Why |
|---|---|---|
| `statistic` | `Minimum` | One failed restore in the week must alarm. `Sum` or `Average` would let six good weeks bury it. |
| `period` | `604800` | Matches the publish interval, so each window holds one verdict. |
| `evaluation_periods` | `1` | A restore failure is already its own evidence. |
| `threshold` / operator | `1` / `LessThanThreshold` | Anything below a full pass is a failure. |
| `treat_missing_data` | `breaching` | A week with **no** verdict means the schedule did not run. Silence is the failure this issue exists to catch. |

Both `alarm_actions` and `ok_actions` go to the SNS topic, so a recovery is
visible too and a flapping restore cannot go unnoticed.

## The 900-second problem

Lambda caps an invocation at 900 seconds. A restore of a small instance
typically completes in a few minutes, but a slow one plus verification can
exceed the limit, and when the function is killed its `finally` block never
runs — the instance would be left behind, billing until someone noticed.

Two things keep that bounded:

1. **Reserved concurrency is 1.** A verify and a cleanup can never overlap, so
   the cleanup can never delete the instance of a verify that is still running.
2. **A separate cleanup schedule runs every 30 minutes** and deletes any
   instance carrying `RestoreTest=true` whose identifier starts with
   `vesting-restore-test-`. That is the recovery path for a killed run.

Worst case is 15 minutes of verify plus one cleanup interval, comfortably inside
the 60 minute budget. If you see a restore-test instance older than an hour,
something is wrong with the cleanup schedule — check
`${env}-vesting-backup-verify-cleanup` first.

Cleanup deletes only when **both** conditions hold: the identifier prefix
matches *and* `RestoreTest=true`. Either check alone would be a foot-gun aimed
at the production instance.

## Running one by hand

The schedule is weekly; do not wait for it when changing the schema, the
instance class, or the networking.

```bash
ENV=staging

aws lambda invoke \
  --function-name "$ENV-vesting-backup-verify" \
  --payload '{}' \
  --cli-binary-format raw-in-base64-out \
  /dev/stdout | jq

# Cleanup only, exactly what the 30 minute schedule does:
aws lambda invoke \
  --function-name "$ENV-vesting-backup-verify" \
  --payload '{"action":"cleanup"}' \
  --cli-binary-format raw-in-base64-out \
  /dev/stdout | jq
```

A restore usually takes several minutes, so the invoke call blocks. Watch it
live instead:

```bash
aws logs tail "/aws/lambda/$ENV-vesting-backup-verify" --follow --since 10m
```

The lines that matter:

```json
{"level":"info","msg":"selected snapshot","snapshot":"staging-vesting-db:2026-09-21-02-03","candidates":1}
{"level":"info","msg":"restoring snapshot","instance":"vesting-restore-test-20260921030012","dbClass":"db.t3.micro"}
{"level":"info","msg":"restore verification passed","rowCounts":{"schedules":7,"events":42,"claims":128,"indexer_cursor":1}}
{"level":"info","msg":"deleted temporary instance","instance":"vesting-restore-test-20260921030012"}
```

`restore verification finished` is the last line of every run and carries `ok`,
`durationMs` and `rowCounts`. If it is missing, the function was killed at the
900 second limit and the cleanup schedule is what removes the instance.

Anything at `level: error` with `msg: "backup verification failed"` carries the
reason in the `error` field. `restoreInstance` is set on the thrown error, so
the invocation's error message names the instance if cleanup itself failed.

## What counts as a pass

Not just "the socket opened". The restored copy must answer `count(*)` for
`schedules`, `events`, `claims` and `indexer_cursor`. Zero rows is a pass — a
fresh database legitimately has none — because the point is that the schema is
present and the data is queryable, which is exactly what a broken snapshot or a
mismatched `search_path` would break.

Table names come from `EXPECTED_TABLES` and are validated against
`^[a-z_][a-z0-9_]*$` before being interpolated, so a configuration mistake is
reported rather than executed.

## Confirming the alarm path end to end

```bash
# 1. Publish a failure by hand and wait for the next evaluation window, or
#    invoke the function with the database password unset to force a failure.
# 2. Force the alarm to evaluate without waiting a week:
aws cloudwatch set-alarm-state \
  --alarm-name "$ENV-backup-restore-failed" \
  --state-value ALARM \
  --state-reason "manual test"

# 3. Confirm SNS -> PagerDuty by publishing directly:
aws sns publish \
  --topic-arn "$(terraform output -raw backup_verify_alert_topic_arn)" \
  --subject "backup restore verification failed (test)" \
  --message "manual test from the runbook"
```

Confirm the metric is landing at all before trusting an absence of pages:

```bash
aws cloudwatch get-metric-statistics \
  --namespace VestingApp \
  --metric-name BackupRestoreSuccess \
  --dimensions Name=Environment,Value="$ENV" \
  --start-time "$(date -u -d '10 days ago' +%FT%TZ)" \
  --end-time "$(date -u +%FT%TZ)" \
  --period 604800 \
  --statistics Minimum
```

## Cost

One `db.t3.micro` for roughly 5–10 minutes a week, plus the 30 minute cleanup
invocation. Well under a dollar a month. The temporary instance is created with
`backup_retention_period = 0` so it does not generate automated backups of its
own, and it is tagged `RestoreTest=true` so it is easy to find:

```bash
aws rds describe-db-instances \
  --filters "Name=tag:RestoreTest,Values=true" \
  --query 'DBInstances[].{id:DBInstanceIdentifier,status:DBInstanceStatus}'
```

That query returning anything is itself a finding: it means an instance outlived
its run.

## Failure modes

| Symptom | Likely cause | What to do |
|---|---|---|
| `no available automated snapshot found` | Automated backups disabled, or the retention window has emptied | Check `backup_retention_period` on the instance. A 0 there is the cause. |
| `server refused TLS` | `rds.force_ssl` should prevent this; if it appears, the endpoint is not RDS | Confirm `SOURCE_DB_INSTANCE_ID` points at the real instance. |
| `FATAL (28P01)` or `password authentication failed` | `DB_PASSWORD` has drifted from the instance | #838 rotates this in Secrets Manager; until it lands, the value comes from `var.db_password`. |
| Timed out waiting to become available | Restore slower than 600s | Check the instance class. A larger `db.t3.*` takes longer to restore than a micro. |
| Restore-test instance still present after an hour | The cleanup schedule is not firing | Check the `cleanup` schedule and the reserved concurrency. |
| Alarm OK but restores are visibly failing | The metric never published | Look for `could not publish result metric` in the log group. |
| Count query fails with `relation does not exist` | A table in `EXPECTED_TABLES` is not in the snapshot | That is the check working. A snapshot missing a table must not pass. |

## Not done here

- The production instance still has no `vpc_security_group_ids` and relies on
  the default VPC security group. The temporary instance gets a dedicated group
  that only accepts PostgreSQL from this function, but tightening the
  production instance's own group is a separate change, because doing it wrong
  cuts the application off from its database.
- The password is read from a Terraform variable rather than Secrets Manager,
  which puts it in Lambda configuration and therefore in state. #838 supersedes
  this.
- Only the newest automated snapshot is tested. PITR to an arbitrary timestamp is
  not exercised.
