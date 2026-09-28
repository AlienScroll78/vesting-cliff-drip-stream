output "db_endpoint" {
  description = "PostgreSQL RDS endpoint (host:port)"
  value       = aws_db_instance.postgres.endpoint
  sensitive   = true
}

output "db_name" {
  description = "PostgreSQL database name"
  value       = aws_db_instance.postgres.db_name
}

output "db_username" {
  description = "PostgreSQL master username"
  value       = aws_db_instance.postgres.username
  sensitive   = true
}

output "db_password" {
  description = "PostgreSQL master password"
  value       = var.db_password
  sensitive   = true
}

output "redis_endpoint" {
  description = "Redis ElastiCache endpoint (host:port)"
  value       = aws_elasticache_cluster.redis.cache_nodes[0].address
  sensitive   = true
}

output "backup_failure_topic_arn" {
  description = "SNS topic ARN for RDS backup/failure events"
  value       = aws_sns_topic.backup_failure.arn
}

output "postgres_kms_key_arn" {
  description = "KMS key ARN for RDS encryption"
  value       = aws_kms_key.postgres.arn
  sensitive   = true
}

output "db_instance_id" {
  description = "RDS instance identifier"
  value       = aws_db_instance.postgres.id
}

output "rds_postgresql_log_group_name" {
  description = <<-EOT
    CloudWatch log group that RDS writes PostgreSQL logs to, derived from
    enabled_cloudwatch_logs_exports. This is the AWS-managed path; the logging
    module copies it into /rds/postgresql so all three application log groups
    sit side by side.
  EOT
  value       = "/aws/rds/instance/${aws_db_instance.postgres.id}/postgresql"
}

output "redis_cluster_id" {
  description = "Redis cluster identifier"
  value       = aws_elasticache_cluster.redis.cluster_id
}
