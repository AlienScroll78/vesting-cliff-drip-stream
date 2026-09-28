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

# ─── Cost monitoring ─────────────────────────────────────────────────────────

output "monthly_budget_limit_usd" {
  description = "Configured monthly AWS cost budget."
  value       = var.monthly_budget_limit_usd
}

output "monthly_budget_name" {
  description = "AWS Budget that alerts at 80% forecasted, 80% actual and 100% actual."
  value       = aws_budgets_budget.monthly.name
}

output "cost_alert_topic_arn" {
  description = "SNS topic carrying budget, anomaly and monthly report notifications."
  value       = aws_sns_topic.cost_alerts.arn
}

output "cost_allocation_tag" {
  description = "Cost allocation tag activated in Cost Explorer."
  value       = "${var.project_name}"
}

output "monthly_cost_report_function" {
  description = "Lambda that publishes the automated monthly cost report."
  value       = aws_lambda_function.monthly_cost_report.function_name
}

output "monthly_cost_report_schedule" {
  description = "EventBridge Scheduler schedule that triggers the monthly report."
  value       = aws_scheduler_schedule.monthly_cost_report.name
}

output "fargate_spot_capacity_provider" {
  description = "Capacity provider backing the Spot indexer."
  value       = aws_capacity_provider.fargate_spot.name
}

output "indexer_service_name" {
  description = "ECS service running the indexer on Fargate Spot."
  value       = aws_ecs_service.indexer.name
}
