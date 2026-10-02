terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.80"
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
      ManagedBy   = "terraform-bootstrap"
      Repository  = "Praisefotos1/vesting-cliff-drip-stream"
    }, var.additional_tags)
  }
}

locals {
  state_bucket_name = "vestingdrips-terraform-state-${var.environment}"
  lock_table_name   = "vestingdrips-terraform-locks-${var.environment}"
  state_key         = "${var.environment}/terraform.tfstate"
}

resource "aws_s3_bucket" "state" {
  bucket = local.state_bucket_name
  tags   = { Name = local.state_bucket_name }
}

resource "aws_s3_bucket_ownership_controls" "state" {
  bucket = aws_s3_bucket.state.id

  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_public_access_block" "state" {
  bucket                  = aws_s3_bucket.state.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "state" {
  bucket = aws_s3_bucket.state.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_versioning" "state" {
  bucket = aws_s3_bucket.state.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "state" {
  bucket = aws_s3_bucket.state.id

  depends_on = [aws_s3_bucket_versioning.state]

  rule {
    id     = "retain-recent-state-versions"
    status = "Enabled"

    filter {}

    noncurrent_version_expiration {
      noncurrent_days           = var.state_version_max_age_days
      newer_noncurrent_versions = var.state_version_retention
    }
  }
}

resource "aws_dynamodb_table" "locks" {
  name         = local.lock_table_name
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "LockID"

  attribute {
    name = "LockID"
    type = "S"
  }

  point_in_time_recovery {
    enabled = true
  }

  server_side_encryption {
    enabled = true
  }

  tags = { Name = local.lock_table_name }
}
