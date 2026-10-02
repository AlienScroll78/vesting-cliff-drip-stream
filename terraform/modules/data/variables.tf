variable "environment"       {}
variable "vpc_id"            {}
variable "private_subnet_ids" { type = list(string) }
variable "db_password"       { sensitive = true }

variable "db_instance_class" {
  description = "RDS instance class. db.t3.micro is used in testnet/staging, db.t3.small in production."
  type        = string
  default     = "db.t3.micro"
}

variable "backup_retention_days" {
  description = "Number of days automated backups and PITR transaction logs are retained."
  type        = number
  default     = 35
}

variable "backup_failure_emails" {
  description = "Email recipients for RDS backup/failure events."
  type        = set(string)
  default     = []
}
