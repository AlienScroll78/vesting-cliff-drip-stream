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
| [0005](0005-ttl-persistent-storage-strategy.md) | TTL and Persistent Storage Strategy + `keeper_bump` | Accepted |
| [0006](0006-checked-arithmetic-strategy.md) | Checked Arithmetic Strategy and Overflow Boundary Documentation | Accepted |
| [0007](0007-pause-resume-design.md) | Pause/Resume Design | Proposed |
| [0009](0009-variable-rate-segment-storage.md) | Variable-Rate Segment Storage Layout | Accepted |
| [0008](0008-multi-token-storage.md) | Multi-Token Stream Storage Layout | Proposed |
| [0009](0009-reject-multi-token-streams-same-recipient.md) | Reject Multi-Token Streams for Same Recipient | Accepted |
| [0010](0010-permissionless-drain-one-year-delay.md) | Permissionless Drain with 1-Year Delay | Accepted |

## Status Definitions

| Status | Meaning |
|--------|---------|
| **Accepted** | The decision is in effect and reflected in the codebase. |
| **Proposed** | The decision is under discussion or pending implementation. |
| **Superseded** | A later ADR replaces this one (link to successor provided in the file). |
| **Deprecated** | The decision no longer applies but is retained for historical context. |

## Adding a New ADR

1. Copy `0000-template.md` to `NNNN-short-title.md` using the next available number.
2. Fill in all sections: status, date, issue reference, context, decision, consequences.
3. Add a row to the index above.
4. Set status to `Proposed`; update to `Accepted` when the corresponding PR is merged.
5. If the ADR supersedes an existing one, update the older ADR's status and add a forward reference.
