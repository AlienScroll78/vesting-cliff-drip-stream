# ─── Log Aggregation Pipeline ─────────────────────────────────────────────────
#
# Every application log group, the metric filters that turn log lines into
# metrics, the alarm that pages, and the saved Log Insights queries all live
# here so the whole pipeline can be read in one place.
#
#   ECS task
#     app container ──writes JSON lines──> /var/log/vesting/app.log
#                                               │ (shared ephemeral volume)
#     fluentbit     ──tails, every 1s──────────> │
#                            flushes every 5s ──> CloudWatch Logs /ecs/api-server
#                                               │
#                                  metric filter { $.level = "error" }
#                                               v
#                                     VestingApp/ApplicationErrorCount
#                                               │
#                                     alarm: > 10 in 5 min
#                                               v
#                                    SNS ──> PagerDuty (page)
#                                        └─> email
#
# Two details are load-bearing and easy to get wrong:
#
#   1. The app container keeps its own `awslogs` driver pointed at the same log
#      group. That is deliberate redundancy, not a duplicate-write bug: if the
#      shipper is OOM-killed or its stream is rejected, stdout still lands in
#      CloudWatch. See "Failure modes" in docs/runbooks/cloudwatch-logs.md.
#
#   2. The metric filters publish with no dimensions, so one metric covers every
#      application log group and a single alarm can page on the total. The
#      default would be LogGroupName + LogStreamName dimensions, and an alarm
#      without matching dimensions silently never fires.

locals {
  metric_namespace = "VestingApp"

  # Application log groups, one per ECS workload.
  ecs_log_groups = ["/ecs/api-server", "/ecs/indexer"]

  # RDS writes PostgreSQL logs to a group whose name is derived from the
  # instance id, and it does not let us choose one -- so this is the real path
  # rather than the /rds/postgresql the issue asked for. Managing it here is
  # still an improvement over leaving it alone: an RDS log group defaults to
  # "Never expire", so without this the audit logs would grow without bound and
  # cost more over time than the rest of the pipeline combined.
  rds_log_group = module.data.rds_postgresql_log_group_name

  # Metric filters and saved queries cover the application groups and the
  # database group.
  observed_log_groups = concat(local.ecs_log_groups, [local.rds_log_group])

  saved_queries = {
    "recent-events" = <<-EOT
      fields @timestamp, level, service, env, msg
      | sort @timestamp desc
      | limit 50
    EOT

    "error-rate-by-minute" = <<-EOT
      fields @timestamp
      | filter level = "error"
      | stats count() as errors by bin(1m)
      | sort @timestamp desc
      | limit 60
    EOT

    "top-errors" = <<-EOT
      fields @timestamp, service, msg
      | filter level = "error"
      | stats count() as occurrences by service, msg
      | sort occurrences desc
      | limit 25
    EOT

    "errors-by-service" = <<-EOT
      fields @timestamp, service
      | filter level = "error"
      | stats count() as errors by service, bin(1h)
      | sort errors desc
    EOT

    "indexer-warnings" = <<-EOT
      fields @timestamp, service, msg
      | filter level = "warn" and service = "indexer"
      | sort @timestamp desc
      | limit 50
    EOT

    # Proves the "visible within 30 seconds" acceptance criterion: `ts` is
    # written by the app at emit time, @timestamp is CloudWatch's ingest time.
    "ingest-lag" = <<-EOT
      fields @timestamp, ts
      | filter ispresent(ts)
      | stats min(dateDiff('second', ts, @timestamp)) as min_lag_s,
              avg(dateDiff('second', ts, @timestamp)) as avg_lag_s,
              max(dateDiff('second', ts, @timestamp)) as max_lag_s
        by bin(5m)
      | sort @timestamp desc
      | limit 12
    EOT

    "trace-by-request-id" = <<-EOT
      fields @timestamp, level, service, msg
      | filter requestId = "REPLACE_WITH_REQUEST_ID"
      | sort @timestamp asc
      | limit 200
    EOT

    "rds-errors" = <<-EOT
      fields @timestamp, @message
      | filter @message like /ERROR/ or @message like /FATAL/ or @message like /PANIC/
      | sort @timestamp desc
      | limit 50
    EOT
  }
}

# ─── Log Groups ───────────────────────────────────────────────────────────────

# Application logs: 90 days.
resource "aws_cloudwatch_log_group" "ecs" {
  for_each = toset(local.ecs_log_groups)

  name              = each.value
  retention_in_days = var.application_log_retention_days
  tags              = { Name = each.value }
}

# Audit and access logs: 1 year. Created at the exact name RDS exports to, so
# that retention applies from the first log event. See the note on
# `local.rds_log_group` for why this is not a name we get to pick.
resource "aws_cloudwatch_log_group" "rds" {
  name              = local.rds_log_group
  retention_in_days = var.audit_log_retention_days
  tags              = { Name = local.rds_log_group }
}

# The shipper's own diagnostics. Worth keeping: when the pipeline stops shipping
# application logs, this is the only place that says why.
resource "aws_cloudwatch_log_group" "fluentbit" {
  name              = "/ecs/fluent-bit-internal"
  retention_in_days = var.application_log_retention_days
  tags              = { Name = "/ecs/fluent-bit-internal" }
}

# ─── Metric Filters ───────────────────────────────────────────────────────────

# ERROR -> ApplicationErrorCount. The pattern is JSON rather than a text match so
# it keys off the structured `level` field instead of the substring "error",
# which would also fire on an error object logged at warn.
#
# The literal must be lowercase. CloudWatch JSON patterns compare strings
# case-sensitively and the logger writes pino-style lowercase levels, so an
# "ERROR" pattern matches nothing at all and the alarm below stays permanently
# OK. That failure is silent, which is why it is called out here.
#
# Application groups only. RDS emits PostgreSQL's own text log format, so a JSON
# pattern would never match there; database errors are surfaced by the
# `rds-errors` saved query instead.
resource "aws_cloudwatch_log_metric_filter" "errors" {
  for_each = toset(local.ecs_log_groups)

  name           = "${var.environment}-application-errors"
  log_group_name = each.value
  pattern        = "{ $.level = \"error\" }"

  metric_transformation {
    name          = "ApplicationErrorCount"
    namespace     = local.metric_namespace
    value         = "1"
    default_value = 0
    unit          = "Count"
  }
}

# WARN + indexer -> IndexerWarningCount. Tracked as a metric rather than an alarm
# on purpose: an indexer warning means the Horizon cursor is drifting, which is
# worth trending but must not page at 3am.
resource "aws_cloudwatch_log_metric_filter" "indexer_warnings" {
  name           = "${var.environment}-indexer-warnings"
  log_group_name = "/ecs/indexer"
  pattern        = "{ $.level = \"warn\" && $.service = \"indexer\" }"

  metric_transformation {
    name          = "IndexerWarningCount"
    namespace     = local.metric_namespace
    value         = "1"
    default_value = 0
    unit          = "Count"
  }
}

# ─── Paging ───────────────────────────────────────────────────────────────────

resource "aws_sns_topic" "logging_alerts" {
  name              = "${var.environment}-vesting-logging-alerts"
  kms_master_key_id = "alias/aws/sns"
}

resource "aws_sns_topic_subscription" "logging_email" {
  for_each  = var.log_alert_emails
  topic_arn = aws_sns_topic.logging_alerts.arn
  protocol  = "email"
  endpoint  = each.value
}

# PagerDuty's "Amazon SNS" integration. The endpoint is PagerDuty's per-service
# integration URL, which embeds the integration key; PagerDuty auto-confirms the
# subscription, so no one has to click a confirmation email.
#
# Consequence: the integration key lives in Terraform state. Treat the state
# bucket as a secret store, and rotate the key if the state is ever exposed.
resource "aws_sns_topic_subscription" "pagerduty" {
  count = var.pagerduty_integration_key != "" ? 1 : 0

  topic_arn = aws_sns_topic.logging_alerts.arn
  protocol  = "https"
  endpoint  = "https://events.pagerduty.com/integration/${var.pagerduty_integration_key}/enqueue"
}

# > 10 errors in 5 minutes. evaluation_periods 1 on a 300s period means the
# first 5-minute window that breaches pages immediately, rather than waiting
# for a second window to confirm -- an error burst is already its own evidence.
resource "aws_cloudwatch_metric_alarm" "application_errors" {
  alarm_name          = "${var.environment}-application-error-burst"
  alarm_description   = "More than ${var.error_alarm_threshold} ERROR-level log events in 5 minutes across the application log groups. Notifies SNS, which pages PagerDuty."
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "ApplicationErrorCount"
  namespace           = local.metric_namespace
  period              = 300
  statistic           = "Sum"
  threshold           = var.error_alarm_threshold
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.logging_alerts.arn]
  ok_actions          = [aws_sns_topic.logging_alerts.arn]
  tags                = { Name = "${var.environment}-application-error-burst" }
}

# ─── Log Insights Saved Queries ───────────────────────────────────────────────
#
# These are real saved queries, so they appear in the console's Saved Queries
# list. They are also reproduced in docs/runbooks/cloudwatch-logs.md, because a
# runbook that only points at the console is useless at 3am.

resource "aws_cloudwatch_query_definition" "saved" {
  for_each = local.saved_queries

  name            = "${var.environment}-${each.key}"
  query_string    = each.value
  log_group_names = local.observed_log_groups
}

# ─── Dashboard ────────────────────────────────────────────────────────────────

# Gives the "metric filter counts errors correctly" criterion something visual to
# check against, and shows ingest lag next to the error rate.
resource "aws_cloudwatch_dashboard" "logging" {
  dashboard_name = "${var.environment}-vesting-logging"

  dashboard_body = jsonencode({
    widgets = [
      {
        type = "metric", x = 0, y = 0, width = 12, height = 6
        properties = {
          title  = "Application errors (5m sum)"
          view   = "timeSeries"
          region = var.aws_region
          stat   = "Sum"
          period = 300
          metrics = [
            [local.metric_namespace, "ApplicationErrorCount"],
          ]
        }
      },
      {
        type = "metric", x = 12, y = 0, width = 12, height = 6
        properties = {
          title  = "Indexer warnings (1h sum)"
          view   = "timeSeries"
          region = var.aws_region
          stat   = "Sum"
          period = 3600
          metrics = [
            [local.metric_namespace, "IndexerWarningCount"],
          ]
        }
      },
      {
        type = "log", x = 0, y = 6, width = 24, height = 8
        properties = {
          title  = "Most common errors"
          view   = "table"
          region = var.aws_region
          query  = local.saved_queries["top-errors"]
        }
      },
    ]
  })
}
