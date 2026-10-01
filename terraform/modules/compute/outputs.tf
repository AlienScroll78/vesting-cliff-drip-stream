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

output "alb_security_group_id" {
  description = "Security group ID of the ALB"
  value       = aws_lb.main.security_groups[0]
}

output "ecs_service_name" {
  description = "Name of the ECS API service"
  value       = aws_ecs_service.backend.name
}

output "ecs_task_definition_arn" {
  description = "ARN of the current ECS task definition"
  value       = aws_ecs_task_definition.backend.arn
}

output "alb_listener_arn" {
  description = "ARN of the production ALB listener"
  value       = aws_lb_listener.http.arn
}

output "codedeploy_application_name" {
  description = "Name of the CodeDeploy application"
  value       = aws_codedeploy_app.api.name
}

output "codedeploy_deployment_group_name" {
  description = "Name of the CodeDeploy deployment group"
  value       = "${var.environment}-vesting-api"
}

output "codedeploy_deployment_config_name" {
  description = "Name of the CodeDeploy traffic shifting configuration"
  value       = aws_codedeploy_deployment_config.api.id
}

output "codedeploy_notification_topic_arn" {
  description = "SNS topic receiving CodeDeploy lifecycle notifications"
  value       = aws_sns_topic.deployment_notifications.arn
}

output "deployment_timeout_minutes" {
  description = "Deployment timeout enforced by the deployment workflow"
  value       = var.codedeploy_timeout_minutes
}
