# vesting-backend Helm Chart

Deploys the **Soroban vesting cliff-drip stream backend** — a Node.js/Express
API server that indexes on-chain vesting events and exposes REST + WebSocket
endpoints for the frontend.

---

## Prerequisites

| Requirement | Version | Notes |
|---|---|---|
| Kubernetes | ≥ 1.25 | Tested on kind 0.22, EKS 1.29 |
| Helm | ≥ 3.12 | `helm version` |
| [External Secrets Operator](https://external-secrets.io/) | ≥ 0.9 | Required when `externalSecret.enabled=true` |
| nginx ingress controller | any | Required when `ingress.enabled=true` |
| metrics-server | ≥ 0.6 | Required when `hpa.enabled=true` |

---

## Install on a kind cluster (local dev)

```bash
# 1. Create a cluster with ingress support
cat <<EOF | kind create cluster --name vesting --config=-
kind: Cluster
apiVersion: kind.x-k8s.io/v1alpha4
nodes:
  - role: control-plane
    kubeadmConfigPatches:
      - |
        kind: InitConfiguration
        nodeRegistration:
          kubeletExtraArgs:
            node-labels: "ingress-ready=true"
    extraPortMappings:
      - containerPort: 80
        hostPort: 8080
        protocol: TCP
      - containerPort: 443
        hostPort: 8443
        protocol: TCP
EOF

# 2. Install the nginx ingress controller
kubectl apply -f https://raw.githubusercontent.com/kubernetes/ingress-nginx/controller-v1.10.1/deploy/static/provider/kind/deploy.yaml
kubectl wait --namespace ingress-nginx \
  --for=condition=ready pod \
  --selector=app.kubernetes.io/component=controller \
  --timeout=90s

# 3. Install External Secrets Operator (skip or use externalSecret.enabled=false for local dev)
helm repo add external-secrets https://charts.external-secrets.io
helm install external-secrets external-secrets/external-secrets \
  --namespace external-secrets --create-namespace

# 4. Install the chart (disable ESO for local dev)
helm install vesting-backend ./helm/vesting-backend \
  --set externalSecret.enabled=false \
  --set ingress.host=localhost

# 5. Open the backend
curl http://localhost:8080/health
```

---

## Environment-specific overrides

Override files are provided for staging and production:

```bash
# Staging
helm install vesting-backend ./helm/vesting-backend \
  --namespace vesting-staging --create-namespace \
  -f helm/vesting-backend/values-staging.yaml

# Production
helm install vesting-backend ./helm/vesting-backend \
  --namespace vesting --create-namespace \
  -f helm/vesting-backend/values-production.yaml
```

## Upgrade

```bash
helm upgrade vesting-backend ./helm/vesting-backend --reuse-values --set image.tag=1.3.0
```

## Uninstall

```bash
helm uninstall vesting-backend --namespace vesting
```

---

## Values

| Key | Default | Description |
|-----|---------|-------------|
| `image.repository` | `ghcr.io/your-org/vesting-backend` | Container image repository |
| `image.tag` | `1.0.0` | Image tag |
| `image.pullPolicy` | `IfNotPresent` | Pull policy |
| `replicaCount` | `1` | Replicas (ignored when HPA enabled) |
| `appPort` | `3001` | Port the Node.js process listens on (`PORT` env var) |
| `resources.requests.cpu` | `100m` | CPU request |
| `resources.requests.memory` | `128Mi` | Memory request |
| `resources.limits.cpu` | `500m` | CPU limit |
| `resources.limits.memory` | `256Mi` | Memory limit |
| `service.type` | `ClusterIP` | Kubernetes Service type |
| `service.port` | `80` | Service port (external) |
| `ingress.enabled` | `true` | Create Ingress resource |
| `ingress.className` | `nginx` | Ingress class |
| `ingress.host` | `vesting.example.com` | Hostname |
| `ingress.annotations` | `{}` | Extra Ingress annotations |
| `ingress.tls.enabled` | `false` | Enable TLS on the Ingress |
| `ingress.tls.secretName` | `vesting-tls` | TLS secret name |
| `hpa.enabled` | `true` | Create HorizontalPodAutoscaler |
| `hpa.minReplicas` | `1` | Minimum replicas |
| `hpa.maxReplicas` | `5` | Maximum replicas |
| `hpa.targetCPUUtilizationPercentage` | `70` | CPU utilization target % |
| `podDisruptionBudget.enabled` | `false` | Create PodDisruptionBudget |
| `podDisruptionBudget.minAvailable` | `1` | Minimum available pods during disruption |
| `podAnnotations` | `{}` | Pod annotations (e.g. `reloader.stakater.com/auto: "true"`) |
| `serviceAccount.create` | `true` | Create a ServiceAccount |
| `serviceAccount.annotations` | `{}` | Annotations (e.g. IRSA role ARN) |
| `serviceAccount.name` | `""` | Override SA name (auto-generated when empty) |
| `config.horizonUrl` | `https://horizon-testnet.stellar.org` | Stellar Horizon REST API URL |
| `config.networkPassphrase` | `Test SDF Network ; September 2015` | Stellar network passphrase |
| `config.contractId` | `""` | Deployed vesting contract ID |
| `config.sorobanRpcUrl` | `https://soroban-testnet.stellar.org` | Soroban RPC endpoint |
| `config.logLevel` | `info` | Log verbosity: `debug\|info\|warn\|error` |
| `config.requestTimeoutMs` | `30000` | Soroban RPC timeout (ms) |
| `config.graphqlMaxDepth` | `5` | GraphQL query depth limit |
| `externalSecret.enabled` | `true` | Create ExternalSecret resource |
| `externalSecret.refreshInterval` | `1h` | ESO re-fetch interval |
| `externalSecret.secretStoreRef.name` | `aws-secretsmanager` | ClusterSecretStore / SecretStore name |
| `externalSecret.secretStoreRef.kind` | `ClusterSecretStore` | `ClusterSecretStore` or `SecretStore` |
| `externalSecret.remoteSecrets` | see values.yaml | Map of `ENV_VAR → {remoteKey, property}` |
| `eventWorker.enabled` | `true` | Deploy separate event-indexing worker deployment |
| `eventWorker.replicaCount` | `1` | Event worker replicas |
| `eventWorker.resources` | see values.yaml | Event worker resource requests/limits |
| `eventWorker.hpa.enabled` | `true` | HPA for event worker |
| `eventWorker.hpa.minReplicas` | `1` | Event worker min replicas |
| `eventWorker.hpa.maxReplicas` | `3` | Event worker max replicas |

### Default secret keys pulled from the secret store

| Env var injected into Pod | `remoteKey` | `property` |
|---|---|---|
| `DATABASE_URL` | `vesting/production/app-secrets` | `database_url` |
| `REDIS_URL` | `vesting/production/app-secrets` | `redis_url` |
| `ADMIN_API_KEY` | `vesting/production/app-secrets` | `admin_api_key` |
| `SPONSOR_SECRET_KEY` | `vesting/production/app-secrets` | `sponsor_secret_key` |
| `JWT_SECRET` | `vesting/production/app-secrets` | `jwt_secret` |
| `HORIZON_API_KEY` | `vesting/production/app-secrets` | `horizon_api_key` |

### Secret rotation & pod restart

When a remote secret rotates, ESO updates the in-cluster `Secret` resource
within the `refreshInterval`. The Deployment's pod template carries a
`checksum/secret` annotation computed from the `remoteSecrets` map — when the
secret data changes, the annotation hash changes, triggering a rolling restart
of the pods automatically.

---

## Health probes

The chart wires the Node.js health endpoints defined in `backend/src/routes/health.ts`:

| Probe | Path | Notes |
|---|---|---|
| Liveness | `GET /health` | Always 200 if process is alive |
| Readiness | `GET /ready` | 503 if DB or RPC is unreachable |

---

## Publishing to GitHub Pages (Helm repo)

The `.github/workflows/helm-release.yml` workflow runs automatically on every
push to `main` that touches `helm/**`.  It uses
[chart-releaser-action](https://github.com/helm/chart-releaser-action) which:

1. Packages the chart and uploads a GitHub Release asset.
2. Pushes an updated `index.yaml` to the `gh-pages` branch.

**One-time setup:**

```bash
# Create the gh-pages branch (empty orphan)
git checkout --orphan gh-pages
git reset --hard
git commit --allow-empty -m "chore: init gh-pages"
git push origin gh-pages
git checkout main
```

Enable GitHub Pages in **Settings → Pages → Source: `gh-pages` branch, `/` (root)**.

**Add the repo locally:**

```bash
helm repo add vesting https://<your-org>.github.io/<repo-name>
helm repo update
helm search repo vesting
helm install vesting-backend vesting/vesting-backend
```
