# Module: dns

Creates a Route53 hosted zone and DNS records for the `api`, `app`, and (production-only) `vault` subdomains of the vesting-cliff-drip-stream platform.

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
| [aws_route53_zone.main](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/route53_zone) | resource |
| [aws_route53_record.api](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/route53_record) | resource |
| [aws_route53_record.app](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/route53_record) | resource |
| [aws_route53_record.vault (production only)](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/route53_record) | resource |

## Inputs

| Name | Description | Type | Default | Required |
|------|-------------|------|---------|----------|
| `environment` | Deployment environment name (e.g. `staging`, `production`) | `string` | — | yes |
| `zone_name` | DNS zone name (e.g. `vesting.example.com`) | `string` | — | yes |
| `alb_dns_name` | DNS name of the ALB, passed from the compute module output | `string` | `""` | no |
| `alb_zone_id` | Route53 hosted zone ID of the ALB, passed from the compute module output | `string` | `""` | no |

## Outputs

| Name | Description |
|------|-------------|
| `zone_id` | ID of the created Route53 hosted zone |
| `name_servers` | List of NS records — delegate these at your domain registrar |

## DNS Records Created

| Record | Type | Value | Condition |
|--------|------|-------|-----------|
| `api.<zone_name>` | A (alias) | ALB DNS name | Always |
| `app.<zone_name>` | CNAME | `api.<zone_name>` | Always |
| `vault.<zone_name>` | CNAME | `api.<zone_name>` | `environment == "production"` only |

## Usage Example

```hcl
module "dns" {
  source = "./modules/dns"

  environment  = "production"
  zone_name    = "vesting.example.com"
  alb_dns_name = module.compute.alb_dns_name
  alb_zone_id  = module.compute.alb_zone_id
}
```

> **First-time setup:** After applying this module, retrieve the nameserver records from the
> `name_servers` output and add them as NS records at your domain registrar. DNS propagation
> typically takes up to 48 hours.
>
> `alb_dns_name` and `alb_zone_id` default to empty strings so the module can be initialised
> before the compute module exists. Set them before final apply.
