terraform {
  backend "s3" {
    bucket         = "vesting-tf-state"
    key            = "vesting/terraform.tfstate"
    region         = "us-east-1"
    dynamodb_table = "vesting-tf-locks"
    encrypt        = true
  }
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
      # Project is the cost allocation tag activated in Cost Explorer, so every
      # resource in this stack attributes to the `vesting-drips` group.
      Project     = var.project_name
      Application = "vesting-cliff-drip-stream"
      Environment = var.environment
      ManagedBy   = "terraform"
      Repository  = "Praisefotos1/vesting-cliff-drip-stream"
    }, var.additional_tags)
  }
}

# State locking table (only created in the management account / region)
resource "aws_dynamodb_table" "terraform_locks" {
  name         = "vesting-tf-locks"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "LockID"

  attribute {
    name = "LockID"
    type = "S"
  }

  tags = {
    Name        = "vesting-tf-locks"
    Project     = var.project_name
    Environment = var.environment
    ManagedBy   = "terraform"
  }
}

module "network" {
  source      = "./modules/network"
  environment = var.environment
  aws_region  = var.aws_region
}

module "dns" {
  source      = "./modules/dns"
  environment = var.environment
  zone_name   = var.domain_name
}

module "compute" {
  source            = "./modules/compute"
  environment       = var.environment
  vpc_id            = module.network.vpc_id
  public_subnet_ids = module.network.public_subnet_ids
  private_subnet_ids = module.network.private_subnet_ids
}

module "data" {
  source                = "./modules/data"
  environment           = var.environment
  vpc_id                = module.network.vpc_id
  private_subnet_ids    = module.network.private_subnet_ids
  db_password           = var.db_password
  db_instance_class     = var.db_instance_class
  backup_failure_emails = var.cost_alert_emails
}
