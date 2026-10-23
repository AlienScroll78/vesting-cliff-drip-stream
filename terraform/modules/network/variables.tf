variable "environment" {}

variable "aws_region" {
  description = "AWS region, used to build the VPC endpoint service names."
  type        = string
  default     = "us-east-1"
}

variable "interface_endpoint_services" {
  description = <<-EOT
    Services to expose through interface VPC endpoints, e.g.
    ["secretsmanager", "logs", "ecr.api", "ecr.dkr", "sts"].

    Empty by default. An interface endpoint costs ~$7.20 per month per AZ, so it
    only reduces the bill once a service's NAT traffic justifies it. Check the
    NAT gateway processed-GB figure in Cost Explorer first. The S3 gateway
    endpoint is always created and is free.
  EOT
  type        = list(string)
  default     = []
}
