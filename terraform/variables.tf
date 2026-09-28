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

variable "pagerduty_integration_key" {
  description = <<-EOT
    PagerDuty "Amazon SNS" integration key used to page on failed backup
    restore verification and on sustained log error bursts. Leave empty to
    create the topic without a PagerDuty subscription, which is useful in an
    environment where nobody should be paged.
  EOT
  type      = string
  sensitive = true
  default   = ""
}

variable "backup_restore_test_class" {
  description = <<-EOT
    Instance class for the throwaway database created by the weekly restore
    verification. Deliberately the smallest class that boots PostgreSQL: this
    instance exists to prove the snapshot restores and the data is queryable,
    and it is billed for the few minutes it is up.
  EOT
  type    = string
  default = "db.t3.micro"
}

variable "backup_verify_alert_emails" {
  description = "Email recipients for backup restore verification failures."
  type        = set(string)
  default     = []
}
