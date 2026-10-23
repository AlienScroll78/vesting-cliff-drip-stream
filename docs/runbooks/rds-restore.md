# Operations Runbook: RDS PostgreSQL Snapshot Restore

| Attribute | Value |
|---|---|
| **Document ID** | RB-DB-001 |
| **Last Verified Date** | 2026-10-21 (Tested in Staging environment) |
| **Target Systems** | Amazon RDS PostgreSQL (`staging-vesting-db`, `production-vesting-db`) |
| **On-Call Severity** | P1 (Production Database Outage / Data Corruption) |
| **Primary Tooling** | AWS CLI (`aws rds`), `psql`, Terraform |

---

## Table of Contents

1. [Overview & Recovery Objectives](#1-overview--recovery-objectives)
2. [Pre-Conditions & Validation Checklist](#2-pre-conditions--validation-checklist)
3. [Step-by-Step Restore Procedure](#3-step-by-step-restore-procedure)
   - [Phase A: Staging RDS Restore](#phase-a-staging-rds-restore)
   - [Phase B: Production RDS Restore](#phase-b-production-rds-restore)
4. [Post-Restore Verification Checklist](#4-post-restore-verification-checklist)
5. [Promotion & Cutover Procedure](#5-promotion--cutover-procedure)
6. [Terraform State Reconciliation & Import](#6-terraform-state-reconciliation--import)
7. [Rollback Procedure](#7-rollback-procedure)
8. [Emergency Contacts & Escalation Path](#8-emergency-contacts--escalation-path)

---

## 1. Overview & Recovery Objectives

This operational runbook provides step-by-step instructions for an on-call engineer to restore the `vesting-cliff-drip-stream` PostgreSQL database from an automated or manual RDS snapshot.

### Backup Strategy Summary
- **Automated Backups**: Enabled with **35-day retention** in both staging and production. Continuous write-ahead log (WAL) archiving allows Point-In-Time Recovery (PITR) to any second within the retention window.
- **Manual Snapshots**: Daily automated snapshots run at **02:00 UTC** via GitHub Actions workflow (`.github/workflows/rds-backup.yml`). Pre-migration manual snapshots are taken before executing database schema migrations.
- **Encryption**: All snapshots and volumes are encrypted at rest with AWS KMS (`alias/${ENVIRONMENT}-vesting-postgres`).

### Recovery Time Objective (RTO) by Snapshot Age

The total RTO depends on EBS volume hydration speed, storage size, and whether the snapshot is cached on warm storage or retrieved from S3:

| Snapshot Age | Storage Size | Estimated Provision Time | Total Estimated RTO | Operational Notes |
|---|---|---|---|---|
| **< 24 hours** | 20 GB – 100 GB | 10 – 15 minutes | **15 – 25 minutes** | Warm snapshot in regional EBS cache; fastest hydration. |
| **1 to 7 days** | 20 GB – 100 GB | 15 – 25 minutes | **25 – 40 minutes** | Standard snapshot retrieval from S3 storage tier. |
| **8 to 35 days** | 20 GB – 100 GB | 25 – 45 minutes | **40 – 60 minutes** | Deep S3 block retrieval; initial read latency elevated until blocks hydrate. |

> [!NOTE]
> Restored EBS volumes initialize blocks lazily from S3. Once the instance state reaches `available`, database queries may experience slight I/O latency for several minutes as untouched blocks are loaded into storage.

---

## 2. Pre-Conditions & Validation Checklist

Before executing the restore command, verify the following prerequisites:

- [ ] **Verify Target Environment**: Confirm whether you are operating on `staging` or `production`. Set your shell context:
  ```bash
  export ENVIRONMENT="staging" # or "production"
  export AWS_REGION="eu-west-1" # set your deployment region
  ```
- [ ] **Verify Source DB Identifier**:
  ```bash
  export RDS_INSTANCE_ID="${ENVIRONMENT}-vesting-db"
  aws rds describe-db-instances \
    --db-instance-identifier "$RDS_INSTANCE_ID" \
    --query 'DBInstances[0].{ID:DBInstanceIdentifier,Status:DBInstanceStatus,Engine:EngineVersion}'
  ```
- [ ] **Confirm Snapshot Existence and State**: Verify the snapshot identifier exists and has status `available`:
  ```bash
  # List recent snapshots
  aws rds describe-db-snapshots \
    --db-instance-identifier "$RDS_INSTANCE_ID" \
    --query 'DBSnapshots[?Status==`available`].[DBSnapshotIdentifier,SnapshotCreateTime,AllocatedStorage]' \
    --output table
  ```
  Set the chosen snapshot variable:
  ```bash
  export SNAPSHOT_ID="<snapshot-identifier-from-table>"
  ```
- [ ] **Verify KMS Key Availability**: Ensure the target KMS key is active and accessible:
  ```bash
  aws kms describe-key \
    --key-id "alias/${ENVIRONMENT}-vesting-postgres" \
    --query 'KeyMetadata.{KeyId:KeyId,Enabled:Enabled,KeyState:KeyState}'
  ```
- [ ] **Verify Subnet Group & VPC Security Groups**:
  ```bash
  export DB_SUBNET_GROUP="${ENVIRONMENT}-db"
  export DB_SECURITY_GROUP=$(aws ec2 describe-security-groups \
    --filters "Name=group-name,Values=*${ENVIRONMENT}*db*" \
    --query 'SecurityGroups[0].GroupId' --output text)
  ```
- [ ] **Resource Quota Check**: Verify that your AWS account has sufficient RDS instance and storage quota available in the region to spin up a new instance concurrently.

---

## 3. Step-by-Step Restore Procedure

Always restore to a **new, dedicated instance identifier** (e.g. `${ENVIRONMENT}-vesting-db-restored`). Never attempt to delete the running source database before verifying the restored copy.

---

### Phase A: Staging RDS Restore

In staging, the instance is restored as a single-AZ instance to conserve testnet cost.

1. **Initiate the Restore**:
   ```bash
   RESTORED_ID="staging-vesting-db-restored"

   aws rds restore-db-instance-from-db-snapshot \
     --db-instance-identifier "$RESTORED_ID" \
     --db-snapshot-identifier "$SNAPSHOT_ID" \
     --db-instance-class db.t3.medium \
     --db-subnet-group-name "staging-db" \
     --vpc-security-group-ids "$DB_SECURITY_GROUP" \
     --kms-key-id "alias/staging-vesting-postgres" \
     --no-multi-az \
     --no-publicly-accessible \
     --auto-minor-version-upgrade \
     --tags Key=Environment,Value=staging Key=RestoredFrom,Value="$SNAPSHOT_ID"
   ```

2. **Wait for Availability**:
   ```bash
   echo "Waiting for $RESTORED_ID to reach 'available' state..."
   aws rds wait db-instance-available --db-instance-identifier "$RESTORED_ID"
   echo "Instance $RESTORED_ID is now AVAILABLE."
   ```

3. **Retrieve New Endpoint**:
   ```bash
   RESTORED_ENDPOINT=$(aws rds describe-db-instances \
     --db-instance-identifier "$RESTORED_ID" \
     --query 'DBInstances[0].Endpoint.Address' --output text)
   echo "Restored Staging Endpoint: $RESTORED_ENDPOINT"
   ```

---

### Phase B: Production RDS Restore

In production, multi-AZ deployment and deletion protection must remain enabled.

1. **Initiate the Restore**:
   ```bash
   RESTORED_ID="production-vesting-db-restored"

   aws rds restore-db-instance-from-db-snapshot \
     --db-instance-identifier "$RESTORED_ID" \
     --db-snapshot-identifier "$SNAPSHOT_ID" \
     --db-instance-class db.t3.large \
     --db-subnet-group-name "production-db" \
     --vpc-security-group-ids "$DB_SECURITY_GROUP" \
     --kms-key-id "alias/production-vesting-postgres" \
     --multi-az \
     --deletion-protection \
     --copy-tags-to-snapshot \
     --no-publicly-accessible \
     --tags Key=Environment,Value=production Key=RestoredFrom,Value="$SNAPSHOT_ID" Key=RestoredAt,Value="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
   ```

2. **Wait for Availability**:
   ```bash
   echo "Waiting for $RESTORED_ID to reach 'available' state..."
   aws rds wait db-instance-available --db-instance-identifier "$RESTORED_ID"
   echo "Production instance $RESTORED_ID is AVAILABLE."
   ```

3. **Retrieve Endpoint**:
   ```bash
   RESTORED_ENDPOINT=$(aws rds describe-db-instances \
     --db-instance-identifier "$RESTORED_ID" \
     --query 'DBInstances[0].Endpoint.Address' --output text)
   echo "Restored Production Endpoint: $RESTORED_ENDPOINT"
   ```

---

## 4. Post-Restore Verification Checklist

Execute these checks against the restored database endpoint before pointing any application traffic to it.

### 1. Network Connectivity & Authentication Check

```bash
# Obtain application credentials from AWS Secrets Manager
DB_SECRET=$(aws secretsmanager get-secret-value \
  --secret-id "${ENVIRONMENT}/vesting/database" \
  --query 'SecretString' --output text)

DB_USER=$(echo "$DB_SECRET" | jq -r .username)
DB_PASS=$(echo "$DB_SECRET" | jq -r .password)
DB_NAME="vesting"

# Verify psql connectivity
PGPASSWORD="$DB_PASS" psql \
  -h "$RESTORED_ENDPOINT" \
  -U "$DB_USER" \
  -d "$DB_NAME" \
  -c "SELECT version();"
```

### 2. Schema Migration Version Check

Verify that all expected database migrations are present and match the application code release:

```bash
PGPASSWORD="$DB_PASS" psql \
  -h "$RESTORED_ENDPOINT" \
  -U "$DB_USER" \
  -d "$DB_NAME" \
  -c "SELECT id, name, run_on FROM pgmigrations ORDER BY id DESC LIMIT 10;"
```
- [ ] Confirm latest migration matches current deployment (e.g. `006_create_stream_events_and_cursors`).

### 3. Data Integrity & Table Row Sanity Checks

Compare critical table row counts against pre-incident benchmarks:

```bash
PGPASSWORD="$DB_PASS" psql \
  -h "$RESTORED_ENDPOINT" \
  -U "$DB_USER" \
  -d "$DB_NAME" <<EOF
SELECT 'vesting_streams' AS table_name, count(*) AS total_rows FROM vesting_streams
UNION ALL
SELECT 'claim_events', count(*) FROM claim_events
UNION ALL
SELECT 'stream_events', count(*) FROM stream_events
UNION ALL
SELECT 'backfill_jobs', count(*) FROM backfill_jobs;
EOF
```

### 4. Indexer Cursor Verification

Check the indexer resume position:

```bash
PGPASSWORD="$DB_PASS" psql \
  -h "$RESTORED_ENDPOINT" \
  -U "$DB_USER" \
  -d "$DB_NAME" \
  -c "SELECT id, cursor FROM indexer_cursor WHERE id = 1;"
```
- [ ] Record the cursor string. If there is a ledger gap between the snapshot and current Stellar ledger height, prepare to run the event backfill runbook (`docs/runbooks/backfill-stream-events.md`).

---

## 5. Promotion & Cutover Procedure

Once the restored database passes all post-restore checks, promote it to serve live traffic.

### Step 1: Update Secrets Manager `DATABASE_URL`

Update the canonical connection string in AWS Secrets Manager:

```bash
NEW_DATABASE_URL="postgresql://${DB_USER}:${DB_PASS}@${RESTORED_ENDPOINT}:5432/${DB_NAME}?sslmode=require"

aws secretsmanager put-secret-value \
  --secret-id "${ENVIRONMENT}/vesting/database-url" \
  --secret-string "$NEW_DATABASE_URL"
```

### Step 2: Restart ECS Backend Tasks

Trigger a rolling redeployment so backend tasks pull the new connection string:

```bash
aws ecs update-service \
  --cluster "${ENVIRONMENT}-vesting-cluster" \
  --service "${ENVIRONMENT}-vesting-backend" \
  --force-new-deployment

aws ecs wait services-stable \
  --cluster "${ENVIRONMENT}-vesting-cluster" \
  --services "${ENVIRONMENT}-vesting-backend"
```

### Step 3: Verify Application Health

Verify that the application backend is healthy:

```bash
curl -f "https://${ENVIRONMENT}-api.vestingdrips.com/health"
curl -f "https://${ENVIRONMENT}-api.vestingdrips.com/ready"
```

### Step 4: Decommission Deprecated Instance

After 48 hours of stable production monitoring:
```bash
# Take a final preservation snapshot before deletion
aws rds delete-db-instance \
  --db-instance-identifier "$RDS_INSTANCE_ID" \
  --final-db-snapshot-identifier "${RDS_INSTANCE_ID}-pre-decommission-$(date +%Y%m%d)" \
  --delete-automated-backups
```

---

## 6. Terraform State Reconciliation & Import

Because the new database instance was provisioned via the AWS CLI to minimize downtime during an incident, Terraform state must be updated to manage the restored resource.

### Step 1: Import Restored DB Instance into Terraform

From the `terraform/` root directory:

```bash
# Initialize Terraform with environment backend configuration
cd terraform
terraform init -backend-config="envs/${ENVIRONMENT}.backend.hcl"

# Remove the old instance reference from state (does not delete live AWS resource)
terraform state rm module.data.aws_db_instance.postgres

# Import the new restored RDS instance into the Terraform resource address
terraform import \
  -var-file="bootstrap/envs/${ENVIRONMENT}.tfvars" \
  module.data.aws_db_instance.postgres "$RESTORED_ID"
```

### Step 2: Run Drift Plan Check

Run a plan to ensure Terraform configuration matches the imported instance:

```bash
terraform plan -var-file="bootstrap/envs/${ENVIRONMENT}.tfvars" -detailed-exitcode
```
- **Exit Code 0**: Clean import, zero drift.
- **Exit Code 2 (Diff detected)**: If parameters differ (e.g. minor version upgrade or instance class), update `bootstrap/envs/${ENVIRONMENT}.tfvars` to reconcile configuration before applying.

---

## 7. Rollback Procedure

If the restore operation fails, hangs, or fails post-restore data validation checks, follow this rollback procedure:

1. **Halt Cutover**:
   Do **not** update AWS Secrets Manager or redeploy ECS services. Live traffic continues pointing to the original database or maintenance error page.
2. **Tear Down Broken Restored Instance**:
   Terminate the failed candidate instance to prevent resource sprawl and billing charges:
   ```bash
   aws rds delete-db-instance \
     --db-instance-identifier "$RESTORED_ID" \
     --skip-final-snapshot \
     --delete-automated-backups
   ```
3. **Analyze Root Cause**:
   - Check CloudWatch RDS Event logs:
     ```bash
     aws rds describe-events \
       --source-identifier "$RESTORED_ID" \
       --source-type db-instance \
       --duration 60
     ```
   - Check KMS permissions: Ensure role `AWSServiceRoleForRDS` has `kms:Decrypt` access to the KMS key alias.
   - Check Subnet IP exhaustion: Verify that the DB subnet group has free private IP addresses available in the VPC.
4. **Select Alternative Recovery Strategy**:
   - Re-attempt restore using an alternate snapshot timestamp (`$SNAPSHOT_ID_PREVIOUS`).
   - Or perform Point-In-Time Recovery (PITR) to a specific ledger timestamp using `aws rds restore-db-instance-to-point-in-time`.

---

## 8. Emergency Contacts & Escalation Path

| Role | Channel / Contact | Escalation SLA |
|---|---|---|
| **Incident Commander (IC)** | Slack `#incidents` | Immediate (P1 declaration) |
| **Primary On-Call Engineer** | PagerDuty: `Vesting-App-OnCall` | < 15 minutes |
| **Secondary On-Call / Infra Lead** | PagerDuty: `Vesting-Infra-Escalation` | < 30 minutes |
| **Backend Lead** | Slack: `@backend-lead` | < 30 minutes |
| **Operations Team** | Slack `#ops` | Continuous incident communication |

### Escalation Guidelines
- **0–15 minutes**: On-call engineer identifies snapshot, verifies environment, and issues `restore-db-instance-from-db-snapshot`. Post status update in `#incidents`.
- **15–30 minutes**: If instance restoration fails to initialize or encounters KMS authorization errors, page the Infrastructure Lead immediately via PagerDuty.
- **> 45 minutes**: If production data is corrupted and recovery exceeds RTO, Incident Commander must update status page (https://status.vestingdrips.com) and notify stakeholders.
