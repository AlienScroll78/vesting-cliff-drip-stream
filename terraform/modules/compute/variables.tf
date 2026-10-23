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

variable "container_name" {
  description = "Name of the application container"
  type        = string
  default     = "vesting-backend"
}

variable "container_cpu" {
  description = "CPU units for the backend ECS task"
  type        = number
  default     = 512
}

variable "container_memory" {
  description = "Memory (MB) for the backend ECS task"
  type        = number
  default     = 1024
}

variable "container_port" {
  description = "Container port the backend listens on"
  type        = number
  default     = 3001
}

variable "indexer_container_image" {
  description = "Container image for the event indexer service"
  type        = string
  default     = "public.ecr.aws/amazonlinux/amazonlinux:latest"
}

variable "indexer_cpu" {
  description = "CPU units for the indexer ECS task"
  type        = number
  default     = 256
}

variable "indexer_memory" {
  description = "Memory (MB) for the indexer ECS task"
  type        = number
  default     = 512
}

variable "waf_rate_limit" {
  description = "Requests per IP allowed during the five-minute window"
  type        = number
  default     = 1000
}

variable "waf_sanctioned_country_codes" {
  description = "ISO country codes blocked by the WAF geo rule"
  type        = list(string)
  default     = ["AF", "BY", "CU", "IR", "KP", "LY", "MM", "RU", "SD", "SS", "SY", "VE", "YE", "ZW"]
}

variable "waf_log_retention_days" {
  description = "Retention period for WAF decision logs"
  type        = number
  default     = 90
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
  type        = string
  default     = "/ecs/vesting-backend"
  description = <<-EOT
    CloudWatch log group the API server ships to, e.g. /ecs/api-server. Both the
    app container's awslogs driver and the Fluent Bit sidecar write here.
  EOT
}

variable "app_log_group_arns" {
  type        = list(string)
  default     = ["*"]
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
