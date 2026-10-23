output "state_bucket" {
  description = "S3 bucket holding the remote Terraform state."
  value       = aws_s3_bucket.state.id
}

output "state_key" {
  description = "Object key of the Terraform state file inside the state bucket."
  value       = local.state_key
}

output "lock_table" {
  description = "DynamoDB table used for Terraform state locking."
  value       = aws_dynamodb_table.locks.name
}

output "state_bucket_arn" {
  description = "ARN of the S3 state bucket."
  value       = aws_s3_bucket.state.arn
}

output "lock_table_arn" {
  description = "ARN of the DynamoDB lock table."
  value       = aws_dynamodb_table.locks.arn
}

output "state_version_retention" {
  description = "Minimum number of noncurrent state versions retained by the bucket lifecycle rule."
  value       = var.state_version_retention
}

output "state_version_max_age_days" {
  description = "Maximum age in days of a retained noncurrent state version."
  value       = var.state_version_max_age_days
}
