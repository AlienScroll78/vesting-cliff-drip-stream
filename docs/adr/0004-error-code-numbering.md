# ADR-0004: Error Code Numbering

- **Status**: Accepted
- **Date**: 2026-06-26

## Context

Soroban surfaces contract errors as numeric codes on-chain. Clients (CLI tools, frontends, indexers) must identify failure reasons without parsing panic strings. Two approaches exist:

1. **Named-only errors** – rely on the SDK to auto-assign numbers; order-sensitive and fragile when variants are reordered.
2. **Explicit numeric codes** – each variant is pinned to a `u32` with `#[repr(u32)]`.

Auto-assigned codes change silently if a variant is inserted or reordered, breaking any client that hard-codes a number. Explicit codes are stable across refactors and can be documented in the ABI.

## Decision

All errors in `VestingError` carry explicit `#[repr(u32)]` values starting at 1 (Soroban reserves 0 for success):

| Code | Variant              | Meaning                                      |
|------|----------------------|----------------------------------------------|
| 1    | `ScheduleNotFound`   | No active schedule for the recipient         |
| 2    | `CliffNotReached`    | Current ledger is before `cliff_ledger`      |
| 3    | `InvalidDuration`    | `total_duration` ≤ `cliff_duration`          |
| 4    | `InvalidRate`        | `rate` is zero or negative                   |
| 5    | `DepositOverflow`    | Arithmetic overflow computing total deposit  |
| 6    | `ScheduleAlreadyExists` | Stream already exists for this recipient  |
| 7    | `NothingToClaim`     | Claimable amount is zero at current ledger   |

New error variants must be appended with the next available code; existing codes must never be renumbered.

## Consequences

- Client libraries can switch on numeric codes reliably across contract upgrades.
- The `#[contracterror]` macro combined with `#[repr(u32)]` enforces that codes are unique at compile time.
- Gaps in the sequence are acceptable if a variant is deprecated; the code should be marked `// reserved` rather than reassigned.
