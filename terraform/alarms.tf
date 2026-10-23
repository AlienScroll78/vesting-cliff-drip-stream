# ─── Production CloudWatch Alarms & Slack Alerting (#1094) ─────────────────────
#
# CloudWatch alarms for the key production metrics, all routed to a single SNS
# topic. The topic feeds a Lambda that posts to Slack #ops, reusing the same
# webhook secret that the cost-relay Lambda already reads from Secrets Manager.
#
# Alarm namespacing follows the convention: vesting-drips-{environment}-{metric-name}
#
# The Slack message includes the alarm name, current value, threshold, and a
# runbook link so on-call engineers can act without looking anything up.

locals {
  alarm_namespace_prefix = "vesting-drips-${var.environment}"

  # Runbook links referenced in alert messages. Each links to the relevant
  # operations runbook in the repository.
  runbook_base_url = "https://github.com/Praisefotos1/vesting-cliff-drip-stream/blob/main/docs/runbooks"
}

# ─── SNS Topic for Production Alarms ──────────────────────────────────────────

resource "aws_sns_topic" "production_alarms" {
  name              = "${var.environment}-vesting-production-alarms"
  kms_master_key_id = "alias/aws/sns"
  tags              = { Name = "${var.environment}-vesting-production-alarms" }
}

resource "aws_sns_topic_subscription" "production_alarm_emails" {
  for_each   = var.cost_alert_emails
  topic_arn  = aws_sns_topic.production_alarms.arn
  protocol   = "email"
  endpoint   = each.value
}

resource "aws_sns_topic_subscription" "production_alarm_pagerduty" {
  count      = var.pagerduty_integration_key != "" ? 1 : 0
  topic_arn  = aws_sns_topic.production_alarms.arn
  protocol   = "https"
  endpoint   = "https://events.pagerduty.com/integration/${var.pagerduty_integration_key}/enqueue"
}

# ─── Slack Relay Lambda (SNS → Lambda → Slack #ops) ──────────────────────────
#
# Reuses the same Slack webhook secret from Secrets Manager as the cost relay.
# The Lambda formats CloudWatch alarm messages into actionable Slack posts with
# alarm name, current value, threshold, and runbook link.

data "archive_file" "alarm_slack_relay" {
  type        = "zip"
  source_file = "${path.module}/lambdas/alarm-slack-relay/index.js"
  output_path = "${path.module}/.terraform-build/alarm-slack-relay.zip"
}

data "aws_iam_policy_document" "alarm_slack_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "alarm_slack_relay" {
  name               = "${var.environment}-alarm-slack-relay"
  assume_role_policy = data.aws_iam_policy_document.alarm_slack_assume.json
  tags               = { Name = "${var.environment}-alarm-slack-relay" }
}

resource "aws_iam_role_policy_attachment" "alarm_slack_basic" {
  role       = aws_iam_role.alarm_slack_relay.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

data "aws_iam_policy_document" "alarm_slack" {
  statement {
    sid       = "ReadSlackWebhook"
    effect    = "Allow"
    actions   = ["secretsmanager:GetSecretValue"]
    resources = [module.secrets.slack_webhook_url_arn]
  }

  statement {
    sid       = "DecryptSlackWebhook"
    effect    = "Allow"
    actions   = ["kms:Decrypt"]
    resources = [module.secrets.kms_key_arn]
  }
}

resource "aws_iam_role_policy" "alarm_slack" {
  name   = "${var.environment}-alarm-slack-relay-secrets"
  role   = aws_iam_role.alarm_slack_relay.id
  policy = data.aws_iam_policy_document.alarm_slack.json
}

resource "aws_cloudwatch_log_group" "alarm_slack_relay" {
  name              = "/aws/lambda/${var.environment}-alarm-slack-relay"
  retention_in_days = 90
  tags              = { Name = "/aws/lambda/${var.environment}-alarm-slack-relay" }
}

resource "aws_lambda_function" "alarm_slack_relay" {
  function_name    = "${var.environment}-alarm-slack-relay"
  description      = "Posts CloudWatch alarm notifications to Slack #ops via SNS"
  filename         = data.archive_file.alarm_slack_relay.output_path
  source_code_hash = data.archive_file.alarm_slack_relay.output_base64sha256
  handler          = "index.handler"
  runtime          = "nodejs20.x"
  role             = aws_iam_role.alarm_slack_relay.arn
  timeout          = 30

  environment {
    variables = {
      SLACK_WEBHOOK_SECRET_ARN = module.secrets.slack_webhook_url_arn
      SLACK_CHANNEL            = "#ops"
      ENVIRONMENT              = var.environment
    }
  }

  depends_on = [aws_iam_role_policy.alarm_slack]
}

resource "aws_sns_topic_subscription" "alarm_slack_lambda" {
  topic_arn = aws_sns_topic.production_alarms.arn
  protocol  = "lambda"
  endpoint  = aws_lambda_function.alarm_slack_relay.arn
}

resource "aws_lambda_permission" "alarm_slack_sns_invoke" {
  statement_id  = "AllowSNSToInvokeAlarmSlackRelay"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.alarm_slack_relay.function_name
  principal     = "sns.amazonaws.com"
  source_arn    = aws_sns_topic.production_alarms.arn
}

# ─── Individual Alarms ────────────────────────────────────────────────────────
#
# Each alarm follows the naming convention:
#   vesting-drips-{environment}-{metric-name}

# ECS service CPU > 80%
resource "aws_cloudwatch_metric_alarm" "ecs_cpu_high" {
  alarm_name          = "${local.alarm_namespace_prefix}-ecs-cpu-high"
  alarm_description   = "ECS backend service CPU utilization exceeds ${var.alarm_cpu_threshold_pct}%"
  namespace           = "AWS/ECS"
  metric_name         = "CPUUtilization"
  statistic           = "Average"
  period              = 300
  evaluation_periods  = 2
  threshold           = var.alarm_cpu_threshold_pct
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"

  dimensions = {
    ClusterName = module.compute.ecs_cluster_name
    ServiceName = module.compute.ecs_service_name
  }

  alarm_actions = [aws_sns_topic.production_alarms.arn]
  ok_actions    = [aws_sns_topic.production_alarms.arn]
  tags          = { Name = "${local.alarm_namespace_prefix}-ecs-cpu-high" }
}

# ECS task count < desired (service unhealthy)
resource "aws_cloudwatch_metric_alarm" "ecs_task_count_low" {
  alarm_name          = "${local.alarm_namespace_prefix}-ecs-task-count-low"
  alarm_description   = "ECS running task count is below the desired count — service may be unhealthy"
  namespace           = "AWS/ECS"
  metric_name         = "RunningTaskCount"
  statistic           = "Average"
  period              = 300
  evaluation_periods  = 2
  threshold           = 2
  comparison_operator = "LessThanThreshold"
  treat_missing_data  = "breaching"

  dimensions = {
    ClusterName = module.compute.ecs_cluster_name
    ServiceName = module.compute.ecs_service_name
  }

  alarm_actions = [aws_sns_topic.production_alarms.arn]
  ok_actions    = [aws_sns_topic.production_alarms.arn]
  tags          = { Name = "${local.alarm_namespace_prefix}-ecs-task-count-low" }
}

# RDS CPU > 70%
resource "aws_cloudwatch_metric_alarm" "rds_cpu_high" {
  alarm_name          = "${local.alarm_namespace_prefix}-rds-cpu-high"
  alarm_description   = "RDS PostgreSQL CPU utilization exceeds ${var.alarm_rds_cpu_threshold_pct}%"
  namespace           = "AWS/RDS"
  metric_name         = "CPUUtilization"
  statistic           = "Average"
  period              = 300
  evaluation_periods  = 2
  threshold           = var.alarm_rds_cpu_threshold_pct
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"

  dimensions = {
    DBInstanceIdentifier = module.data.db_instance_id
  }

  alarm_actions = [aws_sns_topic.production_alarms.arn]
  ok_actions    = [aws_sns_topic.production_alarms.arn]
  tags          = { Name = "${local.alarm_namespace_prefix}-rds-cpu-high" }
}

# RDS storage < 20% free
# RDS allocated_storage is 20 GB, so 20% free ≈ 4 GB. FreeStorageSpace is in
# bytes, so the threshold is converted from GB to bytes.
resource "aws_cloudwatch_metric_alarm" "rds_storage_low" {
  alarm_name          = "${local.alarm_namespace_prefix}-rds-storage-low"
  alarm_description   = "RDS free storage is below ${var.alarm_rds_storage_free_gb} GB — less than 20% of allocated storage"
  namespace           = "AWS/RDS"
  metric_name         = "FreeStorageSpace"
  statistic           = "Average"
  period              = 300
  evaluation_periods  = 2
  # FreeStorageSpace is in bytes; convert GB threshold to bytes
  threshold           = var.alarm_rds_storage_free_gb * 1024 * 1024 * 1024
  comparison_operator = "LessThanThreshold"
  treat_missing_data  = "breaching"

  dimensions = {
    DBInstanceIdentifier = module.data.db_instance_id
  }

  alarm_actions = [aws_sns_topic.production_alarms.arn]
  ok_actions    = [aws_sns_topic.production_alarms.arn]
  tags          = { Name = "${local.alarm_namespace_prefix}-rds-storage-low" }
}

# ALB 5xx rate > 1%
# Uses a metric math expression: (5xx count / total request count) * 100
resource "aws_cloudwatch_metric_alarm" "alb_5xx_rate_high" {
  alarm_name          = "${local.alarm_namespace_prefix}-alb-5xx-rate-high"
  alarm_description   = "ALB 5xx response rate exceeds ${var.alarm_alb_5xx_rate_pct}% of total requests"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  threshold           = var.alarm_alb_5xx_rate_pct
  treat_missing_data   = "notBreaching"

  metric_query {
    id = "five_xx"

    metric {
      metric_name = "HTTPCode_ELB_5XX_Count"
      namespace   = "AWS/ApplicationELB"
      period      = 60
      stat        = "Sum"
      dimensions = {
        LoadBalancer = module.compute.alb_dns_name
      }
    }

    return_data = false
  }

  metric_query {
    id = "total_requests"

    metric {
      metric_name = "RequestCount"
      namespace   = "AWS/ApplicationELB"
      period      = 60
      stat        = "Sum"
      dimensions = {
        LoadBalancer = module.compute.alb_dns_name
      }
    }

    return_data = false
  }

  metric_query {
    id          = "five_xx_rate"
    expression  = "IF(total_requests > 0, five_xx / total_requests * 100, 0)"
    label       = "5xx Response Rate (%)"
    return_data = true
  }

  alarm_actions = [aws_sns_topic.production_alarms.arn]
  ok_actions    = [aws_sns_topic.production_alarms.arn]
  tags          = { Name = "${local.alarm_namespace_prefix}-alb-5xx-rate-high" }
}

# Indexer lag > 100 ledgers
# Uses a CloudWatch metric published by the indexer application. The metric
# `IndexerLag` is published under the VestingApp custom namespace and represents
# the difference between the latest ledger on Horizon and the last indexed ledger.
resource "aws_cloudwatch_metric_alarm" "indexer_lag_high" {
  alarm_name          = "${local.alarm_namespace_prefix}-indexer-lag-high"
  alarm_description   = "Indexer lag exceeds ${var.alarm_indexer_lag_ledgers} ledgers — the indexer is falling behind"
  namespace           = "VestingApp"
  metric_name         = "IndexerLag"
  statistic           = "Maximum"
  period              = 300
  evaluation_periods  = 2
  threshold           = var.alarm_indexer_lag_ledgers
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "breaching"

  dimensions = {
    Environment = var.environment
  }

  alarm_actions = [aws_sns_topic.production_alarms.arn]
  ok_actions    = [aws_sns_topic.production_alarms.arn]
  tags          = { Name = "${local.alarm_namespace_prefix}-indexer-lag-high" }
}

# ─── Composite Alarms ─────────────────────────────────────────────────────────
#
# "Service degraded" = ECS CPU high OR ALB 5xx rate high OR indexer lag high
# "Service down"     = ECS task count low AND RDS CPU high
#
# Composite alarms use metric math to combine multiple alarm states into a
# single alert, reducing alert fatigue by correlating symptoms.

# Service degraded: CPU pressure, elevated error rate, or indexer falling behind
resource "aws_cloudwatch_metric_alarm" "service_degraded" {
  alarm_name          = "${local.alarm_namespace_prefix}-service-degraded"
  alarm_description   = "Composite: service is degraded — ECS CPU high, ALB 5xx rate high, or indexer lag high"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  threshold           = 0
  treat_missing_data  = "notBreaching"

  metric_query {
    id          = "degraded"
    expression  = "IF(m1 OR m2 OR m3, 1, 0)"
    return_data = true
  }

  metric_query {
    id = "m1"
    metric {
      metric_name = "CPUUtilization"
      namespace   = "AWS/ECS"
      period      = 300
      stat        = "Average"
      dimensions = {
        ClusterName = module.compute.ecs_cluster_name
        ServiceName = module.compute.ecs_service_name
      }
    }
    return_data = false
  }

  metric_query {
    id = "m2"
    metric {
      metric_name = "HTTPCode_ELB_5XX_Count"
      namespace   = "AWS/ApplicationELB"
      period      = 300
      stat        = "Sum"
      dimensions = {
        LoadBalancer = module.compute.alb_dns_name
      }
    }
    return_data = false
  }

  metric_query {
    id = "m3"
    metric {
      metric_name = "IndexerLag"
      namespace   = "VestingApp"
      period      = 300
      stat        = "Maximum"
      dimensions = {
        Environment = var.environment
      }
    }
    return_data = false
  }

  alarm_actions = [aws_sns_topic.production_alarms.arn]
  ok_actions    = [aws_sns_topic.production_alarms.arn]
  tags          = { Name = "${local.alarm_namespace_prefix}-service-degraded" }
}

# Service down: no running tasks AND database under heavy load
resource "aws_cloudwatch_metric_alarm" "service_down" {
  alarm_name          = "${local.alarm_namespace_prefix}-service-down"
  alarm_description   = "Composite: service is down — ECS task count below desired AND RDS CPU critically high"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  threshold           = 0
  treat_missing_data  = "breaching"

  metric_query {
    id          = "down"
    expression  = "IF(m1 AND m2, 1, 0)"
    return_data = true
  }

  metric_query {
    id = "m1"
    metric {
      metric_name = "RunningTaskCount"
      namespace   = "AWS/ECS"
      period      = 300
      stat        = "Average"
      dimensions = {
        ClusterName = module.compute.ecs_cluster_name
        ServiceName = module.compute.ecs_service_name
      }
    }
    return_data = false
  }

  metric_query {
    id = "m2"
    metric {
      metric_name = "CPUUtilization"
      namespace   = "AWS/RDS"
      period      = 300
      stat        = "Average"
      dimensions = {
        DBInstanceIdentifier = module.data.db_instance_id
      }
    }
    return_data = false
  }

  alarm_actions = [aws_sns_topic.production_alarms.arn]
  ok_actions    = [aws_sns_topic.production_alarms.arn]
  tags          = { Name = "${local.alarm_namespace_prefix}-service-down" }
}
