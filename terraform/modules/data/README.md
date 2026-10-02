# Module: data

Provisions the PostgreSQL RDS instance, Redis ElastiCache cluster, KMS encryption key, and SNS backup-failure alerting for the vesting-cliff-drip-stream backend.

---

## Requirements

| Name | Version |
|------|---------|
| terraform | >= 1.3 |
| aws | >= 5.0 |

## Providers

| Name | Version |
|------|---------|
| aws | >= 5.0 |

## Resources

| Name | Type |
|------|------|
| [aws_db_subnet_group.main](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/db_subnet_group) | resource |
| [aws_kms_key.postgres](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/kms_key) | resource |
| [aws_kms_alias.postgres](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/kms_alias) | resource |
| [aws_sns_topic.backup_failure](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/sns_topic) | resource |
| [aws_sns_topic_subscription.backup_failure_email](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/sns_topic_subscription) | resource |
| [aws_db_instance.postgres](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/db_instance) | resource |
| [aws_db_event_subscription.backup_failure](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/db_event_subscription) | resource |
| [aws_elasticache_subnet_group.main](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/elasticache_subnet_group) | resource |
| [aws_elasticache_cluster.redis](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/elasticache_cluster) | resource |

## Inputs

| Name | Description | Type | Default | Required |
|------|-------------|------|---------|----------|
| `environment` | Deployment environment name (e.g. `staging`, `production`) | `string` | — | yes |
| `vpc_id` | ID of the VPC | `string` | — | yes |
| `private_subnet_ids` | List of private subnet IDs for RDS and ElastiCache | `list(string)` | — | yes |
| `db_password` | Master password for the PostgreSQL instance. **Sensitive — use a secrets manager.** | `string` | — | yes |
| `backup_retention_days` | Number of days automated RDS backups and PITR transaction logs are retained | `number` | `35` | no |
| `backup_failure_emails` | Email addresses to notify on RDS backup or failure events | `set(string)` | `[]` | no |

## Outputs

| Name | Description |
|------|-------------|
| `db_endpoint` | Connection endpoint for the PostgreSQL RDS instance |
| `db_port` | Port the PostgreSQL instance listens on (default `5432`) |
| `redis_endpoint` | Connection endpoint for the Redis ElastiCache cluster |

## Usage Example

```hcl
module "data" {
  source = "./modules/data"

  environment        = "production"
  vpc_id             = module.network.vpc_id
  private_subnet_ids = module.network.private_subnet_ids
  db_password        = var.db_password

  backup_retention_days = 35
  backup_failure_emails = ["ops@example.com"]
}
```

> **Security:** `db_password` is marked `sensitive = true`. Pass it via an environment variable
> (`TF_VAR_db_password`) or a secrets backend such as AWS Secrets Manager. Never commit plaintext
> passwords to version control.
>
> **Deletion protection:** `aws_db_instance.postgres` has `deletion_protection = true`. You must
> disable this manually in the AWS Console before running `terraform destroy`.
