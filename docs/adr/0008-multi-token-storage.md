# ADR-0008: Multi-Token Stream Storage Layout

- **Status**: Proposed
- **Date**: 2026-08-29

## Context

The contract currently supports one token per vesting stream. The planned multi-token feature allows a sponsor to grant a recipient allocations in multiple tokens within a single logical agreement. This requires a storage layout decision that affects read/write cost, TTL management, claim complexity, and future extensibility.

The design is informed by ADR-0001 (per-recipient storage key) and the preliminary options analysis in `docs/design/multi-token.md`. Soroban storage charges CPU and memory fees per byte read; per-entry TTL is managed independently; and entries are subject to size limits (~8 KB effective payload).

## Options

### Option A: Multiple Streams (One Per Token)

Create one `VestingSchedule` per token under a composite key `(recipient, token)`. The existing `DataKey::Schedule(Address)` becomes `DataKey::Schedule(Address, Address)` (recipient, token). A sponsor issues N separate `create_vesting_stream` calls for N tokens.

**Pros:**
- No changes to `VestingSchedule` struct — each entry stays small and bounded.
- Per-entry TTL remains granular; one token's schedule expiring does not affect others.
- Claim logic stays identical — each claim is for a single token.
- Read/write cost is O(1) per (recipient, token) pair.
- Natural fit for the existing `DataKey` enum pattern.

**Cons:**
- Requires N separate `create_vesting_stream` calls for N tokens (no atomic batch).
- Listing all tokens for a recipient requires an off-chain indexer or a secondary index (e.g., event stream or a Rust-side `Vec`).
- No built-in atomic multi-token claim — each token is claimed independently.

### Option B: Token List Serialised in a Single Key

Store `Vec<(Address, i128)>` (token address + rate pairs) inside a single `VestingSchedule` entry under `DataKey::Schedule(Address)`, replacing the current single `token` / `rate` fields.

**Pros:**
- Single claim call covers all tokens for a recipient.
- Only one storage key to manage per recipient — simple TTL bump.
- Natural "all-or-nothing" semantics for multi-token grants.

**Cons:**
- Variable-size storage entry grows linearly with N tokens (each pair ≈ 48 bytes).
- Soroban per-entry size limits may constrain the maximum number of tokens per stream.
- Claim logic becomes significantly more complex — must iterate the Vec, compute claimable amounts per token, and handle partial claims.
- Single TTL bump covers all tokens — less granular expiry.
- Deserialising the entire Vec is required even when querying a single token's status.

### Option C: Separate MultiTokenSchedule Storage

Define a new `MultiTokenSchedule` struct (distinct from `VestingSchedule`) stored under its own `DataKey::MultiSchedule(Address)` variant.

**Pros:**
- Clean separation of concerns — single-token and multi-token streams are modelled independently.
- The new struct can use a Rust-native `BTreeMap<Address, TokenAllocation>` for efficient per-token lookups.
- No mutation of the existing `VestingSchedule` type — zero risk to the battle-tested single-token path.
- Explicit opt-in: a recipient either has a `Schedule` or a `MultiSchedule`, never both.

**Cons:**
- Duplicates storage layout logic — `get_schedule` / `set_schedule` helpers must be extended or duplicated.
- Querying "does this recipient have any stream?" now requires checking two storage keys.
- Increases the surface area of the contract — two distinct schedule types to audit, test, and reason about.
- Migration path is unclear if a recipient later converts from single-token to multi-token.

## Decision

**Adopt Option A: Multiple Streams (One Per Token) with a composite key.**

Rationale:

1. **Fits the existing architecture.** ADR-0001 established the per-recipient-per-entry pattern. Extending it to per-(recipient, token) is a natural evolution with no structural surprises.
2. **Bounded, predictable storage costs.** Each entry stays ~100 bytes regardless of how many tokens a sponsor grants. There is no risk of hitting Soroban per-entry size limits.
3. **Simpler claim logic.** Each claim is for a single token, matching the current `claim_vested` flow. The contract does not need to iterate a variable-length Vec during the hot path.
4. **Granular TTL.** Each (recipient, token) entry has its own TTL. Tokens with different grant dates or durations can expire independently.
5. **No new types.** The existing `VestingSchedule` struct is reused as-is. Only the `DataKey` enum gains a new variant.

The lack of atomic batch creation is acceptable because multi-token grants are initiated by the sponsor in a controlled environment (not gas-sensitive). An off-chain indexer (using `StreamCreated` events) provides the token enumeration for read queries.

## Consequences

- `DataKey` gains a new variant: `DataKey::Schedule(Address, Address)` — `(recipient, token)`.
- `create_vesting_stream` is called once per token; the sponsor submits N transactions.
- Read helpers (`get_schedule`, `set_schedule`, `remove_schedule`) are generalised to accept a token parameter.
- An off-chain indexer or a new `recipient_tokens(Address) -> Vec<Address>` helper (backed by events or a secondary index) is needed to enumerate all tokens for a recipient.
- The existing single-token path remains unchanged — `DataKey::Schedule(Address)` is preserved for backward compatibility.
- Contract tests must cover multi-token creation, per-token claims, and mixed single/multi-token scenarios.

## Storage Key Format

```rust
pub enum DataKey {
    /// Single-token stream (existing).
    Schedule(Address),                        // recipient only
    /// Multi-token stream — one entry per (recipient, token) pair.
    ScheduleWithToken(Address, Address),      // (recipient, token)
    /// ...other variants unchanged.
}
```

**Example:**

```
Key:   ScheduleWithToken(GCXY..., CBAU...)
Value: VestingSchedule {
          token: CBAU...,
          rate_per_ledger: 50,
          start_ledger: 1_400_000,
          cliff_ledger: 1_417_280,
          end_ledger: 1_576_800,
          last_claimed_ledger: 1_400_000,
        }
```

A sponsor granting USDC and BTC to recipient GCXY… would create two storage entries:

| Key | Token | Rate |
|-----|-------|------|
| `ScheduleWithToken(GCXY…, CBAU…)` | CBAU… (USDC) | 50 |
| `ScheduleWithToken(GCXY…, CBTX…)` | CBTX… (BTC) | 5 |

## References

- ADR-0001: Per-Recipient Storage Key
- `docs/design/multi-token.md`
- `src/types.rs` — `DataKey` enum
- `src/storage.rs` — schedule accessors
