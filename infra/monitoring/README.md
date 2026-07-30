# Monitoring & Observability

This directory contains guidance for building a Prometheus-compatible monitoring
stack from the on-chain events emitted by the `vesting-cliff-drip-stream` contract.

---

## Architecture Overview

```
Stellar Network (Soroban events)
         │
         │  vc_create / vc_claim / vc_cancel / vc_done
         ▼
  ┌─────────────────────┐
  │  Event Indexer      │  (horizon event subscription or custom ingestion)
  │  e.g. horizon,      │
  │  subquery, custom   │
  └────────┬────────────┘
           │  parsed events → stream_events table
           ▼
  ┌─────────────────────┐
  │  Metrics Exporter   │  (Node.js / Go / Python service)
  │  /metrics endpoint  │  ← Prometheus text format
  └────────┬────────────┘
           │  scrape
           ▼
  ┌─────────────────────┐        ┌──────────────────────┐
  │  Prometheus         │──────► │  Grafana Dashboard   │
  └─────────────────────┘        └──────────────────────┘
```

---

## Event Schema

All events follow Soroban's `(topics, data)` structure.  The first topic is always
a `Symbol` discriminant.  See [docs/analytics.md](../../docs/analytics.md) for the
full field table.

### Quick Reference

| Event symbol | Trigger | Key data fields |
|---|---|---|
| `vc_create` | `create_vesting_stream` | sponsor, token, rate_per_ledger, start_ledger, cliff_ledger, end_ledger, total_deposit |
| `vc_claim` | `claim_vested` | amount, ledger_claimed_through |
| `vc_cancel` | `cancel_stream` | sponsor, refunded_to_sponsor, released_to_recipient |
| `vc_done` | `claim_vested` (final) | token |

---

## Prometheus Metrics

### Counters

```
# HELP vesting_streams_created_total Total number of vesting streams ever created
# TYPE vesting_streams_created_total counter
vesting_streams_created_total{token="<token_address>"} 42

# HELP vesting_claims_total Total number of claim_vested invocations
# TYPE vesting_claims_total counter
vesting_claims_total{recipient="<address>"} 7

# HELP vesting_cancellations_total Total number of streams cancelled
# TYPE vesting_cancellations_total counter
vesting_cancellations_total{token="<token_address>"} 3

# HELP vesting_completions_total Total number of streams fully exhausted
# TYPE vesting_completions_total counter
vesting_completions_total{token="<token_address>"} 15
```

### Gauges

```
# HELP vesting_active_streams Current number of active (not cancelled/completed) streams
# TYPE vesting_active_streams gauge
vesting_active_streams{token="<token_address>"} 24

# HELP vesting_tokens_locked_total Total tokens currently locked in active streams
# TYPE vesting_tokens_locked_total gauge
vesting_tokens_locked_total{token="<token_address>"} 1200000

# HELP vesting_tokens_claimed_total Cumulative tokens transferred to recipients
# TYPE vesting_tokens_claimed_total gauge
vesting_tokens_claimed_total{token="<token_address>"} 800000
```

### Histograms

```
# HELP vesting_stream_duration_ledgers Distribution of stream total durations
# TYPE vesting_stream_duration_ledgers histogram
vesting_stream_duration_ledgers_bucket{le="17280"} 5
vesting_stream_duration_ledgers_bucket{le="172800"} 30
vesting_stream_duration_ledgers_bucket{le="1728000"} 42
vesting_stream_duration_ledgers_sum 7257600
vesting_stream_duration_ledgers_count 42

# HELP vesting_claim_amount Distribution of single-claim token amounts
# TYPE vesting_claim_amount histogram
vesting_claim_amount_bucket{token="<addr>",le="1000"} 10
vesting_claim_amount_bucket{token="<addr>",le="10000"} 25
vesting_claim_amount_bucket{token="<addr>",le="+Inf"} 37
```

---

## Health / Readiness Signals

Because the contract itself has no HTTP server, "health" is defined at the indexer
level:

| Health check | Healthy condition | Degraded condition |
|---|---|---|
| Indexer lag | `current_ledger − last_indexed_ledger < 100` (~8 min) | Lag > 100 ledgers |
| Horizon connectivity | HTTP 200 from `/` endpoint | Non-200 or timeout |
| Event ingestion rate | ≥ 1 event ingested per minute during active usage | 0 events for > 10 min |
| DB connection | Query latency < 100 ms | Latency > 500 ms or connection error |

Expose these as a single `/health` endpoint on the indexer service:

```json
{
  "status": "healthy",
  "checks": {
    "indexer_lag_ledgers": 12,
    "horizon_ok": true,
    "db_ok": true,
    "last_event_age_seconds": 4
  }
}
```

### Kubernetes Probe Configuration

```yaml
# k8s/deployment.yaml (indexer service)
livenessProbe:
  httpGet:
    path: /health
    port: 3000
  initialDelaySeconds: 10
  periodSeconds: 30
  # Liveness: fast check — only verify the process is alive
  # Do NOT check external dependencies here

readinessProbe:
  httpGet:
    path: /health/ready
    port: 3000
  initialDelaySeconds: 5
  periodSeconds: 10
  # Readiness: check DB + Horizon connectivity
  # Pod removed from load balancer until all checks pass
```

---

## Grafana Dashboard Panels

Recommended panels for the Grafana dashboard:

1. **Stream Activity** — time-series of `vc_create`, `vc_done`, `vc_cancel` events per hour.
2. **Value Locked** — gauge showing `vesting_tokens_locked_total` per token.
3. **Claim Rate** — rate of `vc_claim` events (claims/hour) as a line chart.
4. **Active Streams** — single stat: `vesting_active_streams`.
5. **Top Tokens** — bar chart of tokens ranked by total locked value.
6. **Indexer Lag** — gauge showing `current_ledger − last_indexed_ledger`.
7. **Cancellation Rate** — `vesting_cancellations_total / vesting_streams_created_total`.

---

## Building the Event Indexer

### Horizon Event Subscription

Use Horizon's `/events` endpoint to stream contract events:

```bash
stellar events \
  --network testnet \
  --type contract \
  --contract-id "$VESTING_CONTRACT" \
  --start-ledger 1000000
```

Or via the JavaScript SDK:

```javascript
import { Horizon } from "@stellar/stellar-sdk";

const server = new Horizon.Server("https://horizon-testnet.stellar.org");

server.events()
  .forContract(VESTING_CONTRACT)
  .stream({
    onmessage: (event) => {
      const topic0 = event.topic[0]; // "vc_create" | "vc_claim" | ...
      ingestEvent(topic0, event);
    },
  });
```

### Mapping Events to Prometheus Metrics

```javascript
function ingestEvent(type, event) {
  switch (type) {
    case "vc_create":
      streamsCreatedTotal.labels(event.data.token).inc();
      activeStreams.labels(event.data.token).inc();
      tokensLocked.labels(event.data.token).inc(Number(event.data.total_deposit));
      break;

    case "vc_claim":
      claimsTotal.inc();
      tokensClaimed.labels(/* token from DB */recipient_token).inc(Number(event.data.amount));
      break;

    case "vc_cancel":
      cancellationsTotal.inc();
      activeStreams.labels(/* token */).dec();
      tokensLocked.labels(/* token */).dec(Number(event.data.refunded_to_sponsor) + Number(event.data.released_to_recipient));
      break;

    case "vc_done":
      completionsTotal.inc();
      activeStreams.labels(event.data /* token */).dec();
      break;
  }
}
```

---

## Alerting Rules (Prometheus)

```yaml
# prometheus/alerts.yaml
groups:
  - name: vesting_contract
    rules:
      - alert: IndexerLagHigh
        expr: vesting_indexer_lag_ledgers > 500
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Indexer is more than 500 ledgers behind"

      - alert: NoClaims
        expr: rate(vesting_claims_total[1h]) == 0
        for: 30m
        labels:
          severity: info
        annotations:
          summary: "No claims in the last 30 minutes"

      - alert: HighCancellationRate
        expr: rate(vesting_cancellations_total[1h]) / rate(vesting_streams_created_total[1h]) > 0.5
        for: 10m
        labels:
          severity: warning
        annotations:
          summary: "More than 50% of new streams are being cancelled"
```
