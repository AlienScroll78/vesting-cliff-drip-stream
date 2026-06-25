# Vesting Cliff Drip Stream

A production-ready Soroban smart contract that combines a **time-locked cliff** with **linear token streaming** for long-term contributor retention on the Stellar network.

---

## Concept

Standard Drips streams begin releasing tokens immediately. This contract adds a mandatory **cliff period** before any tokens can be claimed, ensuring contributors remain aligned with the project before unlocking value.

```
Token Flow
──────────────────────────────────────────────────────────────────────
Ledger:   start_ledger      cliff_ledger                  end_ledger
               │                 │                              │
Tokens:        │   [locked]      │  ← instant catch-up claim → │ ← linear drip ──┤
               │                 │                              │
```

1. Sponsor deposits the **full allocation** upfront into the contract vault.
2. Recipient cannot claim anything until `cliff_ledger` is reached.
3. At the cliff, all tokens accrued since `start_ledger` are **released instantly**.
4. Remaining tokens continue to **drip linearly per ledger** until `end_ledger`.

---

## Project Structure

```
.
├── Cargo.toml                     # Package manifest & dependencies
├── Makefile                       # Build / test / lint helpers
├── README.md
├── .cargo/
│   └── config.toml                # WASM build target
├── .gitignore
├── scripts/
│   ├── deploy.sh                  # Build + optimize + deploy to testnet
│   ├── invoke_create.sh           # CLI helper: create_vesting_stream
│   └── invoke_claim.sh            # CLI helper: claim_vested
└── src/
    ├── lib.rs                     # Crate root & module declarations
    ├── contract.rs                # Contract entry-points (public API)
    ├── types.rs                   # VestingSchedule & DataKey types
    ├── error.rs                   # VestingError enum (contracterror)
    ├── events.rs                  # Structured event helpers
    ├── storage.rs                 # Persistent storage read/write/TTL helpers
    └── tests/
        ├── mod.rs                 # Shared test env helpers
        ├── token_helper.rs        # SAC token creation & minting
        ├── test_create.rs         # Stream creation tests
        ├── test_claim.rs          # Claim / vesting logic tests
        ├── test_cancel.rs         # Cancellation & refund tests
        ├── test_views.rs          # Read-only view function tests
        └── test_edge_cases.rs     # Boundary & integration scenarios
```


## Security

For information about reporting vulnerabilities and our security policy, please see [SECURITY.md](SECURITY.md).


---

## Contract API

### `create_vesting_stream`

```rust
pub fn create_vesting_stream(
    env: Env,
    sponsor: Address,     // must sign; pays the deposit
    recipient: Address,   // beneficiary
    token: Address,       // SAC token contract
    rate: i128,           // tokens per ledger (> 0)
    cliff_duration: u32,  // ledgers until cliff
    total_duration: u32,  // total stream length (> cliff_duration)
) -> Result<(), VestingError>
```

### `claim_vested`

```rust
pub fn claim_vested(env: Env, recipient: Address) -> Result<i128, VestingError>
```

Returns the amount transferred. Fails with `CliffNotReached` before the cliff.

### `cancel_stream`

```rust
pub fn cancel_stream(
    env: Env,
    sponsor: Address,
    recipient: Address,
) -> Result<(), VestingError>
```

Cancels the stream. If the cliff has passed, the recipient keeps accrued tokens; the sponsor receives the remainder. If the cliff has not passed, the full deposit is refunded to the sponsor.

### View functions

| Function | Returns |
|---|---|
| `get_schedule(recipient)` | `Option<VestingSchedule>` |
| `claimable_amount(recipient)` | `i128` — `0` if cliff not reached |
| `is_cliff_passed(recipient)` | `bool` |

---

## Error Codes

| Code | Name | Meaning |
|---|---|---|
| 1 | `ScheduleNotFound` | No active schedule for the recipient |
| 2 | `CliffNotReached` | Ledger is still before `cliff_ledger` |
| 3 | `InvalidDuration` | `total_duration` ≤ `cliff_duration` |
| 4 | `InvalidRate` | `rate` is zero or negative |
| 5 | `DepositOverflow` | Arithmetic overflow computing total deposit |
| 6 | `ScheduleAlreadyExists` | A stream already exists for this recipient |
| 7 | `NothingToClaim` | Claimable amount is zero at current ledger |

---

## Quick Start

### Prerequisites

- [Rust](https://www.rust-lang.org/tools/install) with `wasm32-unknown-unknown` target
- [Stellar CLI](https://developers.stellar.org/docs/tools/developer-tools/cli/install-cli) (`stellar`)

```bash
rustup target add wasm32-unknown-unknown
```

### Build

```bash
make build
```

### Test

```bash
make test
```

CI also runs the contract test suite through Soroban's WASM runner so the
contract is exercised in the same target it is deployed to.

### Deploy to Testnet

```bash
stellar keys generate default --network testnet --fund
./scripts/deploy.sh default
```

### Invoke

```bash
export VESTING_CONTRACT=<contract-id>
export SPONSOR=default
export RECIPIENT=<G...>
export TOKEN=<C...>
export RATE=10
export CLIFF_DURATION=17280   # ~1 day at 5s/ledger
export TOTAL_DURATION=172800  # ~10 days

./scripts/invoke_create.sh
```

---

## Security Considerations

- **Auth**: Both `create_vesting_stream` (sponsor) and `claim_vested` / `cancel_stream` (respective callers) use `require_auth()`.
- **Overflow protection**: All arithmetic uses `checked_*` operations, returning `DepositOverflow` on failure.
- **Overflow boundary**: The maximum valid deposit rate for a given duration is `i128::MAX / total_duration`; one unit above that returns `DepositOverflow`.
- **Duplicate prevention**: A second stream for the same recipient is rejected with `ScheduleAlreadyExists`.
- **TTL management**: Persistent storage entries are bumped on every read/write (~60-day window) to prevent expiry of active streams.
- **No admin backdoor**: The contract has no owner/admin key; only the original sponsor can cancel.

---

## License

MIT
