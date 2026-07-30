# Analytics Reference

This document defines every metric and field produced by the `vesting-cliff-drip-stream`
contract that an off-chain analytics layer can aggregate for admin dashboards.

Because the contract is a Soroban smart contract, it has no database.  All analytics
are derived either from:

1. **On-chain events** — emitted by every state-changing call (see `src/events.rs`).
2. **View functions** — read-only contract calls that compute live stream snapshots.
3. **An off-chain indexer** — subscribes to Soroban events and maintains an
   event store (e.g. a `stream_events` table).  See `infra/monitoring/README.md`.

---

## View Function: `get_stream_info`

**Signature:**

```rust
pub fn get_stream_info(env: Env, recipient: Address) -> Option<StreamInfo>
```

Returns `None` if no active schedule exists for `recipient`.

**`StreamInfo` fields:**

| Field | Type | Description |
|---|---|---|
| `total_deposit` | `i128` | Total tokens deposited at stream creation: `rate_per_ledger × (end_ledger − start_ledger)`. |
| `claimed_so_far` | `i128` | Tokens already transferred to the recipient. |
| `claimable_now` | `i128` | Tokens immediately claimable at the queried ledger (0 if cliff not reached). |
| `remaining_locked` | `i128` | `total_deposit − claimed_so_far − claimable_now`. |
| `percent_vested_bps` | `u32` | Percentage of deposit claimed, in basis points (0–10 000; 5 000 = 50.00 %). |
| `cliff_reached` | `bool` | `true` when `current_ledger ≥ cliff_ledger`. |
| `stream_ended` | `bool` | `true` when `current_ledger ≥ end_ledger`. |

**Example CLI invocation:**

```bash
stellar contract invoke \
  --id "$VESTING_CONTRACT" \
  --network testnet \
  -- get_stream_info \
  --recipient "$RECIPIENT"
```

---

## On-Chain Events (for off-chain aggregation)

### `vc_create` — Stream Created

Emitted by `create_vesting_stream`.

| Position | Field | Type | Description |
|---|---|---|---|
| topic[0] | `vc_create` | Symbol | Event type discriminant. |
| topic[1] | `recipient` | Address | Stream beneficiary. |
| data[0] | `sponsor` | Address | Account that funded the stream. |
| data[1] | `token` | Address | SAC token contract address. |
| data[2] | `rate_per_ledger` | i128 | Tokens dripping per ledger. |
| data[3] | `start_ledger` | u32 | Ledger the stream was created on. |
| data[4] | `cliff_ledger` | u32 | Ledger at which tokens first unlock. |
| data[5] | `end_ledger` | u32 | Ledger at which the stream ends. |
| data[6] | `total_deposit` | i128 | Total tokens locked in the contract. |

### `vc_claim` — Tokens Claimed

Emitted by `claim_vested`.

| Position | Field | Type | Description |
|---|---|---|---|
| topic[0] | `vc_claim` | Symbol | Event type discriminant. |
| topic[1] | `recipient` | Address | Claiming address. |
| data[0] | `amount` | i128 | Tokens transferred in this claim. |
| data[1] | `ledger_claimed_through` | u32 | The stream was settled through this ledger. |

### `vc_cancel` — Stream Cancelled

Emitted by `cancel_stream`.

| Position | Field | Type | Description |
|---|---|---|---|
| topic[0] | `vc_cancel` | Symbol | Event type discriminant. |
| topic[1] | `recipient` | Address | The stream's beneficiary. |
| data[0] | `sponsor` | Address | The sponsor who cancelled. |
| data[1] | `refunded_to_sponsor` | i128 | Tokens returned to the sponsor. |
| data[2] | `released_to_recipient` | i128 | Tokens transferred to the recipient (0 if cliff not passed). |

### `vc_done` — Stream Completed

Emitted by `claim_vested` when the last tokens are claimed (stream fully exhausted).

| Position | Field | Type | Description |
|---|---|---|---|
| topic[0] | `vc_done` | Symbol | Event type discriminant. |
| topic[1] | `recipient` | Address | The recipient who completed the stream. |
| data | `token` | Address | The token that was streamed. |

---

## Aggregated Metrics (off-chain indexer)

The following metrics can be derived by an indexer consuming the events above.

### Summary Metrics

| Metric | Source events | Computation |
|---|---|---|
| `total_streams_created` | `vc_create` | `COUNT(vc_create)` |
| `active_streams` | `vc_create`, `vc_done`, `vc_cancel` | `total_created − completed − cancelled` |
| `total_tokens_locked` | `vc_create` | `SUM(total_deposit)` per token address |
| `total_tokens_claimed` | `vc_claim` | `SUM(amount)` per token address |
| `total_tokens_refunded` | `vc_cancel` | `SUM(refunded_to_sponsor)` per token address |
| `unique_sponsors` | `vc_create` | `COUNT(DISTINCT sponsor)` |
| `unique_recipients` | `vc_create` | `COUNT(DISTINCT recipient)` |

### Time-Series Metrics

| Metric | Granularity | Source | Notes |
|---|---|---|---|
| `streams_created_per_day` | Daily (last 30 days) | `vc_create` | Group by `start_ledger` mapped to wall-clock date (~5s/ledger). |
| `tokens_claimed_per_day` | Daily | `vc_claim` | Group by `ledger_claimed_through` mapped to date. |
| `active_streams_snapshot` | Per ledger | `vc_create` + `vc_done` + `vc_cancel` | Running total. |

### Token Rankings

| Metric | Computation |
|---|---|
| `top_tokens_by_total_locked` | `GROUP BY token, SUM(total_deposit) ORDER BY SUM DESC` |
| `top_tokens_by_claim_volume` | `GROUP BY token, SUM(amount) ORDER BY SUM DESC` |
| `top_sponsors_by_stream_count` | `GROUP BY sponsor, COUNT(*) ORDER BY COUNT DESC` |

---

## Caching Guidance

Results from the view functions change every ledger (~5 s).  For dashboards:

- Cache `get_stream_info` results for **1 ledger** (5 s) for live stream displays.
- Cache aggregated off-chain stats for **60 seconds** — acceptable staleness for
  admin overview pages.
- Cache `get_config` for the **lifetime of the deployed contract** (constants
  never change between deploys).

---

## Admin Dashboard Checklist

A minimal admin dashboard should expose:

- [ ] `total_streams_created`, `active_streams`, `completed_streams`, `cancelled_streams`
- [ ] `total_tokens_locked` and `total_tokens_claimed` per token
- [ ] `unique_sponsors` and `unique_recipients` counts
- [ ] A bar chart of `streams_created_per_day` (last 30 days)
- [ ] A table of top tokens by total locked value
- [ ] Per-stream detail via `get_stream_info` (linked from recipient search)
