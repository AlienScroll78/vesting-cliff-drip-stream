variable "environment"        {}
variable "vpc_id"             {}
variable "private_subnet_ids" { type = list(string) }
variable "db_password"        { sensitive = true }
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
