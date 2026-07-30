# Configuration Reference

This document describes every configurable parameter for the `vesting-cliff-drip-stream`
Soroban contract and its companion CLI scripts.  All runtime values that are not
hard-coded on-chain are supplied as **shell environment variables** when using the
helper scripts in `scripts/`.

---

## Naming Conventions

| Convention | Rule | Example |
|---|---|---|
| Prefix | All contract-related vars are prefixed `VESTING_` | `VESTING_CONTRACT` |
| Case | `SCREAMING_SNAKE_CASE` | `CLIFF_DURATION` |
| Duration unit | Values that count **ledgers** end in `_DURATION` or `_LEDGER` | `CLIFF_DURATION` |
| Rate unit | Values that count **tokens per ledger** end in `_RATE` | `STREAM_RATE` |
| Address | Values that hold a Stellar/Soroban address end in `_ADDRESS` or use a role name | `SPONSOR`, `RECIPIENT`, `TOKEN` |

---

## CLI / Script Environment Variables

These variables are consumed by `scripts/invoke_create.sh`, `scripts/invoke_claim.sh`,
and `scripts/deploy.sh`.

### Deployment

| Variable | Default | Description |
|---|---|---|
| `VESTING_CONTRACT` | *(required)* | Contract ID returned by `deploy.sh` or `stellar contract deploy`. |
| `STELLAR_NETWORK` | `testnet` | Stellar network to target (`testnet`, `mainnet`, `futurenet`). |
| `STELLAR_RPC_URL` | Testnet RPC | Override the Horizon / Soroban RPC endpoint URL. |
| `STELLAR_NETWORK_PASSPHRASE` | *(derived from `STELLAR_NETWORK`)* | Network passphrase; set manually for custom networks. |

### Stream Creation (`invoke_create.sh`)

| Variable | Type | Default | Description |
|---|---|---|---|
| `SPONSOR` | key name | `default` | Stellar CLI key name that will authorise and fund the stream. |
| `RECIPIENT` | address | *(required)* | `G…` public key of the stream beneficiary. |
| `TOKEN` | address | *(required)* | `C…` SAC token contract address. |
| `RATE` | i128 (tokens/ledger) | *(required)* | Tokens released per ledger once the cliff has passed.  Must be > 0. |
| `CLIFF_DURATION` | u32 (ledgers) | *(required)* | Ledgers from stream creation until the cliff unlock.  Typical values: `17280` (~1 day), `518400` (~30 days). |
| `TOTAL_DURATION` | u32 (ledgers) | *(required)* | Total ledgers the stream runs for.  Must be strictly greater than `CLIFF_DURATION`. |

### Claim (`invoke_claim.sh`)

| Variable | Type | Default | Description |
|---|---|---|---|
| `VESTING_CONTRACT` | address | *(required)* | Deployed contract ID. |
| `RECIPIENT` | key name | `default` | Stellar CLI key name of the recipient calling `claim_vested`. |

---

## On-Chain Storage & TTL Configuration

These constants live in `src/storage.rs` and control how long persistent storage
entries remain alive on the Stellar ledger.  They are compiled into the WASM binary
and **cannot be changed without redeploying the contract**.

| Constant | Value (ledgers) | Approx. wall-clock | Purpose |
|---|---|---|---|
| `PERSISTENT_LEDGER_THRESHOLD` | 259 200 | ~30 days | Minimum remaining TTL before a bump is applied. |
| `PERSISTENT_BUMP_AMOUNT` | 518 400 | ~60 days | TTL is extended to this value on every read/write. |

### How TTL Works

Soroban persistent storage entries expire if their TTL (time-to-live, measured in
ledgers) reaches zero.  The contract calls `extend_ttl` on every `get_schedule` and
`set_schedule` invocation so that active streams are never at risk of expiry as long
as they are interacted with at least once every 30 days.

If a stream is completely dormant (no claims, no cancellations) for more than
`PERSISTENT_BUMP_AMOUNT` ledgers (~60 days), an off-chain keeper or the recipient
should call any view function (e.g. `get_schedule`) to bump the TTL before it
expires.

### Derived Ledger Timing Reference

Stellar mainnet and testnet target a **~5-second ledger close time**.

| Desired duration | Ledgers |
|---|---|
| 1 hour | 720 |
| 1 day | 17 280 |
| 7 days | 120 960 |
| 30 days | 518 400 |
| 90 days | 1 555 200 |
| 1 year | 6 307 200 |

---

## Config View Function

The contract exposes a `get_config` read-only entry point that returns the
compiled-in TTL parameters so off-chain tooling can inspect them without reading
the source code:

```bash
stellar contract invoke \
  --id "$VESTING_CONTRACT" \
  --network testnet \
  -- get_config
```

Returns a `ContractConfig` struct:

```json
{
  "persistent_ledger_threshold": 259200,
  "persistent_bump_amount": 518400
}
```

---

## Pool Size / Timeout Equivalents

The Soroban VM does not use connection pools.  The contract-level equivalents for the
concerns described in issue #296 are:

| Backend concept | Soroban equivalent | Where configured |
|---|---|---|
| Pool size | N/A – each contract invocation is isolated | — |
| Connection acquisition timeout | RPC submission timeout | Stellar CLI `--timeout` flag |
| Query timeout | Soroban instruction limit (CPU budget) | Protocol-enforced; ~100M instructions |
| Idle connection timeout | Entry TTL expiry | `PERSISTENT_BUMP_AMOUNT` constant |
| Pool exhaustion → 503 | Ledger transaction queue full → `AAAAB…txBAAAAAA==` error | Handled by RPC client |
| Pool metrics | `get_config` view + off-chain event indexer | `infra/monitoring/` |
| Separate migration connection | Separate deployer account with its own key | `SPONSOR` key in deploy scripts |
