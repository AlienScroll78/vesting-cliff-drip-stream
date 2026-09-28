variable "environment"       {}
variable "vpc_id"            {}
variable "public_subnet_ids" { type = list(string) }
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
