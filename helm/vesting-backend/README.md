# vesting-backend Helm Chart

Helm chart for the **Vesting Cliff Drip Stream** backend service.  
Deploys the nginx container that serves the compiled Soroban WASM artefact
and exposes it over HTTP, with optional HPA, Ingress, ConfigMap, and
[External Secrets Operator](https://external-secrets.io) support.

## Requirements

| Dependency | Version | Notes |
|---|---|---|
| Kubernetes | ≥ 1.25 | Uses `autoscaling/v2`, `policy/v1`, `networking.k8s.io/v1` |
| Helm | ≥ 3.10 | |
| External Secrets Operator | ≥ 0.9 | Only required when `externalSecret.enabled=true` |

## Quick Start

```bash
# Add the Helm repo (once published via GitHub Pages)
helm repo add vesting https://your-org.github.io/vesting-cliff-drip-stream
helm repo update

# Install with defaults
helm install vesting-backend vesting/vesting-backend \
  --namespace vesting \
  --create-namespace

# Install with a custom values override
helm install vesting-backend vesting/vesting-backend \
  --namespace vesting \
  --create-namespace \
  -f my-values.yaml
```

## Installing on a kind Cluster

```bash
# 1. Create a local kind cluster
kind create cluster --name vesting

# 2. Install External Secrets Operator (required for secret sync)
helm repo add external-secrets https://charts.external-secrets.io
helm install external-secrets external-secrets/external-secrets \
  --namespace external-secrets --create-namespace

# 3. Create a ClusterSecretStore pointing at your secret backend
#    (see https://external-secrets.io/latest/provider/aws-secrets-manager/)

# 4. Install the chart
helm install vesting-backend vesting/vesting-backend \
  --namespace vesting --create-namespace \
  --set image.repository=ghcr.io/your-org/vesting-cliff-drip-stream \
  --set image.tag=latest

# 5. Verify
helm test vesting-backend -n vesting
kubectl get pods -n vesting
```

## Upgrading

```bash
helm upgrade vesting-backend vesting/vesting-backend \
  --namespace vesting \
  -f my-values.yaml
```

## Uninstalling

```bash
helm uninstall vesting-backend --namespace vesting
```

---

## Values Reference

### Image

| Key | Type | Default | Description |
|---|---|---|---|
| `image.repository` | string | `ghcr.io/your-org/vesting-cliff-drip-stream` | Container image repository |
| `image.tag` | string | `""` | Image tag; defaults to chart `appVersion` when empty |
| `image.pullPolicy` | string | `IfNotPresent` | Image pull policy |
| `imagePullSecrets` | list | `[]` | List of image pull secret names for private registries |

### Deployment

| Key | Type | Default | Description |
|---|---|---|---|
| `replicaCount` | int | `2` | Number of pod replicas (ignored when `autoscaling.enabled=true`) |
| `nameOverride` | string | `""` | Override the chart name |
| `fullnameOverride` | string | `""` | Override the fully-qualified app name |
| `podAnnotations` | object | `{}` | Extra annotations added to the pod template |
| `podLabels` | object | `{}` | Extra labels added to all resources |
| `extraEnv` | list | `[]` | Additional environment variables injected into the container |

### Security Context

| Key | Type | Default | Description |
|---|---|---|---|
| `podSecurityContext.runAsNonRoot` | bool | `true` | Require non-root user |
| `podSecurityContext.runAsUser` | int | `101` | UID to run as (nginx user) |
| `podSecurityContext.runAsGroup` | int | `101` | GID to run as |
| `podSecurityContext.fsGroup` | int | `101` | Filesystem group |
| `securityContext.allowPrivilegeEscalation` | bool | `false` | Disallow privilege escalation |
| `securityContext.readOnlyRootFilesystem` | bool | `false` | nginx needs write access to tmp dirs |
| `securityContext.capabilities.drop` | list | `["ALL"]` | Drop all Linux capabilities |

### Service Account

| Key | Type | Default | Description |
|---|---|---|---|
| `serviceAccount.create` | bool | `true` | Create a Kubernetes ServiceAccount |
| `serviceAccount.annotations` | object | `{}` | Annotations (e.g. IRSA `eks.amazonaws.com/role-arn`) |
| `serviceAccount.name` | string | `""` | Name; auto-generated from release name when empty |

### Service

| Key | Type | Default | Description |
|---|---|---|---|
| `service.type` | string | `ClusterIP` | Kubernetes Service type |
| `service.port` | int | `80` | Exposed service port |
| `service.targetPort` | int | `80` | Container port the application listens on |
| `service.annotations` | object | `{}` | Service annotations (e.g. AWS NLB annotations) |

### Ingress

| Key | Type | Default | Description |
|---|---|---|---|
| `ingress.enabled` | bool | `false` | Create an Ingress resource |
| `ingress.className` | string | `""` | Ingress class name (e.g. `nginx`, `traefik`, `alb`) |
| `ingress.annotations` | object | `{}` | Ingress annotations |
| `ingress.hosts` | list | see values.yaml | List of host/path rules |
| `ingress.hosts[].host` | string | `vesting.example.com` | Hostname |
| `ingress.hosts[].paths[].path` | string | `/` | URL path |
| `ingress.hosts[].paths[].pathType` | string | `Prefix` | Path type (`Prefix` / `Exact` / `ImplementationSpecific`) |
| `ingress.tls` | list | `[]` | TLS configuration |

Example with cert-manager:

```yaml
ingress:
  enabled: true
  className: nginx
  annotations:
    cert-manager.io/cluster-issuer: letsencrypt-prod
  hosts:
    - host: vesting.example.com
      paths:
        - path: /
          pathType: Prefix
  tls:
    - secretName: vesting-tls
      hosts:
        - vesting.example.com
```

### Resources

| Key | Type | Default | Description |
|---|---|---|---|
| `resources.limits.cpu` | string | `500m` | CPU limit |
| `resources.limits.memory` | string | `128Mi` | Memory limit |
| `resources.requests.cpu` | string | `100m` | CPU request |
| `resources.requests.memory` | string | `64Mi` | Memory request |

### Horizontal Pod Autoscaler

| Key | Type | Default | Description |
|---|---|---|---|
| `autoscaling.enabled` | bool | `false` | Enable HPA |
| `autoscaling.minReplicas` | int | `2` | Minimum replicas |
| `autoscaling.maxReplicas` | int | `10` | Maximum replicas |
| `autoscaling.targetCPUUtilizationPercentage` | int | `70` | Target CPU utilisation (%) |
| `autoscaling.targetMemoryUtilizationPercentage` | string | `""` | Target memory utilisation (%) — leave empty to disable |

### Probes

| Key | Type | Default | Description |
|---|---|---|---|
| `livenessProbe` | object | `httpGet /` | Liveness probe configuration |
| `readinessProbe` | object | `httpGet /` | Readiness probe configuration |
| `startupProbe` | object | `httpGet /` | Startup probe (12 × 5 s = 60 s budget) |

### Pod Disruption Budget

| Key | Type | Default | Description |
|---|---|---|---|
| `podDisruptionBudget.enabled` | bool | `false` | Create a PodDisruptionBudget |
| `podDisruptionBudget.minAvailable` | int/string | `1` | Minimum available pods during disruption |

### Scheduling

| Key | Type | Default | Description |
|---|---|---|---|
| `nodeSelector` | object | `{}` | Node selector constraints |
| `tolerations` | list | `[]` | Pod tolerations |
| `affinity` | object | `{}` | Pod affinity / anti-affinity rules |
| `topologySpreadConstraints` | list | `[]` | Topology spread constraints for zone-aware scheduling |

### ConfigMap

| Key | Type | Default | Description |
|---|---|---|---|
| `configMap.create` | bool | `true` | Create a ConfigMap and mount it as `envFrom` |
| `configMap.data.STELLAR_NETWORK` | string | `mainnet` | Stellar network to connect to (`mainnet` / `testnet`) |
| `configMap.data.HORIZON_URL` | string | `https://horizon.stellar.org` | Horizon RPC endpoint URL |
| `configMap.data.LOG_LEVEL` | string | `info` | Application log level (`debug` / `info` / `warn` / `error`) |

### ExternalSecret (AWS Secrets Manager)

Requires [External Secrets Operator](https://external-secrets.io) ≥ 0.9 and a
`ClusterSecretStore` (or `SecretStore`) configured with AWS credentials.

| Key | Type | Default | Description |
|---|---|---|---|
| `externalSecret.enabled` | bool | `true` | Create an ExternalSecret resource |
| `externalSecret.refreshInterval` | string | `1h` | ESO reconciliation interval |
| `externalSecret.secretStoreName` | string | `aws-secretsmanager` | Name of the SecretStore / ClusterSecretStore |
| `externalSecret.secretStoreKind` | string | `ClusterSecretStore` | Kind: `SecretStore` or `ClusterSecretStore` |
| `externalSecret.targetSecretName` | string | `""` | Target Secret name; defaults to `<release>-secrets` |
| `externalSecret.creationPolicy` | string | `Owner` | ESO target creation policy |
| `externalSecret.data` | list | see below | Secrets to pull from the external provider |

Default secrets pulled:

| `secretKey` | `remoteRef.key` | Description |
|---|---|---|
| `DB_PASSWORD` | `vesting/db-password` | Database password |
| `RPC_KEY` | `vesting/rpc-key` | Soroban/Horizon RPC API key |
| `JWT_SECRET` | `vesting/jwt-secret` | JWT signing secret |

To add extra secrets:

```yaml
externalSecret:
  data:
    - secretKey: DB_PASSWORD
      remoteRef:
        key: vesting/db-password
    - secretKey: MY_API_KEY
      remoteRef:
        key: vesting/my-api-key
        property: apiKey   # for JSON-structured secrets
```

---

## Architecture Notes

The chart creates the following Kubernetes resources:

```
ServiceAccount
ConfigMap          (non-sensitive env vars)
ExternalSecret     (triggers ESO to create a Kubernetes Secret)
  └─ Secret        (managed by ESO — not in this chart)
Deployment
  ├─ envFrom: ConfigMap
  └─ env[]: Secret keys
Service
Ingress            (optional)
HorizontalPodAutoscaler  (optional)
PodDisruptionBudget      (optional)
```

Rolling-update checksum annotation on the pod template ensures pods restart
automatically whenever the ConfigMap changes (`checksum/config`).

---

## Publishing to GitHub Pages

The chart is packaged and published automatically via the
`.github/workflows/helm-release.yml` workflow using
[helm/chart-releaser-action](https://github.com/helm/chart-releaser-action).

Every merge to `main` that bumps `version` in `Chart.yaml` triggers a new
GitHub Release and updates the `gh-pages` branch with a fresh `index.yaml`.

Add the repo once published:

```bash
helm repo add vesting https://your-org.github.io/vesting-cliff-drip-stream
helm search repo vesting
```

---

## License

MIT — see [LICENSE](../../LICENSE) for details.
