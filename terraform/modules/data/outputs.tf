output "db_endpoint"    { value = aws_db_instance.postgres.endpoint }
output "redis_endpoint" { value = aws_elasticache_cluster.redis.cache_nodes[0].address }
output "backup_failure_topic_arn" { value = aws_sns_topic.backup_failure.arn }
output "postgres_kms_key_arn" { value = aws_kms_key.postgres.arn }
