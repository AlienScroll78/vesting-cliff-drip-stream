output "db_credentials_arn" {
  description = "ARN of the auto-rotating PostgreSQL credentials secret."
  value       = aws_secretsmanager_secret.db_credentials.arn
}

output "db_password_json_key" {
  description = "ECS valueFrom selector for the password field of the database credentials secret."
  value       = "${aws_secretsmanager_secret.db_credentials.arn}-json-key:password"
}

output "db_username_json_key" {
  description = "ECS valueFrom selector for the username field of the database credentials secret."
  value       = "${aws_secretsmanager_secret.db_credentials.arn}-json-key:username"
}

output "database_url_json_key" {
  description = "ECS valueFrom selector for the connection string field of the database credentials secret."
  value       = "${aws_secretsmanager_secret.db_credentials.arn}-json-key:database_url"
}

output "jwt_private_key_arn" {
  description = "ARN of the RS256 signing key secret."
  value       = aws_secretsmanager_secret.jwt_private_key.arn
}

output "soroban_rpc_api_key_arn" {
  description = "ARN of the Soroban RPC API key secret."
  value       = aws_secretsmanager_secret.soroban_rpc_api_key.arn
}

output "slack_webhook_url_arn" {
  description = "ARN of the Slack incoming webhook secret."
  value       = aws_secretsmanager_secret.slack_webhook_url.arn
}

output "sentry_dsn_arn" {
  description = "ARN of the Sentry DSN secret."
  value       = aws_secretsmanager_secret.sentry_dsn.arn
}

output "kms_key_arn" {
  description = "KMS key ARN encrypting every secret in this module."
  value       = aws_kms_key.secrets.arn
}

output "secret_arns" {
  description = "Every secret ARN created by this module."
  value = [
    aws_secretsmanager_secret.db_credentials.arn,
    aws_secretsmanager_secret.jwt_private_key.arn,
    aws_secretsmanager_secret.soroban_rpc_api_key.arn,
    aws_secretsmanager_secret.slack_webhook_url.arn,
    aws_secretsmanager_secret.sentry_dsn.arn,
  ]
}

output "ecs_task_secrets" {
  description = "ECS `secrets` entries for the backend container, reading only the secrets the task needs."
  value = {
    DATABASE_URL        = "${aws_secretsmanager_secret.db_credentials.arn}-json-key:database_url"
    JWT_PRIVATE_KEY     = aws_secretsmanager_secret.jwt_private_key.arn
    SOROBAN_RPC_API_KEY = aws_secretsmanager_secret.soroban_rpc_api_key.arn
    SENTRY_DSN          = aws_secretsmanager_secret.sentry_dsn.arn
  }
}

output "ecs_task_secret_arns" {
  description = "Secret ARNs the backend task is permitted to read. Deliberately excludes the Slack webhook, which only the cost relay Lambda needs."
  value = [
    aws_secretsmanager_secret.db_credentials.arn,
    aws_secretsmanager_secret.jwt_private_key.arn,
    aws_secretsmanager_secret.soroban_rpc_api_key.arn,
    aws_secretsmanager_secret.sentry_dsn.arn,
  ]
}

output "rotation_failure_topic_arn" {
  description = "SNS topic notified when a secret rotation fails."
  value       = aws_sns_topic.rotation_failure.arn
}

output "rotation_failure_alarm_name" {
  description = "CloudWatch alarm raised when the rotation Lambda reports an error."
  value       = aws_cloudwatch_metric_alarm.rotation_failure.alarm_name
}

output "audit_trail_name" {
  description = "CloudTrail recording every access to this environment's secrets."
  value       = aws_cloudtrail.secrets_audit.name
}

output "audit_log_group_name" {
  description = "CloudWatch log group receiving the Secrets Manager access trail."
  value       = aws_cloudwatch_log_group.secrets_audit.name
}
