# Runbook: Log Aggregation Pipeline

Covers where application and database logs live, how they get there, what pages,
and the Log Insights queries for common debug scenarios.

## Pipeline

```
ECS task (Fargate)
┌──────────────────────────────────────────────────────────┐
│ vesting-backend                                          │
│   writes one JSON object per line                        │
│     → /var/log/vesting/app.log   (shared ephemeral vol)  │
│   stdout ─────────────────────────────────────┐          │
└───────────────────────────────────────────────┼──────────┘
                                                │ fallback
                                                │ awslogs driver
┌───────────────────────────────────────────────┼──────────┐
│ log-shipper (Fluent Bit)                      ▼          │
│   tail, refresh_interval=1s  ──flush 5s──>  /ecs/api-server
└──────────────────────────────────────────────────────────┘
                        │
                        ├── metric filter { $.level = "error" }
                        │      → VestingApp/ApplicationErrorCount
                        │      → alarm > 10 per 5 min
                        │      → SNS → PagerDuty (page) + email
                        │
                        ├── metric filter { $.level = "warn" && $.service = "indexer" }
                        │      → VestingApp/IndexerWarningCount
                        │
                        └── Log Insights saved queries
```

Both the shipper and the app container write to `/ecs/api-server`. That is
intentional redundancy, not a double-write bug — see [Failure modes](#failure-modes).

## Log groups

| Group | Source | Retention |
|---|---|---|
| `/ecs/api-server` | API server, via Fluent Bit + `awslogs` fallback | 90 days |
| `/ecs/indexer` | Horizon indexer, via Fluent Bit | 90 days |
| `/aws/rds/instance/<id>/postgresql` | RDS `enabled_cloudwatch_logs_exports` | 365 days |
| `/ecs/fluent-bit-internal` | Shipper's own diagnostics | 90 days |
| `/aws/lambda/<env>-cost-slack-relay` | Cost alert relay | 90 days |

**On the database group name.** Issue #840 asked for `/rds/postgresql`, but RDS
does not let you choose where `enabled_cloudwatch_logs_exports` writes — it is
always `/aws/rds/instance/<instance-id>/postgresql`. Terraform therefore manages
the group at its real path. This is still an improvement over leaving it
unmanaged: an RDS log group defaults to **Never expire**, so the audit logs would
otherwise grow without bound and eventually cost more than the rest of the
pipeline combined.

## Latency

The acceptance target is 30 seconds from app write to CloudWatch. The actual
budget is much tighter:

| Stage | Delay |
|---|---|
| Fluent Bit `tail` poll | ≤ 1s |
| Output flush interval | ≤ 5s |
| CloudWatch ingestion | ~1–2s |
| **Worst case** | **~8s** |

Verify it rather than trusting the table — the `ingest-lag` saved query measures
the real end-to-end delay by comparing the app's `ts` field against CloudWatch's
`@timestamp`.

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

## Metric filters

| Filter | Log groups | Pattern | Metric |
|---|---|---|---|
| `${env}-application-errors` | `/ecs/api-server`, `/ecs/indexer` | `{ $.level = "error" }` | `VestingApp/ApplicationErrorCount` |
| `${env}-indexer-warnings` | `/ecs/indexer` | `{ $.level = "warn" && $.service = "indexer" }` | `VestingApp/IndexerWarningCount` |

Both publish with **no dimensions**. That is deliberate: a metric filter normally
emits with `LogGroupName` and `LogStreamName` dimensions, and an alarm that does
not match those dimensions silently never fires. Dropping them gives one
aggregated metric, so a single alarm covers the whole pipeline.

The patterns are JSON, not text. A text pattern for `error` would also match an
error object logged at `warn` — the `$.level` field is what makes the count mean
"an error was logged", not "the word error appeared somewhere".

The level literals are **lowercase** because that is what `src/server/logger.js`
writes, and CloudWatch compares JSON pattern strings case-sensitively. An
uppercase pattern matches nothing, which leaves `ApplicationErrorCount` pinned
at zero and the alarm permanently OK — no error, no alarm, no clue. If the
metric is flat at zero while errors are visibly being logged, check the case of
these literals before anything else.

RDS is excluded because it emits PostgreSQL's own text format, which a JSON
pattern never matches. Use the `rds-errors` query for database errors.

## Alarm and paging

`${env}-application-error-burst` — `ApplicationErrorCount > 10` over a 300s
period, `evaluation_periods = 1`, `treat_missing_data = notBreaching`.

`evaluation_periods = 1` pages on the first breaching window rather than waiting
for a second to confirm. An error burst is already its own evidence; waiting two
windows just doubles the time to investigate.

Alarm and OK both publish to `${env}-vesting-logging-alerts`:

- **PagerDuty** — an HTTPS subscription to the PagerDuty integration URL, set only
  when `pagerduty_integration_key` is non-empty.
- **Email** — one subscription per address in `log_alert_emails`, empty by default
  so a resolved page does not also land in a mailbox.

`ok_actions` is wired as well, so a page is auto-resolved when the burst stops.

> The PagerDuty integration key is embedded in the subscription endpoint and
> therefore stored in Terraform state. Treat the state bucket as a secret store
> and rotate the key if it is ever exposed.

## Log Insights saved queries

These are created by Terraform and appear in the console under **Saved Queries**
as `${env}-<name>`. Each is reproduced here so the runbook works without the
console.

### recent-events
```sql
fields @timestamp, level, service, env, msg
| sort @timestamp desc
| limit 50
```

### error-rate-by-minute
```sql
fields @timestamp
| filter level = "error"
| stats count() as errors by bin(1m)
| sort @timestamp desc
| limit 60
```

### top-errors
```sql
fields @timestamp, service, msg
| filter level = "error"
| stats count() as occurrences by service, msg
| sort occurrences desc
| limit 25
```

### errors-by-service
```sql
fields @timestamp, service
| filter level = "error"
| stats count() as errors by service, bin(1h)
| sort errors desc
```

### indexer-warnings
```sql
fields @timestamp, service, msg
| filter level = "warn" and service = "indexer"
| sort @timestamp desc
| limit 50
```

### ingest-lag
Confirms the 30-second visibility target. `ts` is written by the app at emit
time, `@timestamp` is CloudWatch's ingest time.
```sql
fields @timestamp, ts
| filter ispresent(ts)
| stats min(dateDiff('second', ts, @timestamp)) as min_lag_s,
        avg(dateDiff('second', ts, @timestamp)) as avg_lag_s,
        max(dateDiff('second', ts, @timestamp)) as max_lag_s
  by bin(5m)
| sort @timestamp desc
| limit 12
```

### trace-by-request-id
The correlation query. Replace the placeholder with the id from a user report.
```sql
fields @timestamp, level, service, msg
| filter requestId = "REPLACE_WITH_REQUEST_ID"
| sort @timestamp asc
| limit 200
```

### rds-errors
```sql
fields @timestamp, @message
| filter @message like /ERROR/ or @message like /FATAL/ or @message like /PANIC/
| sort @timestamp desc
| limit 50
```

## Testing

### Verify the metric filter counts errors

1. Note the current value:

   ```bash
   aws cloudwatch get-metric-statistics \
     --namespace VestingApp --metric-name ApplicationErrorCount \
     --start-time "$(date -u -d '2 hours ago' +%FT%TZ)" --end-time "$(date -u +%FT%TZ)" \
     --period 300 --statistics Sum
   ```

2. Emit 3 errors. Any 500 response from the API works, or invoke the ECS task:

   ```bash
   aws ecs execute-command \
     --cluster staging-vesting --task <task-id> \
     --container vesting-backend --interactive --command "/bin/sh"
   # then, inside the task:
   #   node -e "for(let i=0;i<3;i++)process.stdout.write(JSON.stringify({ts:new Date().toISOString(),level:'error',service:'api-server',env:'staging',msg:'metric filter self-test'})+'\n')" \
     >> /var/log/vesting/app.log
   ```

3. Wait ~30s, then re-run the query from step 1. The count should have risen by 3.
4. Cross-check the lines themselves with the `recent-events` query, searching for
   `metric filter self-test`.

### Verify the alarm fires on a test burst

1. Confirm the alarm starts `OK` and note its current state:

   ```bash
   aws cloudwatch describe-alarms \
     --alarm-names staging-application-error-burst \
     --query 'MetricAlarms[0].{state:StateValue,actions:AlarmActions}'
   ```

2. Burst 15 errors inside one 5-minute window (above the threshold of 10):

   ```bash
   aws ecs exec staging-vesting <task-id> vesting-backend -- \
     node -e "for(let i=0;i<15;i++)process.stdout.write(JSON.stringify({ts:new Date().toISOString(),level:'error',service:'api-server',env:'staging',msg:'alarm self-test '+i})+'\n')" \
     >> /var/log/vesting/app.log
   ```

   Or send 15 real failing requests if you would rather not exec:

   ```bash
   for i in $(seq 1 15); do curl -s -o /dev/null -w '%{http_code}\n' http://staging-vesting-alb/healthz; done
   ```

3. The alarm evaluates on 5-minute boundaries, so wait up to 5 minutes for
   `StateValue` to become `ALARM`, and confirm the PagerDuty incident was created.
4. Stop generating errors and wait for the next window: the alarm should return
   to `OK` and the `ok_actions` notification should auto-resolve the PagerDuty
   incident. Verify with the same `describe-alarms` call.

`pagerduty_enabled` is `false` in the Terraform output if the integration key was
not set — the alarm will change state but nothing will page, which looks exactly
like a broken pipeline.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| No logs at all in `/ecs/api-server` | Both paths failing — usually the task never started | Check the ECS service events and `/ecs/fluent-bit-internal` |
| Logs appear but without `level`/`service` | `LOG_FILE` unset, so the app logged to stdout only | Set `LOG_FILE` and `SERVICE_NAME` on the task definition |
| Logs missing after a task stops | Ephemeral volume: unbuffered lines die with the task | Raise `flush`/`storage.type=filesystem`, or accept the loss window |
| Alarm never fires despite errors | Filter matched no lines, or a dimension mismatch | Run `error-rate-by-minute`; confirm the filters exist on the group |
| Alarm fires but nobody is paged | `pagerduty_integration_key` unset | Set it and re-apply; check `pagerduty_enabled` output |
| `ApplicationErrorCount` flat at zero | Metric filter was created on a group that does not exist yet | Filters attach to a group at creation; confirm the group name matches exactly |

**The ephemeral-volume caveat.** Application logs are written to a 21 GiB Fargate
ephemeral volume, so anything Fluent Bit has not yet flushed is lost when a task
stops. The `awslogs` driver on the app container is the backstop for that. This
trade is deliberate: EFS would make the logs durable across task replacement but
adds an always-on cost and a network hop on every log line, which the $500
monthly budget does not justify for debug-level application logs.

## Application logger

`src/server/logger.js` emits one JSON object per line. Fields: `ts`, `level`,
`service`, `env`, `msg`, plus anything passed at the call site.

```js
import { logger } from './logger.js';

logger.info('claim created', { claimId, userId });
logger.child({ stream: 'horizon' }).warn('cursor behind', { lagMs });
logger.error('horizon poll failed', { err });   // serialised to name/message/stack/code
```

Environment:

| Variable | Effect |
|---|---|
| `LOG_FILE` | Append to this file (Fluent Bit tails it). Unset means stdout. |
| `SERVICE_NAME` | `service` field. The indexer filter matches on `indexer`. |
| `LOG_LEVEL` | `debug` / `info` (default) / `warn` / `error` |
| `ENVIRONMENT` | `env` field |

Writes are synchronous. A single short line appended to a file opened `O_APPEND`
is atomic, and a synchronous write cannot be lost when the process is killed
mid-request — which is exactly when the log matters most. A logger that throws is
caught and downgraded to stderr rather than being allowed to fail the request.

The one-object-per-line shape is a contract, not a convenience: the metric filters
match `$.level` and `$.service`, so a multi-line stack trace written raw would
silently stop being counted.

**Correlation IDs are not automatic yet.** `docs/opentelemetry.md` describes an
`AsyncLocalStorage` design that injects `request_id`/`trace_id` on every request;
that is not implemented. Until it is, bind the id at the call site so the
`trace-by-request-id` query has something to match:

```js
const scoped = logger.child({ requestId: req.headers['x-request-id'] });
scoped.info('claim created', { claimId });
```

Note the field is `requestId`, not the `request_id` in the opentelemetry design
doc.

## Export to S3

```bash
aws logs create-export-task \
  --log-group-name /ecs/api-server \
  --from "$(date -u -d '30 days ago' +%s)000" --to "$(date -u +%s)000" \
  --destination vesting-log-archive --destination-prefix api-server
```
