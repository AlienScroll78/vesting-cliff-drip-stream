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
