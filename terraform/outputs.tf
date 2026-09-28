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

# ─── Log aggregation ──────────────────────────────────────────────────────────

output "application_log_groups" {
  description = "Application log groups written by the Fluent Bit sidecars."
  value       = local.ecs_log_groups
}

output "rds_log_group_name" {
  description = "Log group holding the PostgreSQL audit and error logs."
  value       = aws_cloudwatch_log_group.rds.name
}

output "logging_alert_topic_arn" {
  description = "SNS topic that pages PagerDuty when the error alarm fires."
  value       = aws_sns_topic.logging_alerts.arn
}

output "application_error_alarm_name" {
  description = "CloudWatch alarm on ApplicationErrorCount."
  value       = aws_cloudwatch_metric_alarm.application_errors.alarm_name
}

output "pagerduty_enabled" {
  description = "Whether the PagerDuty SNS subscription exists."
  value       = var.pagerduty_integration_key != ""
}
