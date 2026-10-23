# RDS Backup Restore Verification

Weekly automated proof that RDS backups actually restore, with procedures for on-demand verification runs, failure escalation, and environment isolation.

---

## 1. Overview & Objectives

RDS automated backups are only useful if they can be restored. The failure mode this guards against is silent and severe: automated snapshot retention looks active, the `backup_failure` event subscription reports nothing, and the team discovers an unrecoverable snapshot only during an active disaster.

As stated in the project architecture:
> *"Weekly automated proof that backups restore; run one on demand."*

This runbook documents:
1. **Automated Weekly Verification:** Automated scheduled validation testing snapshots end-to-end.
2. **On-Demand Verification:** How engineers can trigger immediate validation tests (e.g. before major schema migrations or network topology changes).
3. **Verification Checklist:** Standardized verification criteria across snapshot presence, restore completion, schema correctness, and data integrity hashes.
4. **Failure Escalation & Support:** Triage workflow and AWS RDS Support contact procedures.
5. **Retention Policy:** Storage lifetimes for verification logs, metrics, and transient databases.
6. **Isolation & Safety:** Strict tagging and naming conventions guaranteeing zero impact on production workloads.

---

## 2. Automated Weekly Verification Workflow

The verification pipeline executes automatically via AWS EventBridge Scheduler / Lambda (with Step Functions support for complex orchestration):

```
                   EventBridge Scheduler cron(0 3 ? * SUN *)
                                     │
                                     ▼
                      backup-verify Lambda Function
                                     │
             ┌───────────────────────┴───────────────────────┐
             │                                               │
             ▼                                               ▼
1. Query Latest Snapshot                        2. Restore Isolated Instance
   rds:DescribeDBSnapshots                         rds:RestoreDBInstanceFromDBSnapshot
   Filter: automated, status=available             Prefix: vesting-restore-test-<stamp>
                                                   Subnet: Isolated Private Subnet
                                                   Tags: RestoreTest=true
                                                   Retention: 0 (No secondary backups)
                                     │
                                     ▼
                        3. Await 'available' State
                                     │
                                     ▼
                        4. Schema & Data Hash Verify
                           Connect over TLS (SCRAM-SHA-256)
                           Verify expected tables exist
                           Compute table row counts & hash
                                     │
             ┌───────────────────────┴───────────────────────┐
             │                                               │
             ▼                                               ▼
5. Publish Verdict & Notify                     6. Tear Down Instance
   Metric: VestingApp/BackupRestoreSuccess         rds:DeleteDBInstance
   Logs: CloudWatch Log Group (365d retention)     SkipFinalSnapshot=true
   Alert: SNS -> Slack #ops & PagerDuty            DeleteAutomatedBackups=true
```

### What It Tests
- **Snapshot Availability:** Verifies that AWS RDS has successfully captured and retained an automated snapshot within the configured retention window.
- **Instance Restoration:** Proves that AWS can provision a fresh instance (`db.t3.micro`) from the snapshot without corruption or storage configuration errors.
- **Network & TLS Connectivity:** Proves that the PostgreSQL endpoint is accessible via secure TLS with SCRAM-SHA-256 authentication inside the VPC.
- **Schema & Table Completeness:** Queries table catalogs to ensure core application tables (`schedules`, `events`, `claims`, `indexer_cursor`) exist and match the expected schema.
- **Data Integrity Hash / Count:** Validates that row counts are intact and table contents yield a valid state digest without corruption.

### Where Results Are Stored
1. **CloudWatch Metrics:**
   - Metric: `VestingApp/BackupRestoreSuccess` (`1` for pass, `0` for fail).
   - Dimension: `Environment = <staging|production>`.
   - Period: `604800` (7 days), Minimum statistic.
2. **CloudWatch Logs:**
   - Log Group: `/aws/lambda/<environment>-vesting-backup-verify`.
   - Contains structured JSON entries with snapshot ID, restoration duration, validated tables, row counts, and error traces.
3. **Slack Notifications:**
   - Results (both passes and failures) are broadcast to the Slack **`#ops`** channel via SNS topic subscription (`<environment>-vesting-backup-verify-alerts`) connected to AWS Chatbot or webhook Lambda.
4. **PagerDuty Incident Alerts:**
   - Metric alarm `<environment>-backup-restore-failed` immediately triggers a high-priority PagerDuty incident if the verification fails or if no result is emitted within the weekly evaluation period (`treat_missing_data = breaching`).

---

## 3. How to Trigger an On-Demand Verification Run

Do not wait for the Sunday schedule when deploying major database schema changes, updating PostgreSQL versions, altering KMS keys, or modifying VPC subnets.

### Method A: AWS Lambda CLI Trigger

Trigger an immediate execution for the target environment (`staging` or `production`):

```bash
ENV=staging # or production

# 1. Trigger the verification Lambda synchronously
aws lambda invoke \
  --function-name "$ENV-vesting-backup-verify" \
  --payload '{}' \
  --cli-binary-format raw-in-base64-out \
  response.json

# 2. View the execution output
cat response.json | jq .
```

### Method B: AWS Step Functions / Console Trigger (If Configured)

If Step Functions orchestration is enabled:
```bash
aws stepfunctions start-execution \
  --state-machine-arn "arn:aws:states:us-east-1:$(aws sts get-caller-identity --query Account --output text):stateMachine:$ENV-vesting-backup-verify" \
  --name "on-demand-verify-$(date +%s)"
```

### Monitoring the Verification Run

Restores typically take between 4 to 10 minutes depending on database volume. Tail the live CloudWatch logs during execution:

```bash
aws logs tail "/aws/lambda/$ENV-vesting-backup-verify" --follow --since 10m
```

Look for confirmation logs:
```json
{"level":"info","msg":"selected snapshot","snapshot":"staging-vesting-db:2026-10-21-02-03","candidates":1}
{"level":"info","msg":"restoring snapshot","instance":"vesting-restore-test-20261021120000","dbClass":"db.t3.micro"}
{"level":"info","msg":"restore verification passed","rowCounts":{"schedules":14,"events":84,"claims":256,"indexer_cursor":1},"dataHash":"a4f9b8c1..."}
{"level":"info","msg":"deleted temporary instance","instance":"vesting-restore-test-20261021120000"}
{"level":"info","msg":"backup verification finished","ok":true,"durationMs":342000}
```

---

## 4. Verification Checklist

Whenever an automated alert fires or an engineer executes an on-demand verification, review the following four-point checklist:

- [ ] **1. Snapshot Exists & Is Available**
  - Verify that automated snapshots exist for the source RDS instance:
    ```bash
    aws rds describe-db-snapshots \
      --db-instance-identifier "$ENV-vesting-db" \
      --snapshot-type automated \
      --query 'reverse(sort_by(DBSnapshots, &SnapshotCreateTime))[0].{ID:DBSnapshotIdentifier,Status:Status,Created:SnapshotCreateTime}'
    ```
  - *Pass criteria:* Snapshot status is `available` and `SnapshotCreateTime` is within the last 24 hours.

- [ ] **2. Restore Completes Successfully**
  - Verify that the temporary test instance launches and transitions to `available`:
    ```bash
    aws rds describe-db-instances \
      --filters "Name=tag:RestoreTest,Values=true" \
      --query 'DBInstances[].{ID:DBInstanceIdentifier,Status:DBInstanceStatus,Endpoint:Endpoint.Address}'
    ```
  - *Pass criteria:* Status transitions from `creating` to `available` within the 30-minute timeout limit (`RESTORE_TIMEOUT_MS`).

- [ ] **3. Schema Correctness**
  - Confirm all expected application tables are present and queryable:
    - `schedules`
    - `events`
    - `claims`
    - `indexer_cursor`
  - *Pass criteria:* Queries of the form `SELECT count(*)::bigint FROM "<table_name>"` succeed without relational errors (`42P01: relation does not exist`) or permission issues.

- [ ] **4. Data Integrity Hash Matches**
  - Execute a table content checksum / integrity hash validation:
    ```sql
    -- Data integrity hash check across critical records
    SELECT md5(string_agg(id || ':' || status || ':' || total_amount::text, ',' ORDER BY id)) AS schedule_digest
    FROM schedules;
    ```
  - *Pass criteria:* Non-null hash returned, row counts match or exceed expected test baselines, and no storage block corruption (`XX001: data corrupted`) is reported.

---

## 5. Environment Isolation: Distinguishing Test from Production

To prevent test runs from affecting production latency, budget, or security boundaries, verification operates under strict isolation protocols.

### Isolated Network & Security Boundaries
- **Dedicated Security Group:** The restore target attaches solely to `<environment>-vesting-restore-target`.
  - Ingress: TCP port `5432` restricted **exclusively** to the verification Lambda security group (`<environment>-vesting-backup-verify`).
  - No ingress is allowed from ECS backend containers, public internet, bastion hosts, or developer subnets.
- **Isolated Subnet Placement:** Restores are deployed in private database subnets with no public IP assignment (`PubliclyAccessible = false`).

### Naming Conventions
- **Production Instance Identifier:** `<environment>-vesting-db` (e.g., `production-vesting-db`, `staging-vesting-db`).
- **Temporary Restore Identifier:** `vesting-restore-test-<YYYYMMDDhhmmss>`
  - Must begin with `vesting-restore-test-`.
  - Followed strictly by UTC digits (14 characters), ensuring no uppercase letters or invalid characters.

### Tagging Standards
Every temporary instance is explicitly tagged upon creation:

| Tag Key | Value | Purpose |
|---|---|---|
| `RestoreTest` | `true` | Primary selector for automated cleanup and audit scrapers |
| `ManagedBy` | `vesting-backup-verify` | Identifies provisioning controller |
| `Environment` | `test-restore` | Explicitly distinguishes from `production` or `staging` |
| `Temporary` | `true` | Signals ephemerality to cost monitoring and security scanners |

### Guardrails Against Foot-Guns
The automated cleanup worker (`rate(30 minutes)`) requires **both** conditions before invoking `DeleteDBInstance`:
1. `DBInstanceIdentifier` must start with `vesting-restore-test-`.
2. The instance **must** have tag `RestoreTest=true`.

Neither check alone is sufficient; this dual check ensures production databases can never be deleted by cleanup jobs.

---

## 6. What to Do If Verification Fails

When verification fails, `BackupRestoreSuccess` publishes `0`, triggering an alert in Slack **`#ops`** and an on-call page via PagerDuty.

### Immediate Triage Steps
1. **Check Lambda Execution Logs:**
   ```bash
   aws logs filter-log-events \
     --log-group-name "/aws/lambda/$ENV-vesting-backup-verify" \
     --filter-pattern "error" \
     --start-time $(date -u -d '2 hours ago' +%s000)
   ```
2. **Identify the Failure Phase:**
   - *Snapshot discovery failure:* Automated backups may have been paused or disabled (`backup_retention_period = 0`).
   - *Restore timeout / failure:* RDS capacity exhaustion in the AZ, or snapshot corruption (`incompatible-restore`).
   - *Authentication / TLS failure:* Secrets Manager password drifted or `rds.force_ssl` configuration issue.
   - *Schema failure:* Database migration broke table schemas or migration script was applied incorrectly.
3. **Check for Stray Instances:**
   Verify if an instance was left running:
   ```bash
   aws rds describe-db-instances \
     --filters "Name=tag:RestoreTest,Values=true" \
     --query 'DBInstances[].{ID:DBInstanceIdentifier,Status:DBInstanceStatus}'
   ```
   If present and orphaned, invoke cleanup manually:
   ```bash
   aws lambda invoke \
     --function-name "$ENV-vesting-backup-verify" \
     --payload '{"action":"cleanup"}' \
     --cli-binary-format raw-in-base64-out \
     /dev/stdout | jq .
   ```

### Escalation Path

```
[CloudWatch / PagerDuty / Slack #ops Alert]
                     │
                     ▼
  Tier 1: On-Call DevOps / SRE Engineer
  - Acknowledge alert within 15 minutes.
  - Review CloudWatch error log & snapshot status.
  - Verify if primary RDS is healthy and generating automated snapshots.
                     │
         Is RDS snapshot corrupted / AWS outage?
        ┌────────────┴────────────┐
       YES                       NO
        │                         │
        ▼                         ▼
  Tier 2: Infrastructure Lead   Resolve configuration / DB credential drift
  - Open AWS RDS Support Case
  - Notify team in #incidents
```

### RDS Support Contact & Case Creation

If a snapshot cannot be restored due to RDS engine corruption, KMS key inaccessible error, or internal AWS errors:

1. **Check AWS Service Health:**
   Check the [AWS Health Dashboard](https://health.aws.amazon.com/health/status) for ongoing RDS or EBS issues in the deployment region (`us-east-1` or configured region).
2. **Open an AWS Support Case:**
   - **Service:** RDS (Relational Database Service)
   - **Category:** Database -> Restore from Snapshot Failure
   - **Severity:** Urgent (Production down/degraded) or High
   - **CLI Command:**
     ```bash
     aws support create-case \
       --subject "URGENT: RDS Automated Snapshot Restore Failure for $ENV-vesting-db" \
       --service-code "amazon-relational-database-service" \
       --category-code "restore-database" \
       --severity-code "urgent" \
       --communication-body "Automated backup verification failed for RDS instance $ENV-vesting-db. Snapshot: $SNAPSHOT_ID failed to restore with error: $ERROR_MSG. Please investigate snapshot integrity."
     ```
3. **Direct Contact (Business / Enterprise Support):**
   - Access AWS Support Center console: https://console.aws.amazon.com/support/cases/
   - Phone Escalation: Request immediate call-back via the AWS Support Console for Enterprise Support plans.

---

## 7. Retention Policy

To balance audit compliance, troubleshooting history, and cost efficiency, verification artifacts follow a defined retention lifecycle:

| Component | Retention Window | Storage Mechanism | Purpose |
|---|---|---|---|
| **Verification Log Groups** | **365 Days (1 Year)** | CloudWatch Logs (`retention_in_days = 365`) | Full audit trail and multi-month regression correlation |
| **Verification Metrics** | **15 Months** | CloudWatch Metrics (`VestingApp`) | Standard AWS metrics retention for year-over-year operational trends |
| **Slack / SNS Notifications** | Per Slack Retention Policy | Slack `#ops` channel & SNS archive | Team visibility and incident historical search |
| **Temporary RDS Instances** | **< 1 Hour (Target: 10 min)** | AWS RDS Instance | Destroyed immediately after test pass/fail; 30-minute reaper cleans orphans |
| **Temporary Instance Backups** | **0 Days** (`BackupRetentionPeriod = 0`) | None | Prevents temporary test instances from spawning automated snapshots |

---

## 8. Summary Checklist for Operations

When conducting operational audits:
1. Ensure the EventBridge rule `${env}-vesting-backup-verify-weekly` is active.
2. Confirm the 30-minute reaper rule `${env}-vesting-backup-verify-cleanup` is active.
3. Validate that `#ops` receives the weekly success digest every Sunday after 03:00 UTC.
4. If modifying database schemas, run an on-demand verification before closing the deployment ticket.
