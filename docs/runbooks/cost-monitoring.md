# Cloud Cost Monitoring Runbook

Terraform applies these required allocation tags to supported AWS resources:
`Application`, `Environment`, `ManagedBy`, and `Repository`. Supply
`additional_tags` with at least `CostCenter` and `Owner` for each environment;
activate those tags in AWS Billing Cost Allocation Tags before relying on them
in Cost Explorer.

## Alert Infrastructure

The `terraform/cost-monitoring.tf` configuration provides:

| Resource | Purpose |
|----------|---------|
| `aws_budgets_budget.monthly` | 80% forecast and 100% actual monthly budget alert |
| `aws_ce_anomaly_monitor.services` | All-service Cost Explorer anomaly monitor |
| `aws_ce_anomaly_monitor.ecs` | ECS/Fargate-specific anomaly monitor |
| `aws_ce_anomaly_monitor.rds` | RDS/ElastiCache-specific anomaly monitor |
| `aws_ce_anomaly_subscription.daily` | Daily anomaly digest — all 3 monitors, >20% threshold |
| `aws_sns_topic.cost_alerts` | SNS topic routing alerts to email + Slack |
| `aws_lambda_function.slack_relay` | SNS → Lambda → Slack #ops webhook relay |
| `aws_cloudwatch_dashboard.cost` | Dashboard with estimated charges + monitor summary |

### Alert Flow

```
Cost Anomaly Detected (20%+ vs baseline)
  → aws_ce_anomaly_subscription.daily (frequency: DAILY)
    → Email subscriber(s) in cost_alert_emails
    → aws_sns_topic.cost_alerts
      → aws_lambda_function.slack_relay
        → Slack #ops channel (via incoming webhook)
```

### Variables

Set these in the environment's secure Terraform variable source:

| Variable | Type | Description |
|----------|------|-------------|
| `cost_alert_emails` | `set(string)` | Email recipients for budget + anomaly alerts |
| `monthly_budget_limit_usd` | `number` | Monthly budget (default: 250 USD) |
| `slack_webhook_url` | `string` (sensitive) | Slack incoming webhook URL for #ops channel |

Confirm recipients accept the SNS-style subscription/notification email where
AWS requires it.

## Anomaly Monitor Details

### ECS Monitor

Monitors costs tagged to:
- `AmazonECS`
- `AmazonEC2ContainerService`
- `AWS Fargate`

**Triggers when:** A daily cost anomaly exceeds 20% of the historical baseline
for ECS/Fargate services.

### RDS Monitor

Monitors costs tagged to:
- `AmazonRDS`
- `Amazon ElastiCache`

**Triggers when:** A daily cost anomaly exceeds 20% of the historical baseline
for RDS/ElastiCache services.

### All-Services Monitor

Covers all AWS services. Triggers the same 20% threshold. This is the legacy
monitor that was previously the only anomaly detector.

## Daily Cost Report (CloudWatch Logs)

The Slack relay Lambda logs a structured JSON record to CloudWatch Logs after
each alert it processes:

```json
{
  "reportType": "cost_anomaly",
  "timestamp": "2026-08-29T12:00:00Z",
  "alertsProcessed": 1,
  "results": [{ "status": "ok" }]
}
```

**Log group:** `/aws/lambda/<environment>-cost-slack-relay`
**Retention:** 90 days

Query recent alerts with CloudWatch Logs Insights:

```sql
fields @timestamp, alertsProcessed, results
| filter reportType = "cost_anomaly"
| sort @timestamp desc
| limit 50
```

## Slack Integration Setup

1. Create an [Incoming Webhook](https://api.slack.com/messaging/webhooks) in your Slack workspace.
2. Set the webhook URL as `slack_webhook_url` in your Terraform variables (marked `sensitive`).
3. The Lambda automatically posts to `#ops` (configurable via `SLACK_CHANNEL` env var).
4. **Test the integration:** Trigger a manual budget override (see below) and confirm the message appears in #ops.

## Alert Response

1. **Check Slack #ops** for the alert message — it includes the monitor name, anomaly impact, and a direct link to Cost Explorer.
2. Open Cost Explorer and group the affected period by **Service**, then by
   `CostCenter` and `Owner` allocation tags.
3. Compare the spike against deploys, RDS storage/backups, NAT data transfer,
   ECS task count, and CloudWatch log ingestion.
4. Stop or scale down non-production resources only after confirming impact.
5. Record the anomaly, owner, and remediation in the incident channel. Raise
   the budget only after the expected recurring cost is approved.

## Testing Alerts

### Manual Budget Override

1. Go to AWS Budgets → select the vesting monthly budget.
2. Temporarily lower the budget limit to $1 (or below current spend).
3. Wait for the next alert cycle (or trigger a manual evaluation).
4. Confirm:
   - Email received by all `cost_alert_emails` recipients.
   - Slack #ops message received via the Lambda relay.
   - CloudWatch Logs entry created in the Lambda log group.
5. Restore the budget limit to the correct value.

### Anomaly Simulation

AWS does not provide a direct anomaly simulation API. To verify anomaly detection:

1. Ensure a baseline is established (Cost Explorer needs ~14 days of history).
2. Provision a temporary high-cost resource (e.g., a large EC2 instance) for 1 day.
3. Remove it and wait for the daily anomaly subscription to fire.
4. Confirm email + Slack delivery.

## Maintenance

- Review budget, anomaly threshold, and active allocation tags **monthly**.
- Rotate the Slack webhook URL if the token is compromised.
- Monitor the Lambda's CloudWatch Logs for delivery failures (`status: "error"`).
- Review `cost_alert_emails` when team members join or leave.
