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

output "secret_arns" {
  description = "ARNs of every secret managed in AWS Secrets Manager."
  value       = module.secrets.secret_arns
}

output "db_credentials_secret_arn" {
  description = "ARN of the auto-rotating PostgreSQL credentials secret."
  value       = module.secrets.db_credentials_arn
}

output "db_password_json_key" {
  description = "ECS valueFrom selector for the database password."
  value       = module.secrets.db_password_json_key
}

output "secret_rotation_failure_topic_arn" {
  description = "SNS topic notified when a secret rotation fails."
  value       = module.secrets.rotation_failure_topic_arn
}

output "secret_audit_trail_name" {
  description = "CloudTrail recording every access to this environment's secrets."
  value       = module.secrets.audit_trail_name
}

output "secret_audit_log_group" {
  description = "CloudWatch log group receiving the Secrets Manager access trail."
  value       = module.secrets.audit_log_group_name
}
