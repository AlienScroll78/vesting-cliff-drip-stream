output "vpc_id" {
  description = "VPC ID"
  value       = module.network.vpc_id
}

output "public_subnet_ids" {
  description = "Public subnet IDs"
  value       = module.network.public_subnet_ids
}

output "private_subnet_ids" {
  description = "Private subnet IDs"
  value       = module.network.private_subnet_ids
}

output "alb_dns_name" {
  description = "ALB DNS name"
  value       = module.compute.alb_dns_name
}

output "ecs_cluster_name" {
  description = "ECS cluster name"
  value       = module.compute.ecs_cluster_name
}

output "db_endpoint" {
  description = "PostgreSQL RDS endpoint"
  value       = module.data.db_endpoint
  sensitive   = true
}

output "db_name" {
  description = "PostgreSQL database name"
  value       = module.data.db_name
}

output "redis_endpoint" {
  description = "Redis ElastiCache endpoint"
  value       = module.data.redis_endpoint
  sensitive   = true
}

output "route53_zone_id" {
  description = "Route53 hosted zone ID"
  value       = module.dns.zone_id
}

output "route53_name_servers" {
  description = "Route53 zone name servers"
  value       = module.dns.zone_name_servers
}

output "backup_failure_topic_arn" {
  description = "SNS topic for RDS backup failure alerts"
  value       = module.data.backup_failure_topic_arn
}

output "backup_verify_lambda_name" {
  description = "Backup restore verification function, invocable manually to test a restore on demand"
  value       = aws_lambda_function.backup_verify.function_name
}

output "backup_verify_log_group" {
  description = "CloudWatch log group holding the outcome of every restore verification"
  value       = aws_cloudwatch_log_group.backup_verify.name
}

output "backup_verify_alert_topic_arn" {
  description = "SNS topic that pages PagerDuty when a restore verification does not report success"
  value       = aws_sns_topic.backup_verify_alerts.arn
}

output "backup_restore_alarm_name" {
  description = "Alarm on the weekly BackupRestoreSuccess verdict"
  value       = aws_cloudwatch_metric_alarm.backup_restore.alarm_name
}
