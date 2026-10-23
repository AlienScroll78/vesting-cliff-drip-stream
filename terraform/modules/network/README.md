# Module: network

Creates the VPC, public and private subnets across two availability zones, NAT gateways, and all associated routing for the vesting-cliff-drip-stream infrastructure.

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

## Data Sources

| Name | Description |
|------|-------------|
| [aws_availability_zones.available](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/data-sources/availability_zones) | Discovers the first two available AZs in the configured region |

## Resources

| Name | Type |
|------|------|
| [aws_vpc.main](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/vpc) | resource |
| [aws_subnet.public (×2)](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/subnet) | resource |
| [aws_subnet.private (×2)](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/subnet) | resource |
| [aws_internet_gateway.main](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/internet_gateway) | resource |
| [aws_eip.nat (×2)](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/eip) | resource |
| [aws_nat_gateway.main (×2)](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/nat_gateway) | resource |
| [aws_route_table.public](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/route_table) | resource |
| [aws_route_table.private (×2)](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/route_table) | resource |
| [aws_route_table_association (×4)](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/route_table_association) | resource |

## Inputs

| Name | Description | Type | Default | Required |
|------|-------------|------|---------|----------|
| `environment` | Deployment environment name (e.g. `staging`, `production`) | `string` | — | yes |

## Outputs

| Name | Description |
|------|-------------|
| `vpc_id` | ID of the created VPC |
| `public_subnet_ids` | List of public subnet IDs (one per AZ) |
| `private_subnet_ids` | List of private subnet IDs (one per AZ) |

## CIDR Layout

| Subnet | CIDR | AZ |
|--------|------|----|
| Public 0 | `10.0.0.0/24` | AZ index 0 |
| Public 1 | `10.0.1.0/24` | AZ index 1 |
| Private 0 | `10.0.10.0/24` | AZ index 0 |
| Private 1 | `10.0.11.0/24` | AZ index 1 |

The VPC CIDR is `10.0.0.0/16`. Each private subnet routes outbound traffic through a dedicated NAT gateway in the corresponding public subnet, providing AZ-level resilience.

## Usage Example

```hcl
module "network" {
  source = "./modules/network"

  environment = "production"
}
```

Pass the outputs to dependent modules:

```hcl
module "compute" {
  source = "./modules/compute"

  vpc_id            = module.network.vpc_id
  public_subnet_ids = module.network.public_subnet_ids
  # ...
}

module "data" {
  source = "./modules/data"

  vpc_id             = module.network.vpc_id
  private_subnet_ids = module.network.private_subnet_ids
  # ...
}
```

> **Cost note:** Two NAT gateways are provisioned for high availability. Each NAT gateway incurs
> an hourly charge plus data-processing fees. For non-production environments you may reduce to
> one NAT gateway by setting `az_count = 1` (requires a local variable change in `main.tf`).
