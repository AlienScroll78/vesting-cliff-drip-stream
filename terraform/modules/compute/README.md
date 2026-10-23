# Module: compute

Deploys the ECS Fargate cluster, backend service, Application Load Balancer (ALB), and the IAM execution role required for the vesting-cliff-drip-stream backend API.

---

## Requirements

| Name | Version |
|------|---------|
| terraform | >= 1.3 |
| aws | >= 5.0 |

## Providers

| Name | Version |
|------|---------|
| aws | >= 5.0 |

## Resources

| Name | Type |
|------|------|
| [aws_ecs_cluster.main](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/ecs_cluster) | resource |
| [aws_ecs_task_definition.backend](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/ecs_task_definition) | resource |
| [aws_ecs_service.backend](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/ecs_service) | resource |
| [aws_lb.main](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/lb) | resource |
| [aws_lb_target_group.backend](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/lb_target_group) | resource |
| [aws_lb_listener.http](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/lb_listener) | resource |
| [aws_iam_role.ecs_exec](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/iam_role) | resource |
| [aws_iam_role_policy_attachment.ecs_exec](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/iam_role_policy_attachment) | resource |

## Inputs

| Name | Description | Type | Default | Required |
|------|-------------|------|---------|----------|
| `environment` | Deployment environment name (e.g. `staging`, `production`) | `string` | — | yes |
| `vpc_id` | ID of the VPC in which to deploy the ECS service and ALB | `string` | — | yes |
| `public_subnet_ids` | List of public subnet IDs for the ALB and Fargate tasks | `list(string)` | — | yes |
| `private_subnet_ids` | List of private subnet IDs (reserved for future use) | `list(string)` | `[]` | no |
| `alb_idle_timeout` | ALB idle connection timeout in seconds | `number` | `60` | no |
| `container_port` | Port the backend container listens on | `number` | `8080` | no |
| `container_cpu` | Fargate task-level CPU units (256 = 0.25 vCPU) | `number` | `256` | no |
| `container_memory` | Fargate task-level memory in MB | `number` | `512` | no |

## Outputs

| Name | Description |
|------|-------------|
| `alb_dns_name` | DNS name of the Application Load Balancer |
| `alb_zone_id` | Route53 hosted zone ID of the ALB (for alias records) |

## Usage Example

```hcl
module "compute" {
  source = "./modules/compute"

  environment       = "production"
  vpc_id            = module.network.vpc_id
  public_subnet_ids = module.network.public_subnet_ids

  container_cpu    = 512
  container_memory = 1024
}
```

> **Note:** The ECS task definition references a placeholder image. Replace the `image` field in
> `main.tf` with your actual ECR image URI before deploying to production. The container is
> expected to expose `container_port` (default `8080`) and emit CloudWatch logs to the
> `/ecs/vesting-backend` log group.
