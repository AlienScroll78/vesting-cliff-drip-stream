# Cloud Cost Monitoring Runbook

Terraform applies these allocation tags to every resource in the stack via
`default_tags` in `terraform/main.tf`: `Project`, `Application`, `Environment`,
`ManagedBy`, and `Repository`. Supply `additional_tags` with at least
`CostCenter` and `Owner` for each environment.

`Project` is the tag that matters for cost: it is set to `vesting-drips` and
activated as a Cost Explorer cost allocation tag by
`aws_ce_cost_allocation_tag.project`, which is what makes the whole bill
selectable as a group.

## Alert Infrastructure

The `terraform/cost-monitoring.tf` configuration provides:

| Resource | Purpose |
|----------|---------|
| `aws_budgets_budget.monthly` | $500/month budget with 80% forecasted, 80% actual and 100% actual alerts |
| `aws_ce_cost_allocation_tag.project` | Activates the `Project = vesting-drips` cost allocation tag group |
| `aws_ce_anomaly_monitor.services` | All-service Cost Explorer anomaly monitor |
| `aws_ce_anomaly_monitor.ecs` | ECS/Fargate-specific anomaly monitor |
| `aws_ce_anomaly_monitor.rds` | RDS/ElastiCache-specific anomaly monitor |
| `aws_ce_anomaly_subscription.daily` | Daily anomaly digest — all 3 monitors, >20% threshold |
| `aws_sns_topic.cost_alerts` | SNS topic routing alerts to email + Slack |
| `aws_sns_topic_policy.cost_alerts` | Lets `budgets.amazonaws.com` and `costalerts.amazonaws.com` publish |
| `aws_lambda_function.slack_relay` | SNS → Lambda → Slack #ops webhook relay |
| `aws_lambda_function.monthly_cost_report` | Monthly cost report, scheduled |
| `aws_scheduler_schedule.monthly_cost_report` | Triggers the report on the 2nd at 07:00 UTC |
| `aws_cloudwatch_dashboard.cost` | Dashboard with estimated charges + monitor summary |

### Budget Thresholds

| Threshold | Type | Why |
|---|---|---|
| 80% | `FORECASTED` | Lead time to act before the limit is crossed |
| 80% | `ACTUAL` | Confirms the forecast held; also the threshold the test below exercises |
| 100% | `ACTUAL` | The hard stop |

All three notify both `cost_alert_emails` and the `cost_alerts` SNS topic, so a
breach reaches Slack #ops as well as email.

### Alert Flow

```
Budget threshold crossed ─┐
Cost Anomaly Detected ────┼→ aws_sns_topic.cost_alerts
Monthly report (2nd 07:00)┘    ├→ Email subscriber(s) in cost_alert_emails
                               └→ aws_lambda_function.slack_relay
                                    └→ Slack #ops channel (via incoming webhook)
```

### Variables

Set these in the environment's secure Terraform variable source:

| Variable | Type | Description |
|----------|------|-------------|
| `cost_alert_emails` | `set(string)` | Email recipients for budget + anomaly alerts |
| `monthly_budget_limit_usd` | `number` | Monthly budget (default and tfvars: 500 USD) |
| `project_name` | `string` | Cost allocation tag value (default: `vesting-drips`) |
| `db_instance_class` | `string` | `db.t3.micro` in staging, `db.t3.small` in production |
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

## Monthly Cost Report

`aws_scheduler_schedule.monthly_cost_report` fires `cron(0 7 2 * ? *)`. The 2nd
rather than the 1st because Cost Explorer lags roughly 24 hours, so the 1st
would report a partial month.

`aws_lambda_function.monthly_cost_report` queries Cost Explorer for the previous
calendar month, grouped by service and by the `Project` tag, compares the total
against the budget, and publishes to the `cost_alerts` topic — so it reaches
email and Slack #ops through the same path as every other cost alert.

The report contains:

- Total unblended spend for the month
- Budget utilisation as a percentage, with an `OK` / `WARNING` / `OVER` state
  at the 80% and 100% thresholds
- The ten largest services by cost, with each one's share of the total

**Log group:** `/aws/lambda/<environment>-monthly-cost-report` (365-day retention)

### Running it on demand

```bash
aws lambda invoke \
  --function-name {env}-monthly-cost-report \
  --cli-binary-format raw-in-base64-out \
  --payload '{}' \
  response.json && cat response.json
```

Or through the scheduler, to exercise the same path the cron uses:

```bash
aws scheduler send-target-execution \
  --group-name default \
  --name {env}-vesting-monthly-cost-report
```

Retrieve a past report from CloudWatch Logs Insights:

```sql
fields @timestamp, period, total, budget.percent, budget.limit
| filter reportType = "monthly_cost"
| sort @timestamp desc
| limit 12
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

### Budget Alert (artificial overage)

This is the test the acceptance criteria refer to. It exercises the real
notification path — no synthetic messages.

1. Record the current limit: `terraform output -raw monthly_budget_limit_usd`
   or read it from `envs/<env>.tfvars`.
2. Go to AWS Budgets → `{env}-vesting-monthly-cost` → Edit budget.
3. Set the limit **below current month-to-date spend** (e.g. `$1`). This makes
   the 80% and 100% actual thresholds true immediately.
4. Confirm all three notifications arrive:
   - Email at every address in `cost_alert_emails`.
   - A Slack #ops message, delivered through
     `cost_alerts` → `slack_relay` → webhook.
   - The alert body names the budget and the breached threshold.
5. Confirm delivery depends on the topic policy: without
   `aws_sns_topic_policy.cost_alerts`, `budgets.amazonaws.com` cannot publish
   and the notification is silently dropped. This is the most common cause of
   "the budget alert did not arrive".
6. Restore the original limit and confirm the `OK` notification arrives, because
   `ok_actions` is also wired to the topic.

### Anomaly Simulation

AWS does not provide a direct anomaly simulation API. To verify anomaly detection:

1. Ensure a baseline is established (Cost Explorer needs ~14 days of history).
2. Provision a temporary high-cost resource (e.g., a large EC2 instance) for 1 day.
3. Remove it and wait for the daily anomaly subscription to fire.
4. Confirm email + Slack delivery.

### Monthly Report

Invoke the Lambda directly (see above) and confirm the message appears in #ops
with a service breakdown and a budget percentage. Check the log group for the
`reportType: "monthly_cost"` record.

## Cost Optimization

These are the levers already wired into the Terraform, and what each is worth.

### RDS instance class

`var.db_instance_class` is set per environment rather than hardcoded:

| Environment | Class | Rationale |
|---|---|---|
| staging (testnet) | `db.t3.micro` | Smallest class that holds the `stream_events` working set |
| production | `db.t3.small` | Extra CPU and memory; single-AZ, sized to the budget rather than to headroom |

The instance is not Multi-AZ, which is a deliberate trade: Multi-AZ would
roughly double the compute charge. `deletion_protection` is on, so a mistake
cannot destroy the instance.

### Fargate Spot for the indexer

`aws_capacity_provider.fargate_spot` adds a `FARGATE_SPOT` capacity provider to
the cluster, and `aws_ecs_service.indexer` runs on it with on-demand Fargate as
a `base = 1` fallback.

The indexer is the only component on Spot because it is the only one that can
absorb an interruption: it replays Horizon events and rebuilds its cursor
position from `stream_events`, so a reclaimed task costs a re-scan rather than
correctness. The backend API stays on on-demand.

Spot capacity can be reclaimed with two minutes' notice. If the indexer falls
behind, the fallback keeps a task running on demand.

### VPC endpoints

`aws_vpc_endpoint.s3` is a **gateway** endpoint and is free. It removes the
highest-volume NAT traffic (log archival, state objects, snapshots) from the two
NAT gateways, which are the largest single line item in the cost model. It is
always created.

`aws_vpc_endpoint.interface` is **opt-in and empty by default**. An interface
endpoint is billed ~$7.20/month per AZ, so five of them across two AZs would
cost ~$72/month — more than the $64 of NAT gateways they would replace. At
current traffic volume, enabling them would increase the bill.

To enable one, set `interface_endpoint_services` in `envs/<env>.tfvars`:

```hcl
interface_endpoint_services = ["secretsmanager"]
```

`secretsmanager` is the usual first candidate, because every ECS task start
reads secrets through the NAT gateway otherwise. Before adding any endpoint,
check the NAT gateway's processed-GB figure in Cost Explorer — if the data
processing charge is well below the endpoint's hourly charge, the endpoint
costs more than it saves.

## Infracost in CI

`.github/workflows/terraform.yml` runs an Infracost breakdown on any pull
request that touches `terraform/**` and posts the cost delta as a PR comment.

It requires the `INFRACOST_API_KEY` repository secret. Without it the job skips
cleanly and records why in the job summary, so it never blocks a PR.

`.github/infracost.yml` excludes resources whose cost Infracost estimates
poorly — IAM, subscriptions, the anomaly monitors and the audit trail — so the
comment only shows the resources a reviewer can actually change.

If a comment is missing, check that `INFRACOST_API_KEY` is set, and that the
PR actually changed something under `terraform/`.

## Maintenance

- Review budget, anomaly threshold, and active allocation tags **monthly**.
- Read the automated monthly report on the 2nd; escalate anything trending toward
  80% before the forecast alert fires.
- Rotate the Slack webhook URL if the token is compromised.
- Monitor the Lambda's CloudWatch Logs for delivery failures (`status: "error"`).
- Review `cost_alert_emails` when team members join or leave.
- Re-check the NAT gateway processed-GB figure in Cost Explorer before adding
  further interface endpoints.
