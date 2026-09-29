# Runbook: CloudWatch Log Aggregation

## Log Groups

| Group | Retention |
|---|---|
| `/ecs/vesting-backend` | 30 days |
| `/ecs/vesting-worker` | 30 days |
| `/ecs/vesting-migrate` | 30 days |

## Kubernetes Fluent Bit Sidecars

The Helm staging values send JSON logs to `/vesting/staging/backend-api` and
`/vesting/staging/event-worker`. The CloudWatch Logs output creates the log
groups when absent. The workload's AWS identity must allow
`logs:CreateLogGroup`, `logs:CreateLogStream`, and `logs:PutLogEvents` for
`arn:aws:logs:<region>:<account-id>:log-group:/vesting/staging/*`.

Deploy or update staging with the existing staging override:

```bash
helm upgrade --install vesting-backend ./helm/vesting-backend \
  --namespace vesting-staging --create-namespace \
  -f helm/vesting-backend/values-staging.yaml
```

Confirm the sidecar is ready and the streams are receiving events:

```bash
kubectl get pods -n vesting-staging
aws logs describe-log-streams --log-group-name /vesting/staging/backend-api
aws logs describe-log-streams --log-group-name /vesting/staging/event-worker
```

## Running Log Insights Queries

1. Open [CloudWatch Log Insights](https://console.aws.amazon.com/cloudwatch/home#logsV2:logs-insights)
2. Select one or more log groups (e.g. `/ecs/vesting-backend`)
3. Paste the query and click **Run query**

### ErrorRate
```
fields @timestamp, @message
| filter @message like /ERROR/
| stats count() as errors by bin(5m)
```

### SlowRequests (>1s)
```
fields @timestamp, @message
| filter @message like /duration/
| parse @message /duration=(?<dur>[0-9.]+)/
| filter dur > 1000
| sort dur desc | limit 20
```

### ClaimEvents
```
fields @timestamp, @message
| filter @message like /claim_vested/
| stats count() by bin(1h)
```

## Set Up an Error Rate Alarm

```bash
aws cloudwatch put-metric-alarm \
  --alarm-name vesting-error-rate \
  --metric-name errors \
  --namespace VestingApp \
  --statistic Sum \
  --period 300 \
  --threshold 10 \
  --comparison-operator GreaterThanThreshold \
  --evaluation-periods 1 \
  --alarm-actions arn:aws:sns:us-east-1:ACCOUNT_ID:alerts
```

## Export Logs to S3

```bash
aws logs create-export-task \
  --log-group-name /ecs/vesting-backend \
  --from $(date -d '30 days ago' +%s000) \
  --to $(date +%s000) \
  --destination vesting-log-archive \
  --destination-prefix vesting-backend
```
