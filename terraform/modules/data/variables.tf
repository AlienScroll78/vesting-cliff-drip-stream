variable "environment"        {}
variable "vpc_id"             {}
variable "private_subnet_ids" { type = list(string) }
variable "db_password"        { sensitive = true }
