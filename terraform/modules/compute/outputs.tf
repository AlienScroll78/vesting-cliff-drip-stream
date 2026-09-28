output "alb_dns_name" {
  description = "DNS name of the application load balancer"
  value       = aws_lb.main.dns_name
}

output "alb_zone_id" {
  description = "Route53 zone ID of the ALB (for alias records)"
  value       = aws_lb.main.zone_id
}

output "ecs_cluster_name" {
  description = "Name of the ECS cluster"
  value       = aws_ecs_cluster.main.name
}

output "ecs_task_role_arn" {
  description = "ARN of the ECS task execution role"
  value       = aws_iam_role.ecs_exec.arn
  sensitive   = true
}

output "fargate_spot_capacity_provider_name" {
  description = "Name of the Fargate Spot capacity provider"
  value       = aws_capacity_provider.fargate_spot.name
}

output "indexer_service_name" {
  description = "Name of the ECS service running the indexer on Fargate Spot"
  value       = aws_ecs_service.indexer.name
}

output "alb_security_group_id" {
  description = "Security group ID of the ALB"
  value       = aws_lb.main.security_groups[0]
}
