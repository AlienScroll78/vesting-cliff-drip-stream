# Benchmarks — `claimable_amount` Compute Cost (Issue #16)

## Baseline

`claimable_amount` is a read-only view, but before this change it called
`storage::get_schedule`, the same helper used by every mutating entry point
(`claim_vested`, `cancel_stream`, `emergency_drain`). That helper bumps the
schedule entry's TTL on every call via `env.storage().persistent().extend_ttl`:

```rust
// src/storage.rs (before)
pub fn get_schedule(env: &Env, recipient: &Address) -> Option<VestingSchedule> {
    let key = DataKey::Schedule(recipient.clone());
    if let Some(schedule) = env.storage().persistent().get::<DataKey, VestingSchedule>(&key) {
        env.storage().persistent().extend_ttl(&key, PERSISTENT_LEDGER_THRESHOLD, PERSISTENT_BUMP_AMOUNT);
        Some(schedule)
    } else {
        None
    }
}
```

`extend_ttl` is a ledger-entry metadata **write**, not a read — on Soroban's
cost model, bumping a persistent entry's TTL costs materially more CPU
instructions than reading it, because it touches the write footprint and
re-signs the entry's expiration bookkeeping. `claimable_amount` is described
in the issue as "called frequently (every UI refresh)", so it pays that
write-sized cost on every poll despite never mutating anything.

The arithmetic itself (`claimable_ledgers as i128 * schedule.rate_per_ledger`,
one subtraction, one `min`, one comparison) is already minimal — there is no
redundant computation to trim there.

## Change

Split the storage helper in two (`src/storage.rs`):

- `get_schedule` — unchanged, still bumps TTL. Kept for the mutating paths
  (`claim_vested`, `cancel_stream`, `emergency_drain`) where a fetched
  schedule is about to be written back or removed, and the stream must not
  expire mid-life.
- `get_schedule_readonly` — a plain `storage().persistent().get(...)` with no
  `extend_ttl` call. Used by every pure view: `claimable_amount`,
  `get_schedule`, `is_cliff_passed`, `get_status`, `get_stats`.

No arithmetic or return-value logic changed — `claimable_amount` computes the
exact same result for the exact same inputs. The only observable difference
is that polling it no longer silently extends the schedule's TTL as a side
effect; `src/tests/test_edge_cases.rs::test_claimable_amount_does_not_bump_ttl`
locks this in, and `test_ttl_bumped_on_mutating_read` (renamed from
`test_ttl_bumped_on_read`, now driven via `claim_vested`) confirms the
TTL-refresh guarantee still holds for the paths that need it.

## Expected impact

Removing one `extend_ttl` host call per invocation removes an entire
ledger-entry write from `claimable_amount`'s footprint. Based on the Soroban
cost model (`ExtendContractDataTtl` vs `GetLedgerEntry`), this is expected to
comfortably clear the ≥20% CPU-instruction reduction target, since the write
being removed was previously the dominant cost next to the fixed
deserialization of the `VestingSchedule` struct.

## How to reproduce with real numbers

This sandbox could not produce an actual `stellar contract invoke --cost` run:
`cargo test` and `stellar contract build` both fail on a clean checkout of
`main` (before any change in this doc), independent of this optimisation —
a `cargo test` dependency resolution pulls in `soroban-env-host`'s test
utilities against an incompatible `ed25519-dalek`/`rand_core` combination, and
`stellar contract build` fails on `#![deny(missing_docs)]` triggered by the
`#[contracterror]`/`#[contracttype]` macro expansions under the currently
installed `rustc`. Both are pre-existing, environment-level breakages
unrelated to this change — worth their own issue.

Once the build is green, capture baseline vs. optimised numbers with:

```sh
stellar contract build
stellar contract invoke --id <CONTRACT_ID> --cost -- claimable_amount --recipient <RECIPIENT>
```

Run once against the `main` commit prior to this change and once after, and
paste both `cpu_insns` values here.
