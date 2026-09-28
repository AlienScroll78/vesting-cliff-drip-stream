variable "environment" {
  description = "Deployment environment (staging, production)"
  type        = string
  default     = "staging"
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

variable "db_password" {
  description = "Master password for the PostgreSQL RDS instance"
  type        = string
  sensitive   = true
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
  description = "Email recipients for budget and Cost Explorer anomaly alerts."
  type        = set(string)
}

variable "slack_webhook_url" {
  description = "Slack incoming webhook URL for cost alert relay to #ops channel."
  type        = string
  sensitive   = true
}

# ─── Log aggregation ──────────────────────────────────────────────────────────

variable "application_log_retention_days" {
  description = "Retention for application log groups (/ecs/api-server, /ecs/indexer)."
  type        = number
  default     = 90
}

variable "audit_log_retention_days" {
  description = "Retention for audit and access log groups (/rds/postgresql)."
  type        = number
  default     = 365
}

variable "log_alert_emails" {
  description = <<-EOT
    Email recipients for the logging alarm. Left empty by default so that the
    error-burst alarm reaches PagerDuty only, and the noise of a resolved page
    does not also land in a mailbox.
  EOT
  type        = set(string)
  default     = []
}

variable "error_alarm_threshold" {
  description = "ERROR log events in a 5-minute period that trigger the paging alarm."
  type        = number
  default     = 10
}

variable "app_log_level" {
  description = "Minimum level the application logger emits: debug, info, warn or error."
  type        = string
  default     = "info"
}

variable "pagerduty_integration_key" {
  description = <<-EOT
    PagerDuty "Amazon SNS" integration key, from the integration's URL in
    PagerDuty. Empty disables the PagerDuty subscription, which leaves the alarm
    publishing to a topic with no subscribers -- useful for first bring-up.

    The key is embedded in the subscription endpoint, so it is stored in
    Terraform state. Rotate it if the state bucket is ever exposed.
  EOT
  type        = string
  sensitive   = true
  default     = ""
}
