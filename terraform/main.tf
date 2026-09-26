terraform {
  backend "s3" {}

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.80"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }
  required_version = ">= 1.6, < 2.0"
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = merge({
      Application = "vesting-cliff-drip-stream"
      Environment = var.environment
      ManagedBy   = "terraform"
      Repository  = "Praisefotos1/vesting-cliff-drip-stream"
    }, var.additional_tags)
  }
}

module "network" {
  source      = "./modules/network"
  environment = var.environment
}

module "dns" {
  source      = "./modules/dns"
  environment = var.environment
  zone_name   = var.domain_name
}

module "compute" {
  source             = "./modules/compute"
  environment        = var.environment
  vpc_id             = module.network.vpc_id
  public_subnet_ids  = module.network.public_subnet_ids
  private_subnet_ids = module.network.private_subnet_ids
}

module "data" {
  source                = "./modules/data"
  environment           = var.environment
  vpc_id                = module.network.vpc_id
  private_subnet_ids    = module.network.private_subnet_ids
  db_password           = var.db_password
  backup_failure_emails = var.cost_alert_emails
}
