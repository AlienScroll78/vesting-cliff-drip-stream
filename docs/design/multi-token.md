# Multi-Token Vesting: Design Options

## Current State

The contract supports one token per vesting stream. Each `VestingSchedule` holds a single `token: Address` and a single `rate: i128`.

## Option A: Multiple Streams (one per token)

Extend the current approach: a sponsor creates one stream per token for the same recipient. Each stream is stored independently under a composite key `(recipient, token)`.

**Pros:** No schema changes; logic stays simple; each entry has bounded size; TTL management is per-entry.  
**Cons:** Requires N separate `create_vesting_stream` calls for N tokens.

## Option B: Token List in VestingSchedule

Store `Vec<(Address, i128)>` (token address + rate pairs) inside a single `VestingSchedule` entry, replacing the current single `token`/`rate` fields.

**Pros:** Single claim call covers all tokens.  
**Cons:** Variable-size storage entry; more complex claim logic; single TTL bump covers all tokens (less granular).

## Storage Cost Comparison

| Approach | Entry count | Entry size |
|---|---|---|
| Option A | N entries | ~100 bytes each |
| Option B | 1 entry | ~100 + 32×N bytes (grows with N) |

Option A has predictable, bounded per-entry cost. Option B's single entry grows linearly and may hit Soroban's per-entry size limits for large N.

## Recommendation: Option A

Option A is simpler, keeps per-entry storage costs bounded, and requires no changes to the existing `VestingSchedule` type. TTL management remains straightforward. Adopt Option B only if atomic multi-token claims become a hard requirement.
