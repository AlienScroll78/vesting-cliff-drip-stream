# ─── Budget Alerts ────────────────────────────────────────────────────────────

# Three thresholds on one budget:
#   80% forecasted — lead time to act before the limit is crossed
#   80% actual     — confirms the forecast was right, and is the threshold the
#                    artificial-overage test in the runbook exercises
#   100% actual    — the hard stop
# All three fan out to email and to the SNS topic that feeds the Slack relay,
# so a budget breach is visible in #ops within seconds.
resource "aws_budgets_budget" "monthly" {
  name         = "${var.environment}-vesting-monthly-cost"
  budget_type  = "COST"
  limit_amount = tostring(var.monthly_budget_limit_usd)
  limit_unit   = "USD"
  time_unit    = "MONTHLY"

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 80
    threshold_type             = "PERCENTAGE"
    notification_type          = "FORECASTED"
    subscriber_email_addresses = tolist(var.cost_alert_emails)
    subscriber_sns_topic_arns  = [aws_sns_topic.cost_alerts.arn]
  }

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 80
    threshold_type             = "PERCENTAGE"
    notification_type          = "ACTUAL"
    subscriber_email_addresses = tolist(var.cost_alert_emails)
    subscriber_sns_topic_arns  = [aws_sns_topic.cost_alerts.arn]
  }

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 100
    threshold_type             = "PERCENTAGE"
    notification_type          = "ACTUAL"
    subscriber_email_addresses = tolist(var.cost_alert_emails)
    subscriber_sns_topic_arns  = [aws_sns_topic.cost_alerts.arn]
  }
}

# ─── Cost allocation tag group ───────────────────────────────────────────────

# Activating Project as a cost allocation tag is what makes the `vesting-drips`
# group selectable in Cost Explorer. Every resource in this stack carries it via
# default_tags, so the whole bill attributes to the group.
resource "aws_ce_cost_allocation_tag" "project" {
  tag_key   = "Project"
  tag_value = var.project_name
}

# ─── SNS Topic for Cost Alerts (email + Slack) ──────────────────────────────

resource "aws_sns_topic" "cost_alerts" {
  name = "${var.environment}-vesting-cost-alerts"
}

resource "aws_sns_topic_subscription" "email" {
  for_each  = var.cost_alert_emails
  topic_arn = aws_sns_topic.cost_alerts.arn
  protocol  = "email"
  endpoint  = each.value
}

# The budget service, the Cost Explorer anomaly service and the monthly report
# scheduler all publish here, and none of them is covered by the default topic
# policy.
data "aws_iam_policy_document" "cost_alerts" {
  statement {
    sid       = "AllowCostServicesPublish"
    effect    = "Allow"
    actions   = ["SNS:Publish"]
    resources = [aws_sns_topic.cost_alerts.arn]

    principals {
      type        = "Service"
      identifiers = ["budgets.amazonaws.com", "costalerts.amazonaws.com"]
    }
  }
}

resource "aws_sns_topic_policy" "cost_alerts" {
  arn    = aws_sns_topic.cost_alerts.arn
  policy = data.aws_iam_policy_document.cost_alerts.json
}

# ─── Cost Anomaly Detectors ──────────────────────────────────────────────────

# All-service monitor (existing behaviour)
resource "aws_ce_anomaly_monitor" "services" {
  name              = "${var.environment}-vesting-service-costs"
  monitor_type      = "DIMENSIONAL"
  monitor_dimension = "SERVICE"
}

# ECS-specific monitor
resource "aws_ce_anomaly_monitor" "ecs" {
  name         = "${var.environment}-vesting-ecs-costs"
  monitor_type = "CUSTOM"
  monitor = jsonencode({
    Dimensions = {
      Key           = "SERVICE"
      Values        = ["Amazon Elastic Container Service", "Amazon Elastic Container Service for Kubernetes", "AWS Fargate"]
      MatchOptions  = ["EQUALS"]
    }
  })
}

# RDS-specific monitor
resource "aws_ce_anomaly_monitor" "rds" {
  name         = "${var.environment}-vesting-rds-costs"
  monitor_type = "CUSTOM"
  monitor = jsonencode({
    Dimensions = {
      Key           = "SERVICE"
      Values        = ["Amazon Relational Database Service", "Amazon ElastiCache"]
      MatchOptions  = ["EQUALS"]
    }
  })
}

# ─── Anomaly Subscriptions (20% threshold) ──────────────────────────────────

# All-service anomaly subscription — notifies via email + SNS
resource "aws_ce_anomaly_subscription" "daily" {
  name      = "${var.environment}-vesting-cost-anomalies"
  frequency = "DAILY"

  monitor_arn_list = [
    aws_ce_anomaly_monitor.services.arn,
    aws_ce_anomaly_monitor.ecs.arn,
    aws_ce_anomaly_monitor.rds.arn,
  ]

  threshold_expression {
    and {
      dimension {
        key           = "ANOMALY_TOTAL_IMPACT_ABSOLUTE"
        values        = ["20"]
        match_options = ["GREATER_THAN_OR_EQUAL"]
      }
    }
  }

  # Email subscribers
  dynamic "subscriber" {
    for_each = var.cost_alert_emails
    content {
      type    = "EMAIL"
      address = subscriber.value
    }
  }

  # SNS subscriber for Slack relay
  subscriber {
    type    = "SNS"
    address = aws_sns_topic.cost_alerts.arn
  }
}

# ─── Slack Relay (SNS → Lambda → Slack webhook) ─────────────────────────────

data "archive_file" "slack_lambda" {
  type        = "zip"
  source_file = "${path.module}/lambdas/cost-slack-relay/index.js"
  output_path = "${path.module}/lambdas/cost-slack-relay.zip"
}

data "aws_iam_policy_document" "slack_lambda_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "slack_lambda" {
  name               = "${var.environment}-cost-slack-relay"
  assume_role_policy = data.aws_iam_policy_document.slack_lambda_assume.json
}

resource "aws_iam_role_policy_attachment" "slack_lambda_basic" {
  role       = aws_iam_role.slack_lambda.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

# Allow the Lambda to publish to CloudWatch Logs (daily report)
resource "aws_cloudwatch_log_group" "cost_daily_report" {
  name              = "/aws/lambda/${var.environment}-cost-slack-relay"
  retention_in_days = 90
}

resource "aws_lambda_function" "slack_relay" {
  filename         = data.archive_file.slack_lambda.output_path
  function_name    = "${var.environment}-cost-slack-relay"
  role             = aws_iam_role.slack_lambda.arn
  handler          = "index.handler"
  runtime          = "nodejs20.x"
  timeout          = 30
  source_code_hash = data.archive_file.slack_lambda.output_base64sha256

  environment {
    variables = {
      # Reference only — the webhook value itself is fetched from Secrets
      # Manager at invoke time, so it never lands in the task configuration.
      SLACK_WEBHOOK_SECRET_ARN = module.secrets.slack_webhook_url_arn
      SLACK_CHANNEL            = "#ops"
    }
  }
}

data "aws_iam_policy_document" "slack_lambda" {
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

resource "aws_iam_role_policy" "slack_lambda" {
  name   = "${var.environment}-cost-slack-relay-secrets"
  role   = aws_iam_role.slack_lambda.id
  policy = data.aws_iam_policy_document.slack_lambda.json
}

resource "aws_sns_topic_subscription" "slack_lambda" {
  topic_arn = aws_sns_topic.cost_alerts.arn
  protocol  = "lambda"
  endpoint  = aws_lambda_function.slack_relay.arn
}

resource "aws_lambda_permission" "sns_invoke" {
  statement_id  = "AllowSNSToInvokeLambda"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.slack_relay.function_name
  principal     = "sns.amazonaws.com"
  source_arn    = aws_sns_topic.cost_alerts.arn
}

# ─── Monthly Cost Report ─────────────────────────────────────────────────────

# Runs on the 2nd at 07:00 UTC. Cost Explorer lags roughly 24 hours, so the 1st
# would report a partial month; the 2nd is the first day the previous month is
# complete.
resource "aws_scheduler_schedule" "monthly_cost_report" {
  name                = "${var.environment}-vesting-monthly-cost-report"
  group_name          = "default"
  schedule_expression = "cron(0 7 2 * ? *)"

  flexible_time_window {
    mode = "OFF"
  }

  target {
    arn      = aws_lambda_function.monthly_cost_report.arn
    role_arn = aws_iam_role.monthly_cost_report.arn
  }
}

data "archive_file" "monthly_cost_report" {
  type        = "zip"
  source_file = "${path.module}/lambdas/monthly-cost-report/index.js"
  output_path = "${path.module}/lambdas/monthly-cost-report.zip"
}

data "aws_iam_policy_document" "monthly_cost_report_assume" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com", "scheduler.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "monthly_cost_report" {
  name               = "${var.environment}-monthly-cost-report"
  assume_role_policy = data.aws_iam_policy_document.monthly_cost_report_assume.json
}

resource "aws_iam_role_policy_attachment" "monthly_cost_report_basic" {
  role       = aws_iam_role.monthly_cost_report.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

data "aws_iam_policy_document" "monthly_cost_report" {
  statement {
    sid    = "ReadCostExplorer"
    effect = "Allow"
    actions = [
      "ce:GetBudgets",
      "ce:GetCostAndUsage",
      "ce:GetTags",
    ]
    resources = ["*"]
  }

  statement {
    sid       = "PublishReport"
    effect    = "Allow"
    actions   = ["SNS:Publish"]
    resources = [aws_sns_topic.cost_alerts.arn]
  }

  # EventBridge Scheduler assumes this role to invoke the function, so the
  # function grants itself the invoke rather than needing a second role.
  statement {
    sid       = "AllowSchedulerInvoke"
    effect    = "Allow"
    actions   = ["lambda:InvokeFunction"]
    resources = [aws_lambda_function.monthly_cost_report.arn]
  }
}

resource "aws_iam_role_policy" "monthly_cost_report" {
  name   = "${var.environment}-monthly-cost-report"
  role   = aws_iam_role.monthly_cost_report.id
  policy = data.aws_iam_policy_document.monthly_cost_report.json
}

resource "aws_cloudwatch_log_group" "monthly_cost_report" {
  name              = "/aws/lambda/${var.environment}-monthly-cost-report"
  retention_in_days = 365
}

resource "aws_lambda_function" "monthly_cost_report" {
  filename         = data.archive_file.monthly_cost_report.output_path
  function_name    = "${var.environment}-monthly-cost-report"
  role             = aws_iam_role.monthly_cost_report.arn
  handler          = "index.handler"
  runtime          = "nodejs20.x"
  timeout          = 120
  source_code_hash = data.archive_file.monthly_cost_report.output_base64sha256

  environment {
    variables = {
      SNS_TOPIC_ARN  = aws_sns_topic.cost_alerts.arn
      ENVIRONMENT    = var.environment
      BUDGET_NAME    = aws_budgets_budget.monthly.name
      PROJECT_TAG_KEY = "Project"
    }
  }
}

resource "aws_lambda_permission" "monthly_cost_report_invoke" {
  statement_id  = "AllowSchedulerToInvokeMonthlyCostReport"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.monthly_cost_report.function_name
  principal     = "scheduler.amazonaws.com"
  source_arn    = aws_scheduler_schedule.monthly_cost_report.arn
}

# ─── CloudWatch Dashboard ────────────────────────────────────────────────────

resource "aws_cloudwatch_dashboard" "cost" {
  dashboard_name = "${var.environment}-vesting-cost-monitoring"
  dashboard_body = jsonencode({
    widgets = [
      {
        type = "metric", x = 0, y = 0, width = 24, height = 6,
        properties = {
          title   = "Estimated AWS charges"
          view    = "timeSeries"
          region  = "us-east-1"
          stat    = "Maximum"
          period  = 21600
          metrics = [["AWS/Billing", "EstimatedCharges", "Currency", "USD"]]
        }
      },
      {
        type = "text", x = 0, y = 6, width = 24, height = 4,
        properties = {
          markdown = join("\n", [
            "### Budget",
            format(
              "- **Limit:** $%d / month (%s)",
              var.monthly_budget_limit_usd,
              aws_budgets_budget.monthly.name
            ),
            "- **Thresholds:** 80% forecasted, 80% actual, 100% actual",
            "- **Cost allocation tag:** Project = ${var.project_name}",
            "",
            "### Anomaly Monitors",
            "- **All Services** — ${aws_ce_anomaly_monitor.services.name}",
            "- **ECS/Fargate** — ${aws_ce_anomaly_monitor.ecs.name}",
            "- **RDS** — ${aws_ce_anomaly_monitor.rds.name}",
            "",
            "### Monthly report",
            "- Scheduled `cron(0 7 2 * ? *)` → ${aws_lambda_function.monthly_cost_report.function_name}",
            "- Posts to ${aws_sns_topic.cost_alerts.name} (email + Slack #ops)",
            "",
            "Alerts: Email (cost_alert_emails) + Slack #ops (via SNS → Lambda)",
          ])
        }
      },
    ]
  })
}
