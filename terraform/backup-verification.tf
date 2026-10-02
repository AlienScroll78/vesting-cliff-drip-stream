# ─── Backup Restore Verification (#841) ────────────────────────────────────────
#
# A scheduled job that restores the most recent automated snapshot into a
# throwaway instance, proves the data is actually queryable, and deletes the
# instance again. A backup that has never been restored is a hypothesis, not a
# backup, and the only way to know is to restore one on a schedule.
#
# Two invocations, one function:
#   verify   - weekly, Sunday 03:00 UTC, does the restore and checks the data.
#   cleanup  - every 30 minutes, deletes anything a killed verify left behind.
#
# The cleanup schedule exists because Lambda caps a single invocation at 900
# seconds. A slow restore plus a verification pass can exceed that, and when the
# function is killed mid-restore its own `finally` block never runs. The worst
# case is therefore 15 minutes of verify plus one cleanup interval, which keeps
# the instance well inside the 60 minute budget. Reserved concurrency is pinned
# to 1 for the same reason: it makes it impossible for cleanup to delete the
# instance belonging to a verify that is still running.

locals {
  backup_verify_log_group = "/aws/lambda/${var.environment}-vesting-backup-verify"
  backup_verify_zip       = "${path.module}/.terraform-build/backup-verify.zip"

  # Tables that must exist and be countable in the restored copy. These are the
  # application's own tables; the count is the proof that the restore produced
  # queryable data rather than an empty cluster that happens to accept a socket.
  backup_verify_tables = "schedules,events,claims,indexer_cursor"

  metric_namespace = "VestingApp"
  metric_name      = "BackupRestoreSuccess"
}

# ─── Networking ───────────────────────────────────────────────────────────────

# The temporary instance accepts PostgreSQL from the verification function and
# from nowhere else. It is not reachable from the ECS tasks, the internet, or
# another environment, so a snapshot containing real data has a very small blast
# radius for the few minutes it exists.
resource "aws_security_group" "restore_target" {
  name        = "${var.environment}-vesting-restore-target"
  description = "Temporary instances created by the backup restore verification"
  vpc_id      = module.network.vpc_id

  ingress {
    description     = "PostgreSQL from the backup verification function only"
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.backup_verify.id]
  }

  tags = { Name = "${var.environment}-vesting-restore-target" }
}

resource "aws_security_group" "backup_verify" {
  name        = "${var.environment}-vesting-backup-verify"
  description = "Egress for the backup restore verification function"
  vpc_id      = module.network.vpc_id

  egress {
    description = "PostgreSQL to the temporary restore target"
    from_port   = 5432
    to_port     = 5432
    protocol    = "tcp"
    # The target's own egress rules are ignored for stateful connections, so
    # this is stated explicitly rather than relying on that subtlety.
    security_groups = [aws_security_group.restore_target.id]
  }

  egress {
    description = "AWS APIs (RDS, CloudWatch) over the NAT gateway"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "${var.environment}-vesting-backup-verify" }
}

# ─── Permissions ──────────────────────────────────────────────────────────────

data "aws_iam_policy_document" "backup_verify_assume" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "backup_verify" {
  name               = "${var.environment}-vesting-backup-verify"
  assume_role_policy = data.aws_iam_policy_document.backup_verify_assume.json
  tags               = { Name = "${var.environment}-vesting-backup-verify" }
}

data "aws_iam_policy_document" "backup_verify" {
  # Scoped to this account's resources. There is no way to express "only these
  # two instances" for a restore, so the write surface is limited to the restore
  # API and reads are account-wide, which is what the snapshot search needs.
  statement {
    sid    = "RestoreOnly"
    effect = "Allow"

    actions = [
      "rds:RestoreDBInstanceFromDBSnapshot",
      "rds:DeleteDBInstance",
    ]

    resources = ["arn:aws:rds:*:*:db:*"]
  }

  statement {
    sid    = "DescribeOnly"
    effect = "Allow"

    actions = [
      "rds:DescribeDBInstances",
      "rds:DescribeDBSnapshots",
      "rds:ListTagsForResource",
    ]

    resources = ["*"]
  }

  statement {
    sid       = "MetricsOnly"
    effect    = "Allow"
    actions   = ["cloudwatch:PutMetricData"]
    resources = ["*"]

    # Locked to the single metric this function publishes, so a compromised
    # function cannot forge the results of any other alarm in the account.
    condition {
      test     = "StringEquals"
      variable = "cloudwatch:namespace"
      values   = [local.metric_namespace]
    }
  }

  statement {
    sid       = "VpcEniManagement"
    effect    = "Allow"
    actions   = ["ec2:CreateNetworkInterface", "ec2:DescribeNetworkInterfaces", "ec2:DeleteNetworkInterface"]
    resources = ["*"]
  }

  statement {
    sid       = "OwnLogs"
    effect    = "Allow"
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["${aws_cloudwatch_log_group.backup_verify.arn}:*"]
  }
}

resource "aws_iam_role_policy" "backup_verify" {
  name   = "${var.environment}-vesting-backup-verify"
  role   = aws_iam_role.backup_verify.id
  policy = data.aws_iam_policy_document.backup_verify.json
}

data "aws_iam_policy_document" "scheduler_assume" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["scheduler.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "scheduler" {
  name               = "${var.environment}-vesting-scheduler"
  assume_role_policy = data.aws_iam_policy_document.scheduler_assume.json
  tags               = { Name = "${var.environment}-vesting-scheduler" }
}

resource "aws_iam_role_policy" "scheduler" {
  name = "${var.environment}-vesting-scheduler"
  role = aws_iam_role.scheduler.id

  policy = jsonencode({
    Version   = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["lambda:InvokeFunction"]
      Resource = aws_lambda_function.backup_verify.arn
    }]
  })
}

# ─── Function ─────────────────────────────────────────────────────────────────

resource "aws_cloudwatch_log_group" "backup_verify" {
  # One year: a failed restore is worth correlating against a snapshot restore
  # window months later, and this log group is the only record of it.
  name              = local.backup_verify_log_group
  retention_in_days = 365
  tags              = { Name = local.backup_verify_log_group }
}

data "archive_file" "backup_verify" {
  type        = "zip"
  source_dir  = "${path.module}/lambdas/backup-verify"
  output_path = local.backup_verify_zip

  # The test files are several hundred lines of fixtures and have no business in
  # a deployment artifact.
  excludes = ["*.test.js"]
}

resource "aws_lambda_function" "backup_verify" {
  function_name = "${var.environment}-vesting-backup-verify"
  description   = "Restores the latest automated snapshot and verifies the data is queryable"

  filename         = data.archive_file.backup_verify.output_path
  source_code_hash = data.archive_file.backup_verify.output_base64sha256
  handler          = "index.handler"
  runtime          = "nodejs22.x"
  architectures    = ["arm64"]
  role             = aws_iam_role.backup_verify.arn

  # The Lambda maximum. A restore that has not finished by now is caught by the
  # cleanup schedule instead of being waited on until the function is killed.
  timeout = 900

  # Serialises the weekly verify and the half-hourly cleanup. Without this the
  # cleanup could delete the instance of a verify that is still running.
  reserved_concurrent_executions = 1

  # The database password is passed as an environment variable rather than read
  # from Secrets Manager, which keeps this issue self-contained. It does put the
  # password in Lambda configuration, and therefore in state, exactly as the RDS
  # instance already does. The Secrets Manager rotation work (#838) supersedes
  # this and should replace it with a secret read at runtime.
  environment {
    variables = {
      ENVIRONMENT            = var.environment
      SOURCE_DB_INSTANCE_ID  = module.data.db_instance_id
      DB_USERNAME            = module.data.db_username
      DB_NAME                = module.data.db_name
      DB_PASSWORD            = var.db_password
      SECURITY_GROUP_IDS     = aws_security_group.restore_target.id
      EXPECTED_TABLES        = local.backup_verify_tables
      RESTORE_INSTANCE_CLASS = var.backup_restore_test_class
      RESTORE_ID_PREFIX      = "vesting-restore-test"
      METRIC_NAMESPACE       = local.metric_namespace
      METRIC_NAME            = local.metric_name
      RESTORE_TIMEOUT_MS     = "600000"
      DELETE_TIMEOUT_MS      = "120000"
      POLL_INTERVAL_MS       = "20000"
    }
  }

  vpc_config {
    subnet_ids         = module.network.private_subnet_ids
    security_group_ids = [aws_security_group.backup_verify.id]
  }

  depends_on = [
    aws_iam_role_policy.backup_verify,
  ]
}

# ─── Schedules ────────────────────────────────────────────────────────────────

# Sunday 03:00 UTC. RDS's own weekly maintenance window is sun:03:00, and the
# automated backup window is 02:00-03:00, so this runs immediately after the
# window that produces the snapshot being tested.
resource "aws_scheduler_schedule" "verify" {
  name       = "${var.environment}-vesting-backup-verify-weekly"
  group_name = "default"

  schedule_expression = "cron(0 3 ? * SUN *)"

  flexible_time_window {
    mode = "OFF"
  }

  target {
    arn      = aws_lambda_function.backup_verify.arn
    role_arn = aws_iam_role.scheduler.arn
  }
}

resource "aws_scheduler_schedule" "cleanup" {
  name       = "${var.environment}-vesting-backup-verify-cleanup"
  group_name = "default"

  schedule_expression = "rate(30 minutes)"

  flexible_time_window {
    mode = "OFF"
  }

  target {
    arn      = aws_lambda_function.backup_verify.arn
    role_arn = aws_iam_role.scheduler.arn
    input    = jsonencode({ action = "cleanup" })
  }
}

# ─── Paging ───────────────────────────────────────────────────────────────────

resource "aws_sns_topic" "backup_verify_alerts" {
  name              = "${var.environment}-vesting-backup-verify-alerts"
  kms_master_key_id = "alias/aws/sns"
  tags              = { Name = "${var.environment}-vesting-backup-verify-alerts" }
}

resource "aws_sns_topic_subscription" "backup_verify_email" {
  for_each  = var.backup_verify_alert_emails
  topic_arn = aws_sns_topic.backup_verify_alerts.arn
  protocol  = "email"
  endpoint  = each.value
}

resource "aws_sns_topic_subscription" "backup_verify_pagerduty" {
  count = var.pagerduty_integration_key != "" ? 1 : 0

  topic_arn = aws_sns_topic.backup_verify_alerts.arn
  protocol  = "https"
  endpoint  = "https://events.pagerduty.com/integration/${var.pagerduty_integration_key}/enqueue"
}

# ─── Alarm ────────────────────────────────────────────────────────────────────

# One verdict per week, so the period is a week. Statistic is Minimum rather than
# Sum: a single failed restore in the week must alarm even though six successful
# ones would otherwise average it away. Missing data is treated as breaching
# because a week with no verdict at all means the schedule did not run, which is
# exactly the silent failure this issue exists to catch.
resource "aws_cloudwatch_metric_alarm" "backup_restore" {
  alarm_name        = "${var.environment}-backup-restore-failed"
  alarm_description = "The weekly backup restore verification did not report success. Notifies SNS, which pages PagerDuty."

  namespace           = local.metric_namespace
  metric_name         = local.metric_name
  statistic           = "Minimum"
  period              = 604800
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "LessThanThreshold"
  treat_missing_data  = "breaching"

  dimensions = {
    Environment = var.environment
  }

  alarm_actions = [aws_sns_topic.backup_verify_alerts.arn]
  ok_actions    = [aws_sns_topic.backup_verify_alerts.arn]

  tags = { Name = "${var.environment}-backup-restore-failed" }
}
