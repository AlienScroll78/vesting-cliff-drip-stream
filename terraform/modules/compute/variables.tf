variable "environment"        {}
variable "vpc_id"             {}
variable "public_subnet_ids"  { type = list(string) }
variable "private_subnet_ids" {
  type    = list(string)
  default = []
}

variable "aws_region" {
  description = "AWS region, used by the awslogs log driver."
  type        = string
  default     = "us-east-1"
}

variable "container_image" {
  description = "Container image for the backend service."
  type        = string
  default     = "public.ecr.aws/amazonlinux/amazonlinux:latest"
}

variable "secrets" {
  description = "Map of environment variable name to the Secrets Manager valueFrom selector used to populate it."
  type        = map(string)
  default     = {}
}

variable "secret_arns" {
  description = "Secret ARNs the task execution role may read. Must be the plain ARNs, not the ECS valueFrom selectors in `secrets`."
  type        = list(string)
  default     = []
}

variable "secrets_kms_key_arns" {
  description = "KMS key ARNs the task execution role may use to decrypt the secrets above."
  type        = list(string)
  default     = []
}

variable "alb_idle_timeout" {
  description = "ALB idle timeout in seconds"
  type        = number
  default     = 60
}

variable "app_log_group_name" {
  type = string

  description = <<-EOT
    CloudWatch log group the API server ships to, e.g. /ecs/api-server. Both the
    app container's awslogs driver and the Fluent Bit sidecar write here.
  EOT
}

variable "app_log_group_arns" {
  type = list(string)

  description = <<-EOT
    ARNs the task role may write log streams to. Scoping this to the application
    log groups is what keeps the sidecar from being an account-wide log writer.
  EOT
}

variable "log_level" {
  description = "Minimum level the application logger emits: debug, info, warn or error."
  type        = string
  default     = "info"
}

variable "fluentbit_image" {
  description = "Fluent Bit image used as the log shipper sidecar."
  type        = string
  default     = "public.ecr.aws/aws-observability/aws-for-fluent-bit:stable"
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
