resource "aws_db_subnet_group" "main" {
  name       = "${var.environment}-db"
  subnet_ids = var.private_subnet_ids
}

resource "aws_db_instance" "postgres" {
  identifier        = "${var.environment}-vesting-db"
  engine            = "postgres"
  engine_version    = "15"
  instance_class    = "db.t3.micro"
  allocated_storage = 20
  db_name           = "vesting"
  username          = "vesting"
  password          = var.db_password
  db_subnet_group_name = aws_db_subnet_group.main.name
  skip_final_snapshot  = true
}

resource "aws_elasticache_subnet_group" "main" {
  name       = "${var.environment}-redis"
  subnet_ids = var.private_subnet_ids
}

resource "aws_elasticache_cluster" "redis" {
  cluster_id           = "${var.environment}-vesting"
  engine               = "redis"
  node_type            = "cache.t3.micro"
  num_cache_nodes      = 1
  subnet_group_name    = aws_elasticache_subnet_group.main.name
}
