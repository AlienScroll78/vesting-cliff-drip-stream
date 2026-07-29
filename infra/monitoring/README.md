# Uptime Monitoring

Monitoring is managed with [UptimeRobot](https://uptimerobot.com) provisioned via Terraform.

## Monitors

| Name | Type | URL | Check interval |
|------|------|-----|----------------|
| Vesting API — health | HTTP | `https://api.vesting.example.com/health` | 60 s |
| Vesting — WebSocket | Keyword (`pong`) | `https://ws.vesting.example.com/ping` | 60 s |
| Vesting — indexer lag | Keyword absent (`lag_critical`) | `https://api.vesting.example.com/metrics/indexer` | 60 s |

## Alerting

- Alerts fire after **2 consecutive failures**.
- Notifications go to the **#vesting-alerts** Slack channel via an incoming webhook.
- PagerDuty escalation: add a second alert contact of type `pagerduty` in `uptimerobot.tf` and set `PAGERDUTY_SERVICE_KEY` in your Terraform variables.

## Status Page

The public status page URL is available in the UptimeRobot dashboard under **Status Pages**.
Share the URL with stakeholders once the monitors are provisioned.

## Apply

```bash
cd infra/monitoring
terraform init
terraform apply \
  -var="uptimerobot_api_key=$UPTIMEROBOT_API_KEY" \
  -var="slack_webhook_url=$SLACK_WEBHOOK_URL"
```

## Required secrets / env vars

| Variable | Where | Description |
|----------|-------|-------------|
| `UPTIMEROBOT_API_KEY` | GitHub Secret / local env | UptimeRobot main API key |
| `SLACK_WEBHOOK_URL` | GitHub Secret / local env | Slack incoming webhook URL |
