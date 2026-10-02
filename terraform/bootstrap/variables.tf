variable "environment" {
  description = "Environment whose remote state is being bootstrapped (staging, production)."
  type        = string

  validation {
    condition     = contains(["staging", "production"], var.environment)
    error_message = "environment must be either \"staging\" or \"production\"."
  }
}

variable "aws_region" {
  description = "AWS region hosting the state bucket and lock table."
  type        = string
  default     = "us-east-1"
}

variable "state_version_retention" {
  description = "Minimum number of noncurrent S3 object versions kept for the Terraform state file. S3 versioning itself never caps the number of versions, so this lifecycle rule is what bounds history: S3 expires a noncurrent version only once both this many newer versions exist and the version is older than state_version_max_age_days."
  type        = number
  default     = 30

  validation {
    condition     = var.state_version_retention >= 30
    error_message = "state_version_retention must be at least 30 so recent state history stays recoverable."
  }
}

variable "state_version_max_age_days" {
  description = "Maximum age in days of a retained noncurrent state version. S3 expires a noncurrent version when it is older than this value, so the bucket always keeps the most recent state_version_retention versions even inside a busy retention window."
  type        = number
  default     = 90

  validation {
    condition     = var.state_version_max_age_days >= 30
    error_message = "state_version_max_age_days must be at least 30 so recent state history stays recoverable."
  }
}

variable "additional_tags" {
  description = "Mandatory business tags (for example CostCenter and Owner) applied to the bootstrap resources."
  type        = map(string)
  default     = {}
}
