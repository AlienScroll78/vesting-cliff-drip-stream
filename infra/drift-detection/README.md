# Drift Detection IAM

Files in this directory describe the GitHub Actions role used by
[`.github/workflows/drift-detection.yml`](../../.github/workflows/drift-detection.yml) to run
`terraform plan` read-only. They are **examples**: nothing here is applied by Terraform, and no AWS
account, role, or key material is committed.

| File | Purpose |
|------|---------|
| `iam-policy.json` | Permissions policy for the drift-detection role |
| `oidc-trust-policy.json` | Trust policy example restricting `sts:AssumeRoleWithWebIdentity` to this repository's OIDC token |

## Placeholders to substitute

| Placeholder | Replace with |
|-------------|--------------|
| `ACCOUNT_ID` | The AWS account ID that hosts the state buckets and lock tables |
| `GITHUB_REPO_OWNER` | Repository owner, e.g. the organisation or user name |
| `GITHUB_REPO_NAME` | Repository name, e.g. `vesting-cliff-drip-stream` |

Do not commit the substituted files with real account identifiers if that conflicts with your
repository policy; the workflow only needs the resulting role ARN as a secret.

## Setup

1. **Register the GitHub OIDC provider** in the target account (once per account):

   ```bash
   aws iam create-open-id-connect-provider \
     --url https://token.actions.githubusercontent.com \
     --client-id-list sts.amazonaws.com \
     --thumbprint-list 6938fd4d98bab03faadb97b34396831e3780aea1
   ```

2. **Create the role** and attach the trust policy. The trust policy matches the
   `environment:`-scoped subject, because the workflow runs in the `production` (or `staging`) GitHub
   environment and therefore receives a token with
   `repo:<OWNER>/<REPO>:environment:<env>` as its subject. Do not widen the condition to `repo:*` or
   add a `StringLike` pattern that matches other repositories.

   ```bash
   aws iam create-role \
     --role-name vesting-drift-detection \
     --assume-role-policy-document file://oidc-trust-policy.json
   ```

3. **Attach the permissions policy:**

   ```bash
   aws iam put-role-policy \
     --role-name vesting-drift-detection \
     --policy-name drift-detection \
     --policy-document file://iam-policy.json
   ```

4. **Set the role ARN as a secret on the GitHub environment** that the workflow targets, so each
   environment can use its own role:

   | Secret | Environment | Value |
   |--------|-------------|-------|
   | `AWS_DRIFT_DETECTION_ROLE_ARN` | `production`, `staging` | `arn:aws:iam::<ACCOUNT_ID>:role/vesting-drift-detection` |
   | `AWS_REGION` | `production`, `staging` | `us-east-1` |
   | `TF_VAR_DB_PASSWORD` | `production`, `staging` | Plan-only placeholder value for the RDS master password variable |
   | `TF_VAR_COST_ALERT_EMAILS` | `production`, `staging` | HCL list, e.g. `["ops@example.com"]` |
   | `TF_VAR_SLACK_WEBHOOK_URL` | `production`, `staging` | Slack incoming webhook used by the cost-monitoring Lambda |
   | `SLACK_WEBHOOK_URL` | `production`, `staging` | Slack incoming webhook bound to `#ops` for drift alerts |

5. **Create the `production` and `staging` GitHub environments** if they do not exist. If an
   environment has required reviewers configured, scheduled runs wait for approval; add
   `drift-detection` to the environment's deployment bypass list, or accept the daily approval.

## What the policy allows, and why

| Access | Reason |
|--------|--------|
| `s3:GetObject`, `s3:ListBucket`, `s3:GetBucketLocation`, `s3:GetBucketVersioning` on `vestingdrips-terraform-state-<env>` and `/*` | Read the remote state for `staging/terraform.tfstate` and `production/terraform.tfstate`; the state bucket write path stays closed |
| `dynamodb:GetItem`, `PutItem`, `DeleteItem`, `DescribeTable` on `vestingdrips-terraform-locks-<env>` | Acquire and release the Terraform state lock during `plan`; these are scoped to the lock tables and nothing else |
| Read-only `Describe*` / `List*` / `Get*` for EC2, ECS, RDS, ElastiCache, ELB, IAM, CloudWatch, Logs, KMS, SNS, Route 53, Cost Explorer, Budgets, Lambda, and the Resource Groups tagging API | The AWS provider refreshes every managed resource during `plan`; without these the plan fails with access errors rather than reporting drift |
| `secretsmanager:DescribeSecret`, `secretsmanager:ListSecrets` | Identify secrets by name during refresh without ever reading values |
| Explicit denies | Application resources (EC2, ECS, RDS, ElastiCache, IAM, ELB, Secrets Manager writes, S3 writes) and `secretsmanager:GetSecretValue` remain denied, so a compromised workflow cannot change or read production |

The `DenyDynamoDBApplicationWrites` statement uses `NotResource` for exactly this reason: the state
lock tables must accept `PutItem`/`DeleteItem` while every other DynamoDB table stays read-only.

## Verifying the role

```bash
# Dry-run the plan with the same permissions CI uses.
cd terraform
TF_DATA_DIR="$PWD/.terraform/production" terraform init -input=false -backend-config=envs/production.backend.hcl
TF_DATA_DIR="$PWD/.terraform/production" terraform plan -lock-timeout=5m -var-file=envs/production.tfvars

# The plan must be rejected by the policy if it tries to change anything.
aws sts get-caller-identity
```

If a plan fails with `AccessDenied` for a service that is not listed above, add the specific
`Describe*`/`Get*`/`List*` action the provider needs rather than a wildcard write action.

## Related

| Topic | Document |
|-------|----------|
| State bootstrap, migration, locks, recovery, MFA delete | [`docs/runbooks/terraform-bootstrap.md`](../../docs/runbooks/terraform-bootstrap.md) |
| Triaging detected drift | [`docs/runbooks/drift-reconciliation.md`](../../docs/runbooks/drift-reconciliation.md) |
