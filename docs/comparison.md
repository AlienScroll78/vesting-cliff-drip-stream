# Vesting Cliff Drip Stream vs Standard Drips

> Unfamiliar with terms like ledger, cliff, SAC, or XDR? See the [glossary](glossary.md).

This document compares **vesting-cliff-drip-stream** with a standard Drips stream to help users understand what is different and why.

---

## Feature Comparison

| Feature | Standard Drips | Vesting Cliff Drip Stream |
|---|---|---|
| **Token release start** | Immediately from stream creation | Only after `cliff_ledger` is reached |
| **[Cliff](glossary.md#cliff) period** | None | Mandatory; configured via `cliff_duration` |
| **First claim** | Any amount accrued since start | All tokens accrued since `start_ledger`, released in one [catch-up transfer](glossary.md#catch-up-claim) |
| **Accrual model** | Linear per block/[ledger](glossary.md#ledger) from start | Linear per ledger, but locked until cliff |
| **Cancel — before cliff** | Proportional split at cancel time | Full [deposit](glossary.md#deposit) refunded to sponsor; recipient receives nothing |
| **Cancel — after cliff** | Proportional split at cancel time | Recipient keeps all earned tokens; sponsor gets the remainder |
| **Duplicate stream prevention** | Varies by implementation | Hard error (`ScheduleAlreadyExists`) — one stream per recipient |
| **Storage model** | Off-chain or on-chain mapping | Soroban [persistent storage](glossary.md#persistent-storage) keyed by recipient address with auto-[TTL](glossary.md#ttl-time-to-live) bumping (~60-day window) |
| **Admin/owner key** | Often present | None — only the original [sponsor](glossary.md#sponsor) can cancel |
| **Overflow protection** | Varies | All arithmetic uses [checked_*](glossary.md#checked-arithmetic); returns `DepositOverflow` on failure |
| **Transaction costs** | One transfer per claim | One upfront deposit + one transfer per claim; cancel splits in one tx |
| **Auth model** | Varies | [`require_auth()`](glossary.md#auth--require_auth) on sponsor (create/cancel) and recipient (claim) |

---

## Cancel Behaviour Detail

The key behavioural difference is how cancellation handles the cliff:

```
Before cliff                         After cliff
─────────────────────────────        ──────────────────────────────────────
Sponsor cancels → 100% refund        Sponsor cancels → recipient keeps
to sponsor.                          earned tokens; sponsor gets rest.
Recipient gets nothing.
```

Standard Drips typically splits proportionally at any point. This contract enforces the cliff as a hard commitment boundary — if the cliff has not passed, the sponsor can reclaim everything, which protects against early exits before the vesting period begins.

---

## Storage Model Detail

Vesting Cliff Drip Stream stores one `VestingSchedule` entry per recipient in Soroban **persistent storage**. On every read and write the TTL is bumped to ~60 days, preventing silent expiry of active streams. Once a stream is fully claimed or cancelled, the entry is removed.

Standard Drips implementations often rely on off-chain indexing or a mapping contract without explicit TTL management, which can cause state to expire on Stellar if not regularly touched.

---

## Transaction Cost Comparison

| Operation | Standard Drips | Vesting Cliff Drip Stream |
|---|---|---|
| Create stream | 1 tx (transfer or approve) | 1 tx (full deposit upfront) |
| Claim | 1 tx per claim | 1 tx per claim |
| Cancel | 1 tx | 1 tx (handles both recipient + sponsor shares) |
| Storage fee | Varies | Persistent entry (~200 bytes); TTL bumped on access |

The upfront full deposit means sponsors must hold the entire allocation at creation time, unlike approve-and-stream models that draw down lazily. This eliminates counterparty risk for the recipient at the cost of capital lockup for the sponsor.

---

## Migration Guide from Standard Drips

### 1. Replace stream creation

Standard Drips:
```bash
drips create --recipient <G...> --rate <n> --duration <d>
```

Vesting Cliff Drip Stream:
```bash
stellar contract invoke --id $VESTING_CONTRACT -- create_vesting_stream \
  --sponsor <G...> \
  --recipient <G...> \
  --token <C...> \
  --rate <n> \
  --cliff_duration <cliff_ledgers> \
  --total_duration <total_ledgers>
```

Key differences:
- `token` must be specified explicitly (a SAC contract address).
- `cliff_duration` is required; use `0` if you want no cliff (cliff == start).
- The full deposit (`rate × total_duration`) is transferred immediately from the sponsor.

### 2. Replace claim calls

Standard Drips:
```bash
drips claim
```

Vesting Cliff Drip Stream:
```bash
stellar contract invoke --id $VESTING_CONTRACT -- claim_vested \
  --recipient <G...>
```

Claims before `cliff_ledger` will fail with `CliffNotReached` (error code 2). Build this into your UI — show the cliff countdown and disable the claim button until it passes.

### 3. Replace cancel calls

Standard Drips:
```bash
drips cancel --recipient <G...>
```

Vesting Cliff Drip Stream:
```bash
stellar contract invoke --id $VESTING_CONTRACT -- cancel_stream \
  --sponsor <G...> \
  --recipient <G...>
```

Only the original sponsor can cancel. The split behaviour depends on whether the cliff has passed (see Cancel Behaviour above).

### 4. Query stream state

| Standard Drips query | Equivalent |
|---|---|
| Get stream details | `get_schedule --recipient <G...>` |
| Get claimable balance | `claimable_amount --recipient <G...>` |
| Check if vesting active | `is_cliff_passed --recipient <G...>` |

### 5. Error codes to handle

| Code | Name | When it occurs |
|---|---|---|
| 1 | `ScheduleNotFound` | Claim/cancel on non-existent stream |
| 2 | `CliffNotReached` | Claim before cliff |
| 6 | `ScheduleAlreadyExists` | Creating a second stream for the same recipient |
| 7 | `NothingToClaim` | Claiming at a ledger with no new accrual |
