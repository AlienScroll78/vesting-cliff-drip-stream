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
- AWS CLI configured with appropriate credentials
- S3 bucket `vesting-tf-state` created (see bootstrap instructions below)
- DynamoDB table `vesting-tf-locks` (auto-created on first apply)

## Bootstrap (first-time setup)

These steps are only needed once per AWS account:

```bash
# 1. Create the S3 state bucket
aws s3 mb s3://vesting-tf-state --region us-east-1
aws s3api put-bucket-versioning \
  --bucket vesting-tf-state \
  --versioning-configuration Status=Enabled
aws s3api put-public-access-block \
  --bucket vesting-tf-state \
  --public-access-block-configuration \
    BlockPublicAcls=true,BlockPublicPolicy=true,IgnorePublicAcls=true,BlockPublicPolicy=true

# 2. Create the DynamoDB state lock table
aws dynamodb create-table \
  --table-name vesting-tf-locks \
  --attribute-definitions AttributeName=LockID,AttributeType=S \
  --key-schema AttributeName=LockID,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST \
  --region us-east-1

# 3. Initialize Terraform with remote state
terraform init -backend-config="bucket=vesting-tf-state" \
               -backend-config="key=vesting/terraform.tfstate" \
               -backend-config="region=us-east-1" \
               -backend-config="dynamodb_table=vesting-tf-locks"
```

## Usage

```bash
# Staging
terraform workspace new staging 2>/dev/null || true
terraform workspace select staging
terraform plan -var-file="envs/staging.tfvars" -var="db_password=$(aws secretsmanager get-secret-value --secret-id vesting/staging/db-password --query SecretString --output text)"
terraform apply -var-file="envs/staging.tfvars" -var="db_password=$(...)"

# Production
terraform workspace new production 2>/dev/null || true
terraform workspace select production
terraform plan -var-file="envs/production.tfvars" -var="db_password=$(aws secretsmanager get-secret-value --secret-id vesting/production/db-password --query SecretString --output text)"
terraform apply -var-file="envs/production.tfvars" -var="db_password=$(...)"
```

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
| S3 bucket | `vesting-tf-state` | Versioning enabled, public access blocked |
| DynamoDB table | `vesting-tf-locks` | Pay-per-request, LockID hash key |
| State key | `vesting/terraform.tfstate` | Shared across workspaces |

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
- S3 state bucket has public access blocked and versioning enabled

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
