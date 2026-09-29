# Runbook: Terraform Drift Reconciliation

**Trigger:** A GitHub issue labelled `infrastructure` + `drift` has been opened by the automated
[drift-detection workflow](../../.github/workflows/drift-detection.yml), and a Slack notification
has been sent to `#ops`.

---

## Overview

Infrastructure drift occurs when the live AWS state diverges from the Terraform configuration — for
example, a resource is created, modified, or deleted directly in the AWS console or via the CLI
without a corresponding code change. Left unresolved, drift erodes confidence in the Terraform state
and can cause future `apply` runs to produce unexpected changes.

Every drift event must be triaged and resolved within **one business day**. The resolution is either:

1. **Reject the drift** — revert the manual change by running `terraform apply` (the config is
   authoritative).
2. **Accept the drift** — codify the manual change in Terraform so the state converges.
3. **Escalate** — the drift requires a change-management decision or emergency override.

---

## Step 1 — Acknowledge

1. React to the Slack message in `#ops` with 👀 to signal you are investigating.
2. Assign the GitHub issue to yourself.
3. Record the start time in the issue comments.

---

## Step 2 — Review the Plan Output

The full `terraform plan` output is attached to the GitHub issue and uploaded as a CI artifact
(`drift-plan-<run-id>`) retained for 90 days.

Key things to look for:

| Signal | Interpretation |
|--------|---------------|
| `~ resource "aws_ecs_service"` | ECS service config changed (desired count, task definition, etc.) |
| `+ resource "aws_security_group_rule"` | New ingress/egress rule added manually |
| `- resource "aws_route53_record"` | DNS record deleted manually |
| `~ aws_iam_role_policy` | IAM policy modified out-of-band |

Download the artifact to inspect locally:

```bash
# Replace <run-id> with the value from the GitHub issue
gh run download <run-id> --name drift-plan-<run-id>
cat drift-plan-<run-id>/drift-plan.txt
```

---

## Step 3 — Classify the Drift

Answer these questions before deciding:

1. **Was this intentional?** Ask the team in `#ops` or check recent AWS CloudTrail events:
   ```bash
   aws cloudtrail lookup-events \
     --lookup-attributes AttributeKey=EventSource,AttributeValue=ec2.amazonaws.com \
     --start-time "$(date -u -d '25 hours ago' '+%Y-%m-%dT%H:%M:%SZ')" \
     --query 'Events[*].{Time:EventTime,User:Username,Event:EventName,Resource:Resources[0].ResourceName}' \
     --output table
   ```
   Substitute the relevant service (e.g. `ecs.amazonaws.com`, `rds.amazonaws.com`).

2. **Is the live state correct or incorrect?** Compare against the last known good deploy.

3. **What is the blast radius of reverting?** A changed ECS desired-count is low-risk; a deleted
   security group rule may have been intentional for an incident mitigation.

---

## Step 4 — Resolve the Drift

### Option A — Reject (revert the manual change)

Run `terraform apply` to bring live state back in line with configuration. This is the default
preference when the change was accidental or undocumented.

```bash
cd terraform

# Always plan first — confirm only the drifted resource is in scope
terraform plan \
  -var-file=envs/production.tfvars \
  -out=reconcile.tfplan

# Review the plan carefully, then apply
terraform apply reconcile.tfplan
```

Verify the apply succeeded and no errors were reported.

### Option B — Accept (codify the change)

When the manual change was intentional and correct, update the Terraform configuration to match,
then apply to reconcile state.

1. Edit the relevant `.tf` file(s) to reflect the live state.
2. Run `terraform plan` to confirm the diff collapses to zero changes:
   ```bash
   terraform plan -var-file=envs/production.tfvars -detailed-exitcode
   # Expected exit code: 0 (no changes)
   ```
3. Commit the change with a message referencing the drift issue:
   ```
   fix(terraform): codify manual change to <resource> (resolves #<issue-number>)
   ```
4. Open a pull request and get it reviewed before merging to main.

### Option C — Partial acceptance

Some resources may need to be accepted while others are reverted. Use `-target` to limit scope:

```bash
# Revert only the drifted ECS service, leave other changes untouched
terraform apply \
  -var-file=envs/production.tfvars \
  -target=module.compute.aws_ecs_service.backend
```

Use `-target` sparingly; it can create partial state. Ensure a clean plan (exit 0) is achieved
before closing the issue.

---

## Step 5 — Verify

After applying:

```bash
# Confirm plan now shows no changes
terraform plan \
  -detailed-exitcode \
  -var-file=envs/production.tfvars \
  -no-color 2>&1 | tail -5
# Expected: "No changes. Your infrastructure matches the configuration."
```

Run the application smoke test to confirm the service is healthy:

```bash
curl -sf https://api.vesting.example.com/healthz
```

---

## Step 6 — Close the Issue

Add a comment to the GitHub issue with:

- Root cause (what caused the drift)
- Resolution chosen (reject / accept / partial)
- Any follow-up actions (e.g. add a change-management gate, improve alerting)

Close the issue with the label `resolved`.

Post a brief update in `#ops`:

```
:white_check_mark: Drift resolved. Root cause: <brief description>. Resolution: <reject|accept|partial>. Ref: #<issue-number>
```

---

## Escalation

| Condition | Action |
|-----------|--------|
| Drift is in a security-sensitive resource (IAM, SGs, KMS) | Page the security lead immediately via PagerDuty |
| Drift cannot be safely reverted without downtime | Follow [emergency override procedure](./emergency-override.md) |
| Drift recurs more than twice in one week for the same resource | Open a separate ticket to add a preventative control (AWS Config rule, SCP, or Terraform sentinel policy) |
| Drift cause is unknown after 2 hours of investigation | Escalate to IC in `#incidents` |

---

## Appendix — Useful Commands

```bash
# Show current state of a specific resource
terraform state show module.compute.aws_ecs_service.backend

# List all resources tracked in state
terraform state list

# Pull remote state to local for inspection (read-only)
terraform state pull > /tmp/current-state.json

# Check CloudTrail for who made a change
aws cloudtrail lookup-events \
  --lookup-attributes AttributeKey=ResourceName,AttributeValue=<resource-id> \
  --start-time "$(date -u -d '48 hours ago' '+%Y-%m-%dT%H:%M:%SZ')"
```
