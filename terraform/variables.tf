variable "environment" {
  default = "staging"
}

variable "aws_region" {
  default = "us-east-1"
}

variable "db_password" {
  sensitive = true
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
