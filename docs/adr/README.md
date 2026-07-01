# Architecture Decision Records

This directory captures significant design decisions made during the development of the Vesting Cliff Drip Stream contract.

Each ADR documents the context that forced a decision, what was decided, and the resulting trade-offs.

## Index

| ADR | Title | Status |
|-----|-------|--------|
| [0000](0000-template.md) | Template | — |
| [0001](0001-per-recipient-storage-key.md) | Per-Recipient Storage Key | Accepted |
| [0002](0002-i128-rate-representation.md) | i128 for Rate and Token Amounts | Accepted |
| [0003](0003-cliff-math-catchup-claim.md) | Cliff Math and Catch-Up Claim | Accepted |
| [0004](0004-error-code-numbering.md) | Error Code Numbering | Accepted |
| [0005](0005-ttl-persistent-storage-strategy.md) | TTL and Persistent Storage Strategy | Accepted |

## Adding a New ADR

1. Copy `0000-template.md` to `NNNN-short-title.md` using the next available number.
2. Fill in all sections.
3. Add a row to the index above.
4. Set status to `Proposed`; update to `Accepted` when merged.
