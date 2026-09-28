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
