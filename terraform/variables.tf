variable "environment" {
  default = "staging"
}

variable "aws_region" {
  default = "us-east-1"
}

variable "db_password" {
  sensitive = true
}
