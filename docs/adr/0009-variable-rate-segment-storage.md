# ADR-0009: Variable-Rate Segment Storage Layout

- **Status**: Accepted
- **Date**: 2026-10-02

## Context

Issue #717 adds variable-rate segment vesting to the contract. Segments are persisted in
`VariableRateSchedule.segments: Vec<RateSegment>` inside Soroban persistent storage. The
storage cost (XDR-encoded size) directly impacts rent fees and the minimum initial storage
deposit that deployers must fund.

Variable-rate streams coexist with the existing fixed-rate `VestingSchedule` and are stored
under a separate key (`DataKey::VariableSchedule(recipient)`), so they do not affect
fixed-rate stream storage.

## Decision

### `VariableRateSchedule` XDR Layout

| Field | Type | XDR bytes |
|---|---|---|
| `token` | `Address` (AccountId or ContractId) | 4 + 32 = 36 |
| `sponsor` | `Address` | 36 |
| `start_ledger` | `u32` | 4 |
| `cliff_ledger` | `u32` | 4 |
| `end_ledger` | `u32` | 4 |
| `last_claimed_ledger` | `u32` | 4 |
| `total_deposited` | `i128` | 16 |
| `claimed_amount` | `i128` | 16 |
| `total_claimed` | `i128` | 16 |
| `segments` | `Vec<RateSegment>` (N entries) | 4 + N × 12 |
| `paused_at_ledger` | `Option<u32>` | 5 (Some) or 4 (None) |

Each `RateSegment` is:

| Field | Type | XDR bytes |
|---|---|---|
| `end_ledger` | `u32` | 4 |
| `rate` | `i128` | 16 |
| **Total per segment** | | **20** |

Wait — `i128` is 16 bytes in XDR (two 64-bit signed integers). Corrected segment size: 4 + 16 = **20 bytes per segment**.

### Total storage for N segments

```
Base (no segments): ~141 bytes
Per segment:          20 bytes
Maximum (10 segs): ~341 bytes
```

Segment count is capped at **10** (`MAX_SEGMENTS = 10`) to bound the maximum entry size.

### Comparison to `VestingSchedule` (fixed-rate)

| Schedule type | Max XDR size |
|---|---|
| `VestingSchedule` (fixed-rate, max metadata 256 B) | ~440 bytes |
| `VariableRateSchedule` (max 10 segments) | ~341 bytes |

Variable-rate schedules are **smaller** than fixed-rate schedules with metadata because
they lack the `metadata: Option<String>` field.

## Consequences

- Persistent storage rent for variable-rate streams is bounded by `~341 bytes`.
- Off-chain systems should estimate rent cost using `341 × current_fee_per_byte`.
- Increasing `MAX_SEGMENTS` beyond 10 would increase the maximum entry size proportionally.
  A future ADR is required to change this limit.
- The 10-segment cap is enforced in `create_variable_stream` with `InvalidSegments` (error 19).

## Tests

`test_edge_cases.rs` contains tests for:
- Single-segment stream (configuration 1 — backward-compatible)
- Two-segment ramp-up stream (configuration 2)
- Three-segment piecewise stream (configuration 3)
- Empty segment list → `InvalidSegments`
- Non-ascending segment end_ledgers → `InvalidSegments`
- `InvalidSegments` error code pinned to 19

`test_variable_rate.rs` provides additional coverage for all segment validation
paths, claimable amount computation, and dust collection.
