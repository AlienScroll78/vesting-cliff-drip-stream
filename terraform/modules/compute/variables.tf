variable "environment" {}

variable "vpc_id" {}

variable "public_subnet_ids" {
  type = list(string)
}

variable "private_subnet_ids" {
  type = list(string)
}

variable "aws_region" {
  description = "Region for the awslogs driver and the Fluent Bit CloudWatch output."
  type        = string
  default     = "us-east-1"
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
