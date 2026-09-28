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
