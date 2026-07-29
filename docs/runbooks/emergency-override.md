# Runbook: Emergency Infrastructure Override

Use this procedure when you must make a manual infrastructure change **immediately** — for example,
to mitigate an active incident — and there is no time to go through the normal Terraform PR
workflow. This is an exception, not a routine path.

---

## When is an override justified?

An emergency override is justified when **all** of the following are true:

1. An active production incident is in progress (declared in `#incidents`).
2. The required change cannot wait for a CI pipeline run (estimated > 15 minutes).
3. The change is well-understood and the risk of *not* making it exceeds the risk of making it
   manually.

If these conditions are not met, use the standard PR → plan → apply workflow.

---

## Required Approvals

| Condition | Required approver |
|-----------|------------------|
| Any emergency override | Incident Commander (IC) verbal/Slack approval, logged in `#incidents` |
| Security-sensitive resources (IAM, SGs, KMS, Secrets Manager) | IC + Security Lead |
| Data-plane resources (RDS, S3 bucket policies) | IC + Database/Data Lead |

Log the approval with a Slack message in `#incidents` **before** making the change:

```
:rotating_light: Emergency override requested by @<your-handle>
Resource: <resource type and identifier>
Change: <brief description of what and why>
Approved by: @<IC-handle> at HH:MM UTC
```

---

## Procedure

### 1. Assume the break-glass role

The emergency override IAM role grants write access. It is distinct from the read-only drift
detection role and should not be assumed during normal operations.

```bash
# Assumes you have the AWS CLI configured with a profile that can assume the role.
aws sts assume-role \
  --role-arn arn:aws:iam::ACCOUNT_ID:role/vesting-emergency-override \
  --role-session-name "emergency-$(date +%Y%m%dT%H%M)" \
  --duration-seconds 3600 \
  --query 'Credentials.[AccessKeyId,SecretAccessKey,SessionToken]' \
  --output text

export AWS_ACCESS_KEY_ID=<AccessKeyId>
export AWS_SECRET_ACCESS_KEY=<SecretAccessKey>
export AWS_SESSION_TOKEN=<SessionToken>
```

Role assumption is automatically logged to CloudTrail.

### 2. Make the minimum necessary change

Change only what is required to resolve the incident. Avoid scope creep.

```bash
# Example: scale up ECS desired count during a traffic spike
aws ecs update-service \
  --cluster vesting-prod \
  --service vesting-backend \
  --desired-count 4

aws ecs wait services-stable \
  --cluster vesting-prod \
  --services vesting-backend
```

### 3. Document the change immediately

While the change is fresh, record the following in the `#incidents` Slack thread **and** in a
comment on the associated GitHub incident issue (if one exists):

```
Emergency override applied at <HH:MM UTC>
Resource: <resource type and identifier>
Change made: <exact CLI command or console action>
Reason: <why this was necessary>
Reverting by: <how and when it will be undone or codified>
```

### 4. Verify the incident is mitigated

```bash
# Application health check
curl -sf https://api.vesting.example.com/healthz

# ECS service stability
aws ecs describe-services \
  --cluster vesting-prod \
  --services vesting-backend \
  --query 'services[0].{Status:status,Running:runningCount,Desired:desiredCount}'
```

### 5. Post-hoc Terraform update (required within 24 hours)

A manual change leaves the infrastructure in a drifted state. You **must** codify it within 24
hours of the incident being resolved.

1. Create a branch:
   ```bash
   git checkout -b fix/codify-emergency-override-$(date +%Y%m%d)
   ```

2. Edit the relevant `.tf` file(s) to match the live state. For example, if you changed
   `desired_count`:
   ```hcl
   # terraform/modules/compute/main.tf
   resource "aws_ecs_service" "backend" {
     # ...
     desired_count = 4   # Updated: emergency override 2026-07-26, incident #42
   }
   ```

3. Plan and confirm the diff is clean:
   ```bash
   cd terraform
   terraform plan \
     -var-file=envs/production.tfvars \
     -detailed-exitcode
   # Expected exit code: 0
   ```

4. Open a PR with the title:
   ```
   fix(terraform): codify emergency override from incident #<number>
   ```
   Include in the description:
   - Link to the Slack incident thread
   - Link to the GitHub incident issue
   - The exact change made and why

5. Merge after review. The next drift detection run should report no changes.

---

## If the manual change must be reverted

If the override was temporary (e.g. a traffic mitigation that is no longer needed), revert via
Terraform rather than another manual change:

```bash
cd terraform
terraform apply \
  -var-file=envs/production.tfvars \
  -target=<resource address>
```

This ensures the state file is updated correctly.

---

## Accountability and audit trail

Every emergency override is expected to produce:

| Artefact | Location | Deadline |
|----------|----------|---------|
| Slack approval message | `#incidents` thread | Before making the change |
| Post-hoc incident comment | GitHub incident issue or new issue | Within 1 hour |
| CloudTrail entry | AWS CloudTrail (automatic) | Immediate |
| Terraform PR codifying the change | GitHub | Within 24 hours of incident resolution |
| Post-mortem update (if applicable) | See [disaster-recovery.md](./disaster-recovery.md) | Within 48 hours |

Overrides that are not followed up with a Terraform PR within 24 hours will be flagged in the
next drift detection run and treated as unresolved drift.

---

## Preventing recurrence

After the incident is fully resolved, create a follow-up ticket to assess whether a control can
prevent the same type of emergency in the future:

- **Terraform automation** — Can the required change be triggered via `workflow_dispatch` on the
  Terraform apply workflow without manual CLI access?
- **AWS Config rule** — Can a Config rule alert on the condition that necessitated the override
  (e.g., ECS desired count below a threshold)?
- **Runbook gap** — If this scenario is not covered by an existing runbook, add it.
