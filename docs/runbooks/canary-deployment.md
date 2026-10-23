# Canary Deployment Runbook

The Helm chart supports Argo Rollouts canary delivery. Enable it only in a
cluster with Argo Rollouts, ingress-nginx traffic routing, and Prometheus
scraping the backend's `/metrics` endpoint.

```bash
helm upgrade --install vesting-backend helm/vesting-backend \
  --set canary.enabled=true \
  --set canary.analysis.prometheusAddress=https://prometheus.example.com \
  --set monitoring.serviceMonitor.enabled=true
```

The rollout sends 10% of traffic for five minutes, evaluates the Prometheus
5xx error rate for five one-minute samples, then sends 25% for ten minutes and
evaluates again. An error rate above 2% fails analysis and Argo automatically
aborts, returning traffic to the stable ReplicaSet.

## Monitoring and promotion

Watch rollout state and the analysis runs during every deployment:

```bash
kubectl argo rollouts get rollout vesting-backend -n <namespace> --watch
kubectl get analysisrun -n <namespace>
```

To promote a paused rollout after checking the Grafana/Prometheus dashboard:

```bash
kubectl argo rollouts promote vesting-backend -n <namespace>
```

To immediately stop a rollout and restore stable traffic:

```bash
kubectl argo rollouts abort vesting-backend -n <namespace>
```

Investigate the 5xx rate, request latency, pod restarts, and the failed
`AnalysisRun` before retrying with `kubectl argo rollouts retry`.
