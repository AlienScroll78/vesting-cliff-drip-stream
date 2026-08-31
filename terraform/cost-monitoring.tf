# ─── Budget Alerts ────────────────────────────────────────────────────────────

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
  }

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 100
    threshold_type             = "PERCENTAGE"
    notification_type          = "ACTUAL"
    subscriber_email_addresses = tolist(var.cost_alert_emails)
  }
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

# ─── Cost Anomaly Detectors ──────────────────────────────────────────────────

# All-service monitor (existing behaviour)
resource "aws_ce_anomaly_monitor" "services" {
  name              = "${var.environment}-vesting-service-costs"
  monitor_type      = "DIMENSIONAL"
  monitor_dimension = "SERVICE"
}

# ECS-specific monitor
resource "aws_ce_anomaly_monitor" "ecs" {
  name              = "${var.environment}-vesting-ecs-costs"
  monitor_type      = "CUSTOM"
  monitor_expression = <<-EOT
    CostCategory.ServiceCode = "AmazonECS"
    OR CostCategory.ServiceCode = "AmazonEC2ContainerService"
    OR CostCategory.ServiceCode = "AWS Fargate"
  EOT
}

# RDS-specific monitor
resource "aws_ce_anomaly_monitor" "rds" {
  name              = "${var.environment}-vesting-rds-costs"
  monitor_type      = "CUSTOM"
  monitor_expression = <<-EOT
    CostCategory.ServiceCode = "AmazonRDS"
    OR CostCategory.ServiceCode = "Amazon ElastiCache"
  EOT
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
      SLACK_WEBHOOK_URL = var.slack_webhook_url
      SLACK_CHANNEL     = "#ops"
    }
  }
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
        type = "text", x = 0, y = 6, width = 24, height = 2,
        properties = {
          markdown = "### Anomaly Monitors\n- **All Services** — ${aws_ce_anomaly_monitor.services.name}\n- **ECS/Fargate** — ${aws_ce_anomaly_monitor.ecs.name}\n- **RDS** — ${aws_ce_anomaly_monitor.rds.name}\n\nThreshold: >20% anomaly vs. historical baseline\nAlerts: Email (cost_alert_emails) + Slack #ops (via SNS → Lambda)"
        }
      },
    ]
  })
}
