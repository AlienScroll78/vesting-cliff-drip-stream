# Secrets Management — External Secrets Operator

All application secrets are managed by the [External Secrets Operator (ESO)](https://external-secrets.io/)
and sourced from a cloud secrets manager. Secrets are never hardcoded in manifests
or committed to the repository.

## Supported Secret Stores

| Store | ClusterSecretStore name | Use case |
|---|---|---|
| AWS Secrets Manager | `aws-secretsmanager` | Primary store for production |
| HashiCorp Vault | `hashicorp-vault` | Alternative store (configurable) |
| AWS Parameter Store | `aws-parameter-store` | Non-sensitive configuration |

Stores are configured as `ClusterSecretStore` so they are shared across all
namespaces. Select the active store via the `externalSecret.secretStoreRef`
values in the Helm chart.

## Secret Inventory

| Secret name (remote key) | Purpose | Rotation policy | Sensitivity |
|---|---|---|---|
| `vesting/{env}/database-url` | PostgreSQL connection string (`DATABASE_URL`) | 30 days | Critical |
| `vesting/{env}/redis-url` | Redis connection string (`REDIS_URL`) | 30 days | Critical |
| `vesting/{env}/admin-api-key` | Bearer token for `/admin/*` endpoints (`ADMIN_API_KEY`) | 90 days | Critical |
| `vesting/{env}/sponsor-secret-key` | Stellar secret key for signing claim txs (`SPONSOR_SECRET_KEY`) | 180 days | Critical |
| `vesting/{env}/jwt-secret` | JWT signing secret (`JWT_SECRET`) | 90 days | High |
| `vesting/{env}/horizon-api-key` | Horizon REST API key (`HORIZON_API_KEY`) | 90 days | Medium |

Each secret maps to a single JSON object. Individual properties are extracted
via the `property` field in the `ExternalSecret` remoteRef.

## Secret Structure (JSON)

```json
{
  "database_url": "postgres://user:pass@host:5432/vesting",
  "redis_url": "redis://user:pass@host:6379",
  "admin_api_key": "random-bearer-token",
  "sponsor_secret_key": "S...",
  "jwt_secret": "hmac-secret",
  "horizon_api_key": "horizon-api-token"
}
```

Each environment (`staging`, `production`) has its own secret at
`vesting/staging/app-secrets` and `vesting/production/app-secrets`.

## Deploying ClusterSecretStore

```bash
# AWS Secrets Manager
kubectl apply -f infra/secrets/cluster-secret-store-aws.yaml

# HashiCorp Vault
kubectl apply -f infra/secrets/cluster-secret-store-vault.yaml
```

## Switching Between AWS and Vault

In `helm/vesting-backend/values.yaml` (or your environment override file):

```yaml
externalSecret:
  secretStoreRef:
    name: hashicorp-vault   # or aws-secretsmanager
    kind: ClusterSecretStore
```

## Audit Logging

Secret access is audited via AWS CloudTrail. The trail configuration in
`audit-logging.yaml` captures all `GetSecretValue`, `DescribeSecret`, and
`ListSecrets` API calls for secrets under the `vesting/` path.

To enable:

```bash
kubectl apply -f infra/secrets/audit-logging.yaml
```

Audit logs are delivered to the `vesting-secrets-audit-logs` S3 bucket and
can be queried with CloudWatch Logs Insights.

## IAM Policy

The `iam-policy.json` file grants the minimal permissions required by the ESO
service account. Attach it to the ECS task role or the Kubernetes node instance
profile before deploying the ClusterSecretStore.

## Rotation

Rotation is configured per secret in `rotation-policy.json`. Each secret type
has an appropriate rotation interval:

- **Database passwords**: 30 days (frequent — credential leak blast radius is high)
- **API keys, JWT secrets**: 90 days
- **Stellar secret keys**: 180 days (manual rotation — requires on-chain admin ops)

Rotation Lambda functions must implement the
[AWS Secrets Manager rotation contract](https://docs.aws.amazon.com/secretsmanager/latest/userguide/rotating-secrets.html).

## ESO-Managed Env Vars

When ESO is enabled, the following environment variables are injected into pods
from the generated Kubernetes Secret (not from ConfigMap or `.env`):

- `DATABASE_URL`
- `REDIS_URL`
- `ADMIN_API_KEY`
- `SPONSOR_SECRET_KEY`
- `JWT_SECRET`
- `HORIZON_API_KEY`

Non-sensitive config vars (`HORIZON_URL`, `NETWORK_PASSPHRASE`, etc.) remain in
ConfigMap.
