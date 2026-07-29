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

resource "aws_ce_anomaly_monitor" "services" {
  name              = "${var.environment}-vesting-service-costs"
  monitor_type      = "DIMENSIONAL"
  monitor_dimension = "SERVICE"
}

resource "aws_ce_anomaly_subscription" "daily" {
  name      = "${var.environment}-vesting-cost-anomalies"
  frequency = "DAILY"

  monitor_arn_list = [aws_ce_anomaly_monitor.services.arn]

  threshold_expression {
    and {
      dimension {
        key           = "ANOMALY_TOTAL_IMPACT_ABSOLUTE"
        values        = ["25"]
        match_options = ["GREATER_THAN_OR_EQUAL"]
      }
    }
  }

  dynamic "subscriber" {
    for_each = var.cost_alert_emails
    content {
      type    = "EMAIL"
      address = subscriber.value
    }
  }
}

resource "aws_cloudwatch_dashboard" "cost" {
  dashboard_name = "${var.environment}-vesting-cost-monitoring"
  dashboard_body = jsonencode({
    widgets = [{
      type = "metric", x = 0, y = 0, width = 24, height = 6,
      properties = {
        title   = "Estimated AWS charges"
        view    = "timeSeries"
        region  = "us-east-1"
        stat    = "Maximum"
        period  = 21600
        metrics = [["AWS/Billing", "EstimatedCharges", "Currency", "USD"]]
      }
    }]
  })
}
