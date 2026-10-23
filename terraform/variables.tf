variable "environment" {
  description = "Deployment environment (staging, production)"
  type        = string
  default     = "staging"

  validation {
    condition     = contains(["staging", "production"], var.environment)
    error_message = "environment must be either \"staging\" or \"production\" so the matching remote backend (envs/<environment>.backend.hcl) and tfvars file are always used."
  }
}

variable "aws_region" {
  description = "AWS region for all resources"
  type        = string
  default     = "us-east-1"
}

variable "domain_name" {
  description = "DNS domain name for the application (e.g. vesting.example.com)"
  type        = string
  default     = "vesting.example.com"
}

variable "waf_rate_limit" {
  description = "Requests per IP allowed during the WAF five-minute evaluation window"
  type        = number
  default     = 1000
}

variable "waf_sanctioned_country_codes" {
  description = "ISO country codes blocked by the WAF geo rule"
  type        = list(string)
  default     = ["AF", "BY", "CU", "IR", "KP", "LY", "MM", "RU", "SD", "SS", "SY", "VE", "YE", "ZW"]
}

variable "waf_log_retention_days" {
  description = "Retention period for WAF decision logs"
  type        = number
  default     = 90
}

variable "db_password" {
  description = "Master password for the PostgreSQL RDS instance"
  type        = string
  sensitive   = true
}

variable "project_name" {
  description = "Cost allocation tag value applied to every resource and activated in Cost Explorer."
  type        = string
  default     = "vesting-drips"
}

variable "additional_tags" {
  description = "Mandatory business tags (for example CostCenter and Owner) applied to every supported AWS resource."
  type        = map(string)
  default     = {}
}

variable "monthly_budget_limit_usd" {
  description = "Monthly AWS cost budget in USD."
  type        = number
  default     = 250
}

variable "cost_alert_emails" {
  description = "Email recipients for budget, cost anomaly and secret rotation alerts."
  type        = set(string)
  default     = []
}

variable "deployment_alert_emails" {
  description = "Email recipients for CodeDeploy lifecycle notifications."
  type        = set(string)
  default     = []
}

variable "slack_webhook_url" {
  description = "Bootstrap Slack incoming webhook for the alert relay. Applied once, then managed in AWS Secrets Manager."
  type        = string
  sensitive   = true
}

variable "db_password_rotation_days" {
  description = "Days between automatic PostgreSQL master password rotations."
  type        = number
  default     = 30
}

variable "soroban_rpc_api_key" {
  description = "Optional Soroban RPC API key. When empty a random placeholder is stored in Secrets Manager."
  type        = string
  default     = ""
  sensitive   = true
}

variable "sentry_dsn" {
  description = "Optional Sentry DSN. When empty a random placeholder is stored in Secrets Manager."
  type        = string
  default     = ""
  sensitive   = true
}

variable "db_instance_class" {
  description = "RDS instance class. db.t3.micro for testnet/staging, db.t3.small for production."
  type        = string
  default     = "db.t3.micro"
}

# ─── Variables referenced by logging.tf ──────────────────────────────────────

variable "application_log_retention_days" {
  description = "Retention period for application (ECS) CloudWatch log groups."
  type        = number
  default     = 90
}

variable "audit_log_retention_days" {
  description = "Retention period for audit and RDS CloudWatch log groups."
  type        = number
  default     = 365
}

variable "log_alert_emails" {
  description = "Email recipients for application logging alerts (error bursts)."
  type        = set(string)
  default     = []
}

variable "error_alarm_threshold" {
  description = "Number of ERROR-level log events in 5 minutes that triggers an alarm."
  type        = number
  default     = 10
}

# ─── Variables referenced by backup-verification.tf ──────────────────────────

variable "pagerduty_integration_key" {
  description = "PagerDuty Events API v2 integration key. When empty, PagerDuty subscriptions are skipped."
  type        = string
  default     = ""
  sensitive   = true
}

variable "backup_restore_test_class" {
  description = "RDS instance class for the temporary restore-test instance. Defaults to db.t3.micro to minimise cost; use a larger class if the restore SLA requires it."
  type        = string
  default     = "db.t3.micro"
}

variable "backup_verify_alert_emails" {
  description = "Email addresses that receive backup-restore verification pass/fail alerts."
  type        = set(string)
  default     = []
}

# ─── Variables for CloudWatch production alarms (#1094) ──────────────────────

variable "alarm_cpu_threshold_pct" {
  description = "ECS service CPU utilization percentage that triggers an alarm."
  type        = number
  default     = 80
}

variable "alarm_rds_cpu_threshold_pct" {
  description = "RDS CPU utilization percentage that triggers an alarm."
  type        = number
  default     = 70
}

variable "alarm_rds_storage_free_gb" {
  description = "RDS free storage in GB below which an alarm fires."
  type        = number
  default     = 4
}

variable "alarm_alb_5xx_rate_pct" {
  description = "ALB 5xx response rate percentage that triggers an alarm."
  type        = number
  default     = 1
}

variable "alarm_indexer_lag_ledgers" {
  description = "Indexer lag in ledgers above which an alarm fires."
  type        = number
  default     = 100
}

# ─── CloudFront variables (#1092) ────────────────────────────────────────────

variable "cloudfront_price_class" {
  description = "CloudFront price class: PriceClass_100 (NA+EU), PriceClass_200 (+Asia), PriceClass_All."
  type        = string
  default     = "PriceClass_100"
}

variable "cloudfront_acm_certificate_arn" {
  description = "ACM certificate ARN in us-east-1 for the CloudFront custom domain. Must be in us-east-1."
  type        = string
  default     = ""
}
