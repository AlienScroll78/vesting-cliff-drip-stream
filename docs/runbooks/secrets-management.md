# Secrets Management

All application secrets live in AWS Secrets Manager. Nothing sensitive is passed
to a container as a plain environment variable, and no secret is stored in GitHub
Secrets apart from the single bootstrap webhook used by CI notifications.

Managed by `terraform/modules/secrets` (wired in `terraform/secrets.tf`).

## Inventory

| Secret | Environment variable | Rotation | Notes |
|---|---|---|---|
| `vesting/{env}/db-credentials` | `DATABASE_URL` | **Automatic**, every 30 days | Contains `username`, `password`, `host`, `port`, `dbname`, `database_url`. Rotated by the `db-rotation` Lambda. |
| `vesting/{env}/jwt-rs256-private-key` | `JWT_PRIVATE_KEY` | **Manual**, staged | RS256 PEM. Old versions are retained, which is the grace period that already-issued tokens are verified against. |
| `vesting/{env}/soroban-rpc-api-key` | `SOROBAN_RPC_API_KEY` | Manual | Placeholder generated at bootstrap until a real key is set. |
| `vesting/{env}/slack-webhook-url` | — | Manual | Read at invoke time by the cost relay Lambda. |
| `vesting/{env}/sentry-dsn` | `SENTRY_DSN` | Manual | Placeholder generated at bootstrap until a real DSN is set. |

Every secret is encrypted with a customer-managed KMS key
(`alias/{env}-vesting-secrets`) that has automatic rotation enabled.

## How tasks receive secrets

The backend task definition uses the ECS `secrets` field with
`valueFrom: <secret-arn>-json-key:<key>`. ECS resolves the value at task start
and injects it as an environment variable *inside* the task, so:

- the value never appears in the task definition, `terraform plan` output or CI logs
- a rotated value takes effect on the next task start
- nothing has to be passed to `docker run` or a Helm values file

The task execution role is scoped by `terraform/modules/compute` to the four
secrets it actually receives, replacing the broad
`AmazonECSTaskExecutionRolePolicy` whose `secretsmanager` statement applies to
every secret in the account.

## Database password rotation

Rotation runs automatically every 30 days
(`var.db_password_rotation_days`). Secrets Manager invokes
`{env}-vesting-db-rotation` through the four-step contract:

| Step | What the Lambda does |
|---|---|
| `createSecret` | Generates a 40-character password and stores it with the `AWSPENDING` label, rebuilding `database_url` so the connection string stays consistent. |
| `setSecret` | Calls `rds:ModifyDBInstance` with `ApplyImmediately`. The password is changed **in place**; the instance is never stopped. |
| `testSecret` | Opens a PostgreSQL connection with the new password, negotiates TLS, authenticates and runs `SELECT 1`. Implemented directly on `net`/`tls` so the function needs no npm packages. |
| `finishSecret` | Moves `AWSPENDING` to `AWSCURRENT` and the old current to `AWSPREVIOUS`. |

**Zero downtime.** The instance stays available throughout, so there is no
connection interruption. Running tasks keep their existing connections; new tasks
pick up the new value. Because the pool is only re-established on task start, a
task that has been running for a long time will keep the old password until it
is replaced — that is the intended grace window, not a fault. Roll the service to
cut over immediately:

```bash
aws ecs update-service --cluster {env}-vesting --service vesting-backend --force-new-deployment
```

### Testing a rotation

```bash
aws secretsmanager rotate-secret --secret-id vesting/staging/db-credentials
```

Watch it in the Lambda log group `/aws/lambda/{env}-vesting-db-rotation`. A
successful run logs `promoted pending version to current`.

## Manual JWT key rotation (with grace period)

The key is not auto-rotated because a swap invalidates in-flight sessions. Stage
and promote instead:

```bash
# 1. Stage the new key under the AWSPENDING label.
aws secretsmanager put-secret-value \
  --secret-id vesting/{env}/jwt-rs256-private-key \
  --client-request-token AWSPENDING \
  --secret-string fileb://new-jwt-key.pem

# 2. Verify the staged version is the one you expect.
aws secretsmanager get-secret-value \
  --secret-id vesting/{env}/jwt-rs256-private-key \
  --version-stage AWSPENDING | jq -r '.VersionId'

# 3. Promote it. The previous current version becomes AWSPREVIOUS and is kept,
#    so tokens signed with the old key still verify during the grace period.
aws secretsmanager update-secret \
  --secret-id vesting/{env}/jwt-rs256-private-key \
  --client-request-token <version-id-from-step-2>

# 4. Roll tasks so they load the new key.
aws ecs update-service --cluster {env}-vesting --service vesting-backend --force-new-deployment
```

Once the old key's tokens have expired, remove the `AWSPREVIOUS` label:

```bash
aws secretsmanager update-secret \
  --secret-id vesting/{env}/jwt-rs256-private-key \
  --version-stages Stage=AWSPREVIOUS
```

## Replacing a bootstrap placeholder

`slack_webhook_url`, `soroban_rpc_api_key` and `sentry_dsn` may hold a generated
placeholder. Replace one and Terraform will not overwrite it on the next apply,
because the resource is only written when the secret is created:

```bash
aws secretsmanager put-secret-value \
  --secret-id vesting/{env}/sentry-dsn \
  --secret-string https://examplePublicKey@o0.ingest.sentry.io/0

# Then set the same value in the tfvars so a recreate is reproducible:
#   sentry_dsn = "https://examplePublicKey@o0.ingest.sentry.io/0"
```

## Auditing secret access

`{env}-vesting-secrets-audit` is a CloudTrail scoped to
`AWS::SecretsManager::Secret` resources under `vesting/{env}/*`, with management
events excluded so the log stays readable. It delivers to the CloudWatch log
group `/aws/cloudtrail/{env}-vesting-secrets-audit`, retained for 365 days.

Query who read the database credentials:

```
fields @timestamp, eventName, userIdentity.arn, requestParameters.secretId
| filter eventName = "GetSecretValue"
| sort @timestamp desc
| limit 50
```

An unexpected reader identity or a read outside a deploy window is an incident.
Rotation failure is the expected exception and is logged by the rotation Lambda.

## Rotation failure response

The alarm `{env}-vesting-secret-rotation-failed` fires on any error from the
rotation Lambda, and Secrets Manager's `RotateSecret` API errors reach the same
SNS topic `{env}-vesting-secret-rotation-failure`.

1. Read the failure reason from the Lambda log group:

   ```bash
   aws logs tail /aws/lambda/{env}-vesting-db-rotation --since 2h
   ```

2. Confirm the staged version and the instance state:

   ```bash
   aws secretsmanager get-secret-value --secret-id vesting/{env}/db-credentials \
     --version-stage AWSPENDING --query VersionId
   aws rds describe-db-instances --db-instance-identifier {env}-vesting-db \
     --query 'DBInstances[0].{Status:DBInstanceStatus,Class:DBInstanceClass}'
   ```

3. The `AWSPENDING` version is deliberately left in place for inspection — do not
   delete it before capturing the state above.

4. Fix the cause, then re-run the rotation. It resumes from the staged version
   rather than generating another one:

   ```bash
   aws secretsmanager rotate-secret --secret-id vesting/{env}/db-credentials
   ```

5. If the instance is stuck in `modifying`, wait for `available` before
   re-running. Repeated `ModifyDBInstance` calls while a modification is in
   flight will themselves fail.

## Manual rollback

To return to the previous password, move `AWSPREVIOUS` back to `AWSCURRENT` and
let the next rotation cycle re-apply it:

```bash
aws secretsmanager update-secret \
  --secret-id vesting/{env}/db-credentials \
  --version-stages Stage=AWSPENDING
```
