# Terraform — Vesting Cliff Drip Stream

This directory contains the Terraform configuration for provisioning all cloud
infrastructure required by the vesting application.

## Architecture

```
                    ┌─────────────────────────────┐
                    │     Route53 (DNS)            │
                    │  api.vesting.example.com      │
                    └──────────┬──────────────────┘
                               │
                    ┌──────────▼──────────────────┐
                    │   ALB (Application LB)       │
                    └──────────┬──────────────────┘
                               │
              ┌────────────────┼────────────────┐
              │                │                │
    ┌─────────▼──────┐  ┌─────▼──────┐  ┌──────▼─────────┐
    │  ECS Fargate   │  │  RDS       │  │  ElastiCache    │
    │  (backend API) │  │  PostgreSQL│  │  Redis          │
    └────────────────┘  └────────────┘  └─────────────────┘
```

## Modules

| Module  | Description | Resources |
|---------|-------------|-----------|
| `network` | VPC, subnets, NAT gateways, route tables, internet gateway | 10+ |
| `compute` | ECS cluster, Fargate task definition, service, ALB, IAM | 8 |
| `data` | RDS PostgreSQL, ElastiCache Redis, KMS, SNS backup alerts | 10+ |
| `dns` | Route53 hosted zone, A/CNAME records for API and app | 3+ |

## Environments

| Environment | Variables file | Domain | Monthly budget |
|-------------|---------------|--------|---------------|
| staging | `envs/staging.tfvars` | `staging.vesting.example.com` | $250 |
| production | `envs/production.tfvars` | `vesting.example.com` | $1,500 |

## Prerequisites

- Terraform >= 1.6, < 2.0
- AWS CLI v2 with credentials that may create the state bucket and lock table (bootstrap only)
- Remote state bootstrapped per environment with `terraform/bootstrap/init.sh` (see
  [docs/runbooks/terraform-bootstrap.md](../docs/runbooks/terraform-bootstrap.md))

## Backend layout

Every environment has its own bucket, state key, and lock table. The backend block in `main.tf` is
partial; the values come from the per-environment file passed to `terraform init`.

| Environment | State bucket | State key | Lock table | Backend config |
|-------------|--------------|-----------|------------|----------------|
| staging | `vestingdrips-terraform-state-staging` | `staging/terraform.tfstate` | `vestingdrips-terraform-locks-staging` | `envs/staging.backend.hcl` |
| production | `vestingdrips-terraform-state-production` | `production/terraform.tfstate` | `vestingdrips-terraform-locks-production` | `envs/production.backend.hcl` |

## Bootstrap (first-time setup, once per environment)

```bash
cd bootstrap

# 1. Plan the state bucket and lock table (nothing is created without --apply).
./init.sh staging

# 2. Apply the reviewed plan, then verify encryption, versioning, access block and lock table.
./init.sh staging --apply

# 3. Optionally enable MFA delete on the state bucket (interactive; requires a fresh MFA code).
BOOTSTRAP_MFA_SERIAL='arn:aws:iam::<ACCOUNT_ID>:mfa/<USER_NAME>' ./init.sh staging --enable-mfa-delete

# 4. Point this root module at the new backend.
./init.sh staging --backend-only
```

Repeat for `production`. Migration from an older backend, stale-lock handling, state recovery and MFA
delete are documented in [docs/runbooks/terraform-bootstrap.md](../docs/runbooks/terraform-bootstrap.md).

## Usage

Each environment needs its own `TF_DATA_DIR` so two backend configurations never share a working
directory. `init.sh` sets this automatically.

```bash
# Staging
export TF_DATA_DIR="$PWD/.terraform/staging"
terraform init -input=false -backend-config=envs/staging.backend.hcl
terraform plan -lock-timeout=5m -var-file=envs/staging.tfvars \
  -var="db_password=$(aws secretsmanager get-secret-value --secret-id vesting/staging/db-password --query SecretString --output text)"
terraform apply -lock-timeout=5m -var-file=envs/staging.tfvars \
  -var="db_password=$(...)"

# Production
export TF_DATA_DIR="$PWD/.terraform/production"
terraform init -input=false -backend-config=envs/production.backend.hcl
terraform plan -lock-timeout=5m -var-file=envs/production.tfvars \
  -var="db_password=$(aws secretsmanager get-secret-value --secret-id vesting/production/db-password --query SecretString --output text)"
terraform apply -lock-timeout=5m -var-file=envs/production.tfvars \
  -var="db_password=$(...)"
```

There are no Terraform workspaces: the environment is selected by the backend file and the tfvars
file, and `var.environment` rejects any value other than `staging` or `production`.

## CI/CD

- **Pull requests**: `terraform plan` runs automatically. The plan output is
  posted as a PR comment (see `.github/workflows/ci.yml`).
- **Apply to staging**: Automatic on merge to `main` via
  `.github/workflows/staging.yml`.
- **Apply to production**: Manual approval required. Triggered via
  `workflow_dispatch`.

## State Management

| Component | Location | Notes |
|-----------|----------|-------|
| S3 bucket (staging) | `vestingdrips-terraform-state-staging` | AES-256, versioning, public access blocked, ownership controls, lifecycle keeps the latest 30 noncurrent versions |
| S3 bucket (production) | `vestingdrips-terraform-state-production` | Same controls; MFA delete enabled out-of-band |
| DynamoDB table (staging) | `vestingdrips-terraform-locks-staging` | Pay-per-request, `LockID` hash key |
| DynamoDB table (production) | `vestingdrips-terraform-locks-production` | Same; required by the drift-detection role |
| State key | `staging/terraform.tfstate`, `production/terraform.tfstate` | One key per environment, no workspaces |
| Bootstrap state | `bootstrap/.terraform/<env>/terraform.tfstate` | Local by design; back it up, never commit it |

## Provider Versions

| Provider | Version | Notes |
|----------|---------|-------|
| hashicorp/aws | ~> 5.80 | Pinned to prevent breaking changes |
| hashicorp/random | ~> 3.6 | Used for resource naming |

## Security

- `db_password` is marked `sensitive = true` and never displayed in plan/apply
  output
- All database and Redis endpoints are marked `sensitive = true` in outputs
- RDS storage is encrypted with a customer-managed KMS key
- RDS deletion protection is enabled
- State buckets use AES-256 encryption, block all public access, enforce
  bucket-owner ownership, and keep versioned history
- State buckets use MFA delete, enabled interactively by an operator
  (`bootstrap/init.sh --enable-mfa-delete`); no MFA code is ever stored
  in code, CI, or documentation. See
  [docs/runbooks/terraform-bootstrap.md](../docs/runbooks/terraform-bootstrap.md)

## Estimated Monthly Cost

| Service | Configuration | Staging | Production |
|---------|--------------|---------|------------|
| ECS Fargate | 256 CPU / 512 MB, 1 task | ~$10 | ~$35 (3 tasks) |
| ALB | 1 LB, idle timeout 60s | ~$22 | ~$22 |
| RDS PostgreSQL | db.t3.micro, 20GB gp2 | ~$17 | ~$70 (db.t3.small, HA) |
| ElastiCache Redis | cache.t3.micro, 1 node | ~$14 | ~$28 (cache.t3.small, 2 nodes) |
| NAT Gateway | 2 AZ | ~$64 | ~$64 |
| Route53 | 1 hosted zone + 3 records | ~$1 | ~$1 |
| S3 (state + audit) | Versioning enabled | ~$2 | ~$3 |
| CloudWatch Logs | Container + RDS logs | ~$5 | ~$15 |
| KMS | 1 customer key | ~$1 | ~$1 |
| **Total** | | **~$136/mo** | **~$239/mo** |

> Costs are estimates for us-east-1 as of July 2026. Actual costs may vary
> based on data transfer, storage consumption, and request volume.
> Use AWS Cost Explorer and the budget alerts in `cost-monitoring.tf` to track
> actual spending.
