variable "environment"        {}
variable "vpc_id"             {}
variable "public_subnet_ids"  { type = list(string) }
variable "private_subnet_ids" { type = list(string); default = [] }

variable "alb_idle_timeout" {
  description = "ALB idle timeout in seconds"
  type        = number
  default     = 60
}

variable "container_port" {
  description = "Port the backend container listens on"
  type        = number
  default     = 8080
}

variable "container_cpu" {
  description = "Task-level CPU units (Fargate)"
  type        = number
  default     = 256
}

variable "container_memory" {
  description = "Task-level memory in MB (Fargate)"
  type        = number
  default     = 512
}

variable "container_image" {
  description = "Container image used by the ECS task definition"
  type        = string
  default     = "public.ecr.aws/amazonlinux/amazonlinux:latest"
}

variable "container_name" {
  description = "Name of the application container"
  type        = string
  default     = "vesting-backend"
}

variable "codedeploy_bake_minutes" {
  description = "Minutes CodeDeploy waits for the green task before routing traffic"
  type        = number
  default     = 10
}

variable "codedeploy_timeout_minutes" {
  description = "Maximum deployment duration enforced by the deployment workflow"
  type        = number
  default     = 15
}

variable "traffic_shift_percentages" {
  description = "Traffic shift milestones for the blue-green rollout"
  type        = list(number)
  default     = [10, 50, 100]

  validation {
    condition     = try(var.traffic_shift_percentages == [10, 50, 100], false)
    error_message = "traffic_shift_percentages must be [10, 50, 100]."
  }
}

variable "health_check_failure_threshold_percent" {
  description = "Target health failure percentage that stops a deployment"
  type        = number
  default     = 5
}

variable "deployment_notification_emails" {
  description = "Email recipients for CodeDeploy lifecycle notifications"
  type        = set(string)
  default     = []
}
