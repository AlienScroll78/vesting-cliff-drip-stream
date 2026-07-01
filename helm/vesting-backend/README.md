# vesting-backend Helm Chart

Deploys the Soroban vesting cliff-drip stream backend (WASM served via nginx) on Kubernetes.

## Prerequisites

- Kubernetes 1.25+
- [External Secrets Operator](https://external-secrets.io/) with a `ClusterSecretStore` named `aws-secretsmanager`
- nginx ingress controller (for ingress)
- KEDA or metrics-server (for HPA)

## Install

```bash
helm install vesting-backend ./helm/vesting-backend \
  --set image.repository=ghcr.io/your-org/vesting-backend \
  --set image.tag=1.0.0 \
  --set ingress.host=vesting.example.com
```

## Upgrade

```bash
helm upgrade vesting-backend ./helm/vesting-backend --reuse-values --set image.tag=1.1.0
```

## Uninstall

```bash
helm uninstall vesting-backend
```

## Values

| Key | Default | Description |
|-----|---------|-------------|
| `image.repository` | `ghcr.io/your-org/vesting-backend` | Container image repository |
| `image.tag` | `1.0.0` | Image tag |
| `image.pullPolicy` | `IfNotPresent` | Pull policy |
| `replicaCount` | `1` | Replicas (ignored when HPA enabled) |
| `resources.requests.cpu` | `100m` | CPU request |
| `resources.requests.memory` | `128Mi` | Memory request |
| `resources.limits.cpu` | `500m` | CPU limit |
| `resources.limits.memory` | `256Mi` | Memory limit |
| `service.type` | `ClusterIP` | Service type |
| `service.port` | `80` | Service port |
| `ingress.enabled` | `true` | Create Ingress |
| `ingress.className` | `nginx` | Ingress class |
| `ingress.host` | `vesting.example.com` | Hostname |
| `ingress.tls.enabled` | `false` | Enable TLS |
| `ingress.tls.secretName` | `vesting-tls` | TLS secret name |
| `hpa.enabled` | `true` | Create HPA |
| `hpa.minReplicas` | `1` | Minimum replicas |
| `hpa.maxReplicas` | `5` | Maximum replicas |
| `hpa.targetCPUUtilizationPercentage` | `70` | CPU target % |
| `config.horizonUrl` | `https://horizon-testnet.stellar.org` | Stellar Horizon URL |
| `config.networkPassphrase` | `Test SDF Network ; September 2015` | Network passphrase |
| `externalSecret.enabled` | `true` | Create ExternalSecret |
| `externalSecret.secretStoreName` | `aws-secretsmanager` | ClusterSecretStore name |
| `externalSecret.remoteSecretKey` | `vesting/production/app-secrets` | AWS Secrets Manager path |
| `externalSecret.keys` | see values.yaml | Key mappings (localKey / remoteProperty) |

## Publishing to GitHub Pages (Helm Repo)

```bash
# 1. Package the chart
helm package helm/vesting-backend -d docs/helm-repo/

# 2. Update or create the index
helm repo index docs/helm-repo/ --url https://<your-org>.github.io/<repo>/helm-repo/

# 3. Commit and push — GitHub Pages serves docs/
git add docs/helm-repo/
git commit -m "chore: publish helm chart"
git push

# 4. Add the repo locally
helm repo add vesting https://<your-org>.github.io/<repo>/helm-repo/
helm repo update
helm search repo vesting
```

Enable GitHub Pages in repository Settings → Pages → Source: `main` branch, `/docs` folder.
