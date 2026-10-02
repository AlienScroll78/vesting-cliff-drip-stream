variable "environment" {
  description = "Deployment environment"
  type        = string
}

variable "zone_name" {
  description = "DNS zone name (e.g. vesting.example.com)"
  type        = string
}

variable "alb_dns_name" {
  description = "DNS name of the ALB (passed from compute module)"
  type        = string
  default     = ""
}

variable "alb_zone_id" {
  description = "Route53 zone ID of the ALB (passed from compute module)"
  type        = string
  default     = ""
}
