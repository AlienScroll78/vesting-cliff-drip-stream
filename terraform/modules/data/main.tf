resource "aws_db_subnet_group" "main" {
  name       = "${var.environment}-db"
  subnet_ids = var.private_subnet_ids
}

resource "aws_kms_key" "postgres" {
  description             = "Encryption key for ${var.environment} vesting PostgreSQL storage and automated backups"
  deletion_window_in_days = 30
  enable_key_rotation     = true
}

resource "aws_kms_alias" "postgres" {
  name          = "alias/${var.environment}-vesting-postgres"
  target_key_id = aws_kms_key.postgres.key_id
}

resource "aws_sns_topic" "backup_failure" {
  name              = "${var.environment}-vesting-rds-backup-failure"
  kms_master_key_id = "alias/aws/sns"
}

resource "aws_sns_topic_subscription" "backup_failure_email" {
  for_each  = var.backup_failure_emails
  topic_arn = aws_sns_topic.backup_failure.arn
  protocol  = "email"
  endpoint  = each.value
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
  storage_encrypted               = true
  kms_key_id                      = aws_kms_key.postgres.arn
  backup_retention_period         = var.backup_retention_days
  preferred_backup_window         = "02:00-03:00"
  preferred_maintenance_window    = "sun:03:00-sun:04:00"
  copy_tags_to_snapshot           = true
  deletion_protection             = true
  skip_final_snapshot             = false
  final_snapshot_identifier       = "${var.environment}-vesting-db-final"
  enabled_cloudwatch_logs_exports = ["postgresql"]
}

# RDS archives PostgreSQL write-ahead logs automatically while automated
# backups are retained. This event subscription pages operators if that backup
# or recovery pipeline reports a failure.
resource "aws_db_event_subscription" "backup_failure" {
  name             = "${var.environment}-vesting-db-backup-failure"
  sns_topic        = aws_sns_topic.backup_failure.arn
  source_type      = "db-instance"
  source_ids       = [aws_db_instance.postgres.id]
  event_categories = ["backup", "failure"]
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
