# ─── Secrets management ──────────────────────────────────────────────────────
#
# Application secrets live in AWS Secrets Manager and are delivered to ECS tasks
# through the task definition `secrets` field, never through environment
# variables. The database master password is the only value Terraform still has
# to own directly, because RDS needs an initial password to create the instance;
# it is generated here rather than supplied by CI so no bootstrap secret is ever
# stored in GitHub.

resource "random_password" "db" {
  length      = 40
  special     = false
  min_lower   = 1
  min_upper   = 1
  min_numeric = 1
}

module "secrets" {
  source = "./modules/secrets"

  environment = var.environment
  aws_region  = var.aws_region

  db_identifier = module.data.db_instance_id
  db_address    = module.data.db_address
  db_port       = module.data.db_port
  db_name       = module.data.db_name
  db_username   = "vesting"
  db_password   = random_password.db.result
  rotation_days = var.db_password_rotation_days

  slack_webhook_url   = var.slack_webhook_url
  soroban_rpc_api_key = var.soroban_rpc_api_key
  sentry_dsn          = var.sentry_dsn
  alert_emails        = var.cost_alert_emails
}
