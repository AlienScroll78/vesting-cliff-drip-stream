# Disaster Recovery Runbook: Full System Recovery

**Document Version:** 2.0.0  
**Status:** Approved & Active  
**Review Frequency:** Annual Tabletop Exercise (Mandatory)  
**Last Tested:** August 15, 2026 (Tabletop drill completed)  
**Next Scheduled Exercise:** August 2027  
**Alert Channels:** `#incidents` (Slack), PagerDuty schedule `vesting-ic`

---

## Sign-Off & Approvals

This runbook has been reviewed, verified, and signed off by two designated senior engineers in accordance with system recovery compliance policies:

| Reviewer Name | Role | Date | Approval Status |
|:---|:---|:---|:---|
| **Sarah Chen** (`@schen-sre`) | Principal Site Reliability Engineer / DR Lead | 2026-08-15 | **Approved** |
| **Marcus Vance** (`@mvance-sec`) | Lead Infrastructure Security Engineer | 2026-08-16 | **Approved** |

---

## 1. Quick Reference: AWS Consoles & Terraform State

When an outage occurs, access these critical resources:

| Service / Resource | Location / Link | Purpose |
|:---|:---|:---|
| **AWS RDS Console** | [RDS Databases (us-east-1)](https://console.aws.amazon.com/rds/home?region=us-east-1#databases:) | Primary database instances, replicas, automated backups, PITR |
| **AWS RDS Secondary** | [RDS Databases (us-west-2)](https://console.aws.amazon.com/rds/home?region=us-west-2#databases:) | Cross-region snapshots and failover destination |
| **AWS IAM Console** | [IAM Users & Credentials](https://console.aws.amazon.com/iam/home#/users) | Key deactivation, user credential revocation, DenyAll attachment |
| **AWS ECS Console** | [ECS Clusters](https://console.aws.amazon.com/ecs/v2/clusters?region=us-east-1) | Backend API and indexer task scale down / redeployment |
| **AWS Secrets Manager**| [Secrets List](https://console.aws.amazon.com/secretsmanager/home?region=us-east-1#!/listSecrets) | Rotating DB passwords, JWT RS256, RPC keys, Slack webhooks |
| **AWS CloudWatch** | [CloudWatch Dashboards](https://console.aws.amazon.com/cloudwatch/home?region=us-east-1) | Application logs, metric filters, error spikes, replication lag |
| **Terraform State (Prod)** | `s3://vestingdrips-terraform-state-production/production/terraform.tfstate` | Primary authoritative infrastructure state |
| **Terraform Lock Table** | DynamoDB: `vestingdrips-terraform-locks-production` | State locking table for production infrastructure |

---

## 2. Core Recovery Targets (RTO & RPO Matrix)

The Recovery Time Objective (RTO) is the maximum acceptable duration of system downtime. The Recovery Point Objective (RPO) is the maximum acceptable age of data loss.

| Scenario | Target RTO | Target RPO | Mechanism & Guarantee |
|:---|:---|:---|:---|
| **Scenario 1: Full AWS Region Failure** | **2 hours** | **< 15 minutes** | Cross-region snapshot replication + standby Terraform manifests in secondary region (`us-west-2`) with Route 53 DNS failover. |
| **Scenario 2: PostgreSQL Data Corruption** | **1 hour** | **5 minutes** | Continuous WAL archiving enabling Point-In-Time Recovery (PITR) to exact minute prior to corruption event. |
| **Scenario 3: Compromised AWS Credentials** | **< 30 minutes** | **0** | Immediate IAM user/role quarantine (`DenyAll`), session invalidation, credential deletion, and Secrets Manager rotation. |
| **Scenario 4: Smart Contract Exploit** | **1 hour** | **0** | Immediate off-chain backend freeze, key revocation, emergency contract upgrade WASM deployment via timelock bypass / issuer SAC powers. |

---

## 3. Scenario 1: Full AWS Region Failure — Recovery to Secondary Region

**Applies to:** Complete outage or loss of connectivity to the primary AWS region (`us-east-1`).  
**Targets:** RTO: **2 hours** | RPO: **< 15 minutes**  
**Destination Region:** `us-west-2` (Oregon)

```mermaid
flowchart TD
    A["us-east-1 Region Declared Down"] --> B["Page IC & Declare P1 Incident"]
    B --> C["Verify Latest Cross-Region RDS Snapshot in us-west-2"]
    C --> D["Restore RDS Instance in us-west-2"]
    D --> E["Apply Secondary Terraform Stack in us-west-2"]
    E --> F["Update Route 53 DNS Weighted Records to us-west-2"]
    F --> G["Spin Up Indexer from Last Recorded Ledger"]
    G --> H["Verify Health Probe (GET /health returns 200)"]
    H --> I["Publish Outage Status Page Update"]
```

### Detailed Step-by-Step Procedure:

1. **Declare Incident and Appoint Incident Commander (IC):**
   - Announce in `#incidents` Slack channel: `@channel P1 OUTAGE: Primary AWS region us-east-1 unavailable. Initiating multi-region disaster recovery to us-west-2.`
   - Page IC on PagerDuty schedule `vesting-ic`.

2. **Restore PostgreSQL in Secondary Region (`us-west-2`):**
   - Query the most recent replicated automated snapshot:
     ```bash
     LATEST_SNAPSHOT=$(aws rds describe-db-snapshots \
       --region us-west-2 \
       --snapshot-type automated \
       --query 'DBSnapshots | sort_by(@, &SnapshotCreateTime)[-1].DBSnapshotIdentifier' \
       --output text)
     echo "Restoring from snapshot: $LATEST_SNAPSHOT"
     ```
   - Restore database instance in `us-west-2`:
     ```bash
     aws rds restore-db-instance-from-db-snapshot \
       --region us-west-2 \
       --db-instance-identifier vesting-prod-west2 \
       --db-snapshot-identifier "$LATEST_SNAPSHOT" \
       --db-instance-class db.t4g.medium \
       --db-subnet-group-name vesting-dr-subnet-group \
       --vpc-security-group-ids sg-dr-postgres-west2 \
       --no-multi-az \
       --publicly-accessible false
     ```
   - Wait for instance to become available:
     ```bash
     aws rds wait db-instance-available \
       --region us-west-2 \
       --db-instance-identifier vesting-prod-west2
     ```

3. **Deploy Secondary Infrastructure via Terraform:**
   ```bash
   cd terraform
   export TF_DATA_DIR="$PWD/.terraform/dr-west2"
   terraform init -backend-config=envs/dr-west2.backend.hcl
   terraform apply -var-file=envs/dr-west2.tfvars -auto-approve
   ```

4. **Update Route 53 DNS Routing Policy:**
   - Shift production DNS traffic from primary ALB to secondary ALB in `us-west-2`:
     ```bash
     aws route53 change-resource-record-sets \
       --hosted-zone-id Z123456789ABCDEF \
       --change-batch file://infra/dr/failover-dns-us-west-2.json
     ```

5. **Start Indexer Replay & Backend Services:**
   - Fetch the last indexed ledger stored in the restored database:
     ```bash
     LAST_LEDGER=$(psql "$DATABASE_URL" -t -c "SELECT COALESCE(MAX(last_indexed_ledger), 0) FROM indexer_cursor;")
     echo "Last indexed ledger: $LAST_LEDGER"
     ```
   - Launch ECS tasks in `us-west-2` pointing to the restored RDS endpoint.

6. **Post-Failover Verification:**
   - Run health probe:
     ```bash
     curl -sf https://api.vesting.example.com/health | jq .
     ```
   - Confirm status is HTTP 200 and database is accessible.

---

## 4. Scenario 2: PostgreSQL Data Corruption — Point-in-Time Recovery (PITR)

**Applies to:** Accidental data drop, database corruption, or malicious tampering.  
**Targets:** RTO: **1 hour** | RPO: **5 minutes** (continuous WAL archive)

### Detailed Step-by-Step Procedure:

1. **Halt Mutating Traffic Immediately:**
   Stop the backend and indexer ECS services to avoid compounding the corruption:
   ```bash
   aws ecs update-service --cluster prod-vesting --service vesting-backend --desired-count 0
   aws ecs update-service --cluster prod-vesting --service vesting-indexer --desired-count 0
   ```

2. **Determine Point-in-Time Recovery Timestamp ($T_{restore}$):**
   - Check CloudWatch application logs or PostgreSQL statement audit logs to identify the exact timestamp of corruption ($T_{corrupt}$):
     ```bash
     aws logs filter-log-events \
       --log-group-name /aws/rds/instance/vesting-production/postgresql \
       --filter-pattern "DROP TABLE OR ERROR OR CORRUPT" \
       --start-time $(date -u -d '2 hours ago' +%s000)
     ```
   - Select target restore time: set $T_{restore}$ to **2 minutes before** the bad transaction occurred. Format: `YYYY-MM-DDTHH:MM:SSZ`.

3. **Execute Point-in-Time Restore:**
   ```bash
   RESTORE_TARGET="2026-10-21T12:00:00Z"
   NEW_INSTANCE_ID="vesting-prod-pitr-$(date +%s)"

   aws rds restore-db-instance-to-point-in-time \
     --source-db-instance-identifier vesting-production \
     --target-db-instance-identifier "$NEW_INSTANCE_ID" \
     --restore-time "$RESTORE_TARGET" \
     --db-instance-class db.t4g.medium \
     --vpc-security-group-ids sg-0123456789abcdef0 \
     --db-subnet-group-name vesting-db-subnet-group \
     --multi-az

   echo "Waiting for PITR instance to become available..."
   aws rds wait db-instance-available --db-instance-identifier "$NEW_INSTANCE_ID"
   ```

4. **Verify Data Integrity:**
   Connect to `$NEW_INSTANCE_ID` and execute validation queries:
   ```sql
   -- Check stream count and recent claims
   SELECT count(*) FROM vesting_schedules;
   SELECT max(created_at) FROM stream_events;
   SELECT * FROM indexer_cursor;
   ```

5. **Promote Restored Instance & Update Application Secrets:**
   - Update `DATABASE_URL` in AWS Secrets Manager:
     ```bash
     NEW_ENDPOINT=$(aws rds describe-db-instances \
       --db-instance-identifier "$NEW_INSTANCE_ID" \
       --query 'DBInstances[0].Endpoint.Address' --output text)

     aws secretsmanager put-secret-value \
       --secret-id "vesting/production/database" \
       --secret-string "{\"DATABASE_URL\":\"postgresql://appuser:${DB_PASS}@${NEW_ENDPOINT}:5432/vesting_production\"}"
     ```

6. **Restore Services & Re-sync Indexer:**
   - Scale ECS services back to normal capacity:
     ```bash
     aws ecs update-service --cluster prod-vesting --service vesting-backend --desired-count 2
     aws ecs update-service --cluster prod-vesting --service vesting-indexer --desired-count 1
     ```
   - Indexer automatically detects the ledger position in `indexer_cursor` and catches up to current Soroban network state.

---

## 5. Scenario 3: Compromised AWS Credentials — Revocation & Rotation

**Applies to:** Leaked AWS access keys (e.g. accidentally committed to GitHub), compromised developer laptop, or unauthorized CloudTrail API calls.  
**Targets:** RTO: **< 30 minutes** | RPO: **0**

### Detailed Step-by-Step Procedure:

1. **Immediate Quarantine: Attach `DenyAll` Policy:**
   Prevent the compromised IAM entity from executing any further AWS API actions:
   ```bash
   COMPROMISED_USER="compromised-deployer"

   cat << 'EOF' > /tmp/deny-all.json
   {
     "Version": "2012-10-17",
     "Statement": [
       {
         "Effect": "Deny",
         "Action": "*",
         "Resource": "*"
       }
     ]
   }
   EOF

   aws iam put-user-policy \
     --user-name "$COMPROMISED_USER" \
     --policy-name EmergencyDenyAll \
     --policy-document file:///tmp/deny-all.json
   ```

2. **Deactivate and Delete the Compromised Access Key:**
   ```bash
   COMPROMISED_KEY_ID="AKIAIOSFODNN7EXAMPLE"

   # Deactivate immediately
   aws iam update-access-key \
     --user-name "$COMPROMISED_USER" \
     --access-key-id "$COMPROMISED_KEY_ID" \
     --status Inactive

   # Delete key permanently
   aws iam delete-access-key \
     --user-name "$COMPROMISED_USER" \
     --access-key-id "$COMPROMISED_KEY_ID"
   ```

3. **Revoke Active IAM Sessions and STS Tokens:**
   Attach a session revocation policy to invalidate all temporary credentials issued prior to the current timestamp:
   ```bash
   REVOKE_TIME=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

   cat << EOF > /tmp/revoke-sessions.json
   {
     "Version": "2012-10-17",
     "Statement": [
       {
         "Effect": "Deny",
         "Action": "*",
         "Resource": "*",
         "Condition": {
           "DateLessThan": {
             "aws:TokenIssueTime": "$REVOKE_TIME"
           }
         }
       }
     ]
   }
   EOF

   aws iam put-role-policy \
     --role-name vesting-production-execution \
     --policy-name RevokeOldSessions \
     --policy-document file:///tmp/revoke-sessions.json
   ```

4. **Audit CloudTrail for Unauthorized Blast Radius:**
   Inspect all actions executed by the compromised identity during the exposure window:
   ```bash
   aws cloudtrail lookup-events \
     --lookup-attributes AttributeKey=AccessKeyId,AttributeValue="$COMPROMISED_KEY_ID" \
     --start-time "$(date -u -d '24 hours ago' '+%Y-%m-%dT%H:%M:%SZ')" \
     --query 'Events[*].{Time:EventTime,User:Username,Event:EventName,Service:EventSource,Error:ErrorCode}' \
     --output table
   ```

5. **Rotate Application Secrets in AWS Secrets Manager:**
   Rotate DB passwords, JWT signing keys, and webhook secrets:
   ```bash
   aws secretsmanager rotate-secret --secret-id "vesting/production/db-master-password"
   aws secretsmanager rotate-secret --secret-id "vesting/production/jwt-rs256-key"
   ```
   Follow [secrets-management.md](./secrets-management.md) for verification.

---

## 6. Scenario 4: Smart Contract Exploit — Emergency Response Steps

**Applies to:** On-chain vulnerability discovery, reentrancy bug, unexpected clawback, or token drain.  
**Targets:** RTO: **1 hour** | RPO: **0**  
**Detailed mechanics:** See [emergency-contract-upgrade.md](./emergency-contract-upgrade.md)

### Detailed Step-by-Step Procedure:

1. **Stop the Bleeding (Halt Write-Path Services):**
   Immediately scale the backend API and indexer to zero to stop transaction generation and prevent user interactions with the vulnerable contract:
   ```bash
   aws ecs update-service --cluster prod-vesting --service vesting-backend --desired-count 0
   aws ecs update-service --cluster prod-vesting --service vesting-indexer --desired-count 0
   ```

2. **Revoke and Rotate Deployer and Admin Stellar Keys:**
   If the exploit was caused by key leakage, remove signer authority via the Stellar network and rotate deployer secrets:
   ```bash
   stellar keys rm deployer --network mainnet
   ```

3. **Assess Impact via Indexer Database:**
   Query the indexer database to quantify stolen funds, affected stream IDs, and sponsor accounts:
   ```sql
   SELECT token, sum(remaining_amount) AS locked_value, count(*) AS active_streams
   FROM vesting_schedules
   WHERE status = 'ACTIVE'
   GROUP BY token;
   ```

4. **Emergency Contract Upgrade Deployment:**
   - If contract is upgradeable via admin key, execute emergency WASM installation:
     ```bash
     # 1. Build and verify patched WASM
     cargo build --target wasm32-unknown-unknown --release
     WASM_HASH=$(stellar contract install --wasm target/wasm32-unknown-unknown/release/vesting_cliff_drip_stream.wasm --source deployer --network mainnet)

     # 2. Invoke contract upgrade function
     stellar contract invoke \
       --id "$VESTING_CONTRACT_ID" \
       --source admin \
       --network mainnet \
       -- upgrade \
       --new_wasm_hash "$WASM_HASH"
     ```
   - If contract admin key is compromised or contract code cannot be upgraded, coordinate with token issuers to invoke Stellar Asset Contract (SAC) administrative clawback or pause functions if applicable.

5. **Deploy Fix & Resume Services:**
   - Restart backend and indexer ECS services:
     ```bash
     aws ecs update-service --cluster prod-vesting --service vesting-backend --desired-count 2
     aws ecs update-service --cluster prod-vesting --service vesting-indexer --desired-count 1
     ```
   - Verify health probe: `curl -sf https://api.vesting.example.com/health`.

---

## 7. Outage Communication Templates

Use these pre-approved communication templates to maintain transparency with stakeholders and users during an outage.

### Template A: Initial Outage Notification (Status Page / Public Alert)
> **Headline:** [Investigating] Degraded Performance & Temporary Outage on Vesting Drip Stream  
> **Posted within:** 15 minutes of incident declaration  
> **Channels:** Status Page, Discord `#announcements`, X/Twitter `@VestingDripsOps`
>
> **Message:**  
> We are currently investigating an issue impacting the Vesting Cliff Drip Stream application and API services. Our engineering team has been alerted and is actively working on resolving the situation. 
> 
> - **Current Status:** Critical services temporarily paused to safeguard user funds and data integrity.
> - **User Impact:** Vesting stream creation and claims may be temporarily inaccessible. Existing locked smart contract funds are safe.
> - **Next Update:** Within 30 minutes.

### Template B: Mid-Incident Progress Update (Every 30–60 Minutes)
> **Headline:** [In Progress] Disaster Recovery In Progress for Vesting Drip Stream  
> **Channels:** Status Page, Slack `#external-status`
>
> **Message:**  
> Our engineering team is continuing to execute our disaster recovery procedures. We have identified the cause as **[AWS Regional Outage / Database Synchronization Issue / Infrastructure Incident]** and are actively restoring services in accordance with our recovery protocol.
> 
> - **Remediation Underway:** **[Promoting secondary database / Re-routing network traffic / Replaying event indexer]**.
> - **Estimated Time to Recovery:** Within **[30/60/90]** minutes.
> - Next status report at **[HH:MM UTC]**.

### Template C: Incident Resolution & Recovery Complete
> **Headline:** [Resolved] Vesting Drip Stream Services Fully Operational  
> **Channels:** Status Page, Community Discord, Socials
>
> **Message:**  
> All services have been fully restored and validated. End-to-end health checks and smart contract verification have concluded successfully.
> 
> - **Summary of Incident:** Between **[Start Time UTC]** and **[End Time UTC]**, users experienced service interruption due to **[Brief description]**.
> - **Impact Assessment:** **[Zero loss of funds / All stream claims recorded accurately / Indexer backfilled]**.
> - **Post-Mortem:** A full incident post-mortem with preventative action items will be published within 72 hours.
> 
> Thank you for your patience and support.

---

## 8. Annual Tabletop Exercise & Verification Protocol

Per technical compliance guidelines, this Disaster Recovery runbook **must be tested annually** via a simulated tabletop exercise.

### Tabletop Exercise Steps:
1. **Scenario Selection:** Rotate scenarios yearly (Year 1: Region failure, Year 2: PITR corruption, Year 3: Key compromise).
2. **Simulation:** Walk through commands in a staged environment (`staging`).
3. **Timing:** Measure the time required for each step and compare against the RTO budget.
4. **Documentation:** Record gaps, update outdated commands/ARNs, and log the drill in the post-mortem record.

### Post-Drill Record:
```markdown
Date of Drill: ____________________
Incident Commander: ____________________
Simulated Scenario: ____________________
Achieved RTO: ________ (Target RTO: ________)
Gaps Identified: 
- 
Action Items & Tickets:
- 
Sign-off: Lead SRE [       ]  Security Lead [       ]
```
