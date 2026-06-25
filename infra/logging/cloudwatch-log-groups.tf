variable "environment" {}

locals {
  services = ["vesting-backend", "vesting-worker", "vesting-migrate"]
}

resource "aws_cloudwatch_log_group" "services" {
  for_each          = toset(local.services)
  name              = "/ecs/${each.key}"
  retention_in_days = 30
  tags              = { Environment = var.environment }
}
