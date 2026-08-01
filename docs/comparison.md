# Vesting Cliff Drip Stream vs Standard Drips

> Unfamiliar with terms like ledger, cliff, SAC, or XDR? See the [glossary](glossary.md).

This document compares **vesting-cliff-drip-stream** with a standard Drips stream to help users understand what is different and why, and provides a complete guide for migrating existing Drips-based streams.

---

## Contents

1. [Feature Comparison](#feature-comparison)
2. [Compatibility Matrix](#compatibility-matrix)
3. [Breaking Differences](#breaking-differences)
4. [Cancel Behaviour Detail](#cancel-behaviour-detail)
5. [Storage Model Detail](#storage-model-detail)
6. [Transaction Cost Comparison](#transaction-cost-comparison)
7. [Migration Guide](#migration-guide-from-standard-drips)
8. [Common Pitfalls](#common-pitfalls)
9. [Rollback Plan](#rollback-plan)
10. [Timeline Estimate](#timeline-estimate)

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
| **Clawback (compliance)** | Not available | `clawback_stream` recovers all remaining tokens, bypassing cliff state |
| **Expired stream cleanup** | Varies by implementation | `drain_expired_stream` — permissionless after 1-year delay |
| **Duplicate stream prevention** | Varies by implementation | Hard error (`ScheduleAlreadyExists`) — one stream per recipient |
| **Storage model** | Off-chain or on-chain mapping | Soroban [persistent storage](glossary.md#persistent-storage) keyed by recipient address with auto-[TTL](glossary.md#ttl-time-to-live) bumping (~60-day window) |
| **Admin/owner key** | Often present | None — only the original [sponsor](glossary.md#sponsor) can cancel |
| **Overflow protection** | Varies | All arithmetic uses [checked_*](glossary.md#checked-arithmetic); returns `DepositOverflow` on failure |
| **Transaction costs** | One transfer per claim | One upfront deposit + one transfer per claim; cancel splits in one tx |
| **Auth model** | Varies | [`require_auth()`](glossary.md#auth--require_auth) on sponsor (create/cancel) and recipient (claim) |
| **Min deposit enforcement** | None | Configurable via `set_min_deposit`; default 100 tokens |
| **Stream status tracking** | Off-chain only | On-chain via `get_schedule` + `is_cliff_passed`; `StreamStatus` enum |
| **Total claimed tracking** | Off-chain event indexing | On-chain `total_claimed` field in `VestingSchedule` |

---

## Compatibility Matrix

This matrix summarises which Drips concepts and call patterns map cleanly, require changes, or have no equivalent.

| Drips Concept / Call | Compatibility | Notes |
|---|---|---|
| `create` with immediate release | **Requires change** | Must supply `cliff_duration`; use `0` only for no-cliff semantics (cliff == start ledger) |
| `create` with custom rate | **Compatible** | `rate` maps directly to `rate_per_ledger` (tokens/ledger, `i128`) |
| `create` with duration | **Compatible** | `duration` maps to `total_duration` (in ledgers) |
| `create` with approve-and-pull model | **Breaking** | Full deposit transferred upfront at creation; no lazy pull model |
| `claim` any time after creation | **Breaking** | Claims before `cliff_ledger` return error `CliffNotReached` (code 2) |
| `cancel` proportional split | **Breaking** | Before cliff: 100% to sponsor. After cliff: recipient keeps earned, sponsor gets rest |
| Admin/owner cancel | **Breaking** | No admin key; only original sponsor address can call `cancel_stream` |
| Multiple streams per address | **Breaking** | One active stream per recipient address; `ScheduleAlreadyExists` (code 6) if duplicate |
| Off-chain stream index | **Requires change** | Streams stored on-chain in persistent storage; use `get_schedule` to read |
| Event subscriptions | **Compatible** | All state transitions emit structured events; same data available |
| Token agnostic | **Compatible** | Pass any SAC token contract address as `token` param |
| Custom cancel hook / callback | **Not available** | No callback hooks; post-cancel logic must be handled off-chain via event |
| Stream pause / resume | **Not available** | Streams cannot be paused; cancel and recreate is the only alternative |

---

## Breaking Differences

These are the changes most likely to cause failures if not addressed before migration. Each is marked with the error code you will see in logs if the constraint is violated.

### ⚠ 1. Cliff is mandatory — claims before it fail hard

Standard Drips allows claims at any time. In this contract, any `claim_vested` call before `cliff_ledger` returns `CliffNotReached` (error 2).

**Impact:** Any polling logic or UI that calls claim speculatively before the cliff will receive an error. Gate claim calls on `is_cliff_passed` first.

```bash
# Check cliff status before attempting a claim
stellar contract invoke --id "$VESTING_CONTRACT" --network testnet \
  -- is_cliff_passed --recipient "$RECIPIENT"
# Returns: true / false
```

### ⚠ 2. Cancel before cliff returns 100% to sponsor

Standard Drips splits the balance proportionally at any time. In this contract, if the cliff has not passed, the entire deposit is refunded to the sponsor and the recipient receives nothing.

**Impact:** Off-chain accounting that assumes a proportional refund before cliff will be wrong. Ensure your cancel flow reads the cliff state before calculating expected payouts.

### ⚠ 3. Full deposit required upfront

Standard Drips streams often operate on an approve-then-pull model. This contract requires the sponsor to hold and transfer the **full deposit** (`rate × total_duration`) at stream creation.

**Impact:** Sponsors must have sufficient token balance at creation time. Plan capital allocation accordingly.

### ⚠ 4. One active stream per recipient

Creating a second stream for the same recipient address fails with `ScheduleAlreadyExists` (error 6). The previous stream must be cancelled or fully claimed before a new one is created.

**Impact:** Any rotation or renewal workflow must cancel the existing stream before creating a new one.

### ⚠ 5. No admin cancel — sponsor address is locked at creation

Only the original `sponsor` address that created the stream can call `cancel_stream`. There is no admin key or ownership transfer mechanism.

**Impact:** If your Drips setup used an admin wallet to cancel on behalf of sponsors, you will need to restructure so the sponsor's own key authorises cancellations.

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
| Clawback | Not available | 1 tx (sponsor recovers all remaining tokens) |
| Drain expired | Not available | 1 tx (permissionless, any caller) |
| Storage fee | Varies | Persistent entry (~200 bytes); TTL bumped on access |

The upfront full deposit means sponsors must hold the entire allocation at creation time, unlike approve-and-stream models that draw down lazily. This eliminates counterparty risk for the recipient at the cost of capital lockup for the sponsor.

---

## Migration Guide from Standard Drips

This section walks through migrating a live Drips deployment step by step. The automated helper is in [`scripts/migrate_from_drips.sh`](../scripts/migrate_from_drips.sh). The rollback script is in [`examples/migration-rollback.sh`](../examples/migration-rollback.sh).

### Overview

Because Soroban contracts are immutable and Drips and vesting-cliff-drip-stream are separate contracts, migration is **additive**: new streams are created in the new contract while existing Drips streams are drained and then abandoned (or cancelled). There is no in-place upgrade.

```
Phase 0 — Prepare
Phase 1 — Deploy vesting contract (if not already deployed)
Phase 2 — Snapshot all active Drips streams
Phase 3 — Let active Drips streams drain naturally, OR cancel them
Phase 4 — Re-create streams in vesting contract for active recipients
Phase 5 — Update application code to point at new contract
Phase 6 — Decommission old Drips setup
```

### Phase 0 — Prepare

Before touching any live streams:

1. **Snapshot every active stream.** Record `recipient`, `rate`, `remaining_balance`, `current_ledger` for each stream. This is your rollback reference.
2. **Notify recipients** of the migration timeline. Cliff mechanics mean there will be a window after migration where recipients cannot claim (they must wait for the cliff in the new stream).
3. **Pre-fund sponsor wallets.** Each new stream requires the full deposit upfront. If you are migrating 20 streams with average deposit of 50,000 tokens, the sponsor wallet needs 1,000,000 tokens available.
4. **Decide on cliff duration.** If you want continuity (no lock-up gap), set `cliff_duration` to a small value (e.g. 1 ledger). If you want to re-apply a full cliff, set the desired duration.
5. **Set `total_duration`** so that `rate × total_duration` equals the remaining balance you are migrating, ensuring recipients receive the same total allocation.

### Phase 1 — Deploy vesting contract

If the contract is not yet deployed:

```bash
stellar keys generate default --network testnet --fund
./scripts/deploy.sh default
export VESTING_CONTRACT=<contract-id from deploy output>
```

Record the contract ID; you will need it throughout.

### Phase 2 — Snapshot active Drips streams

Export all active streams into a JSON file. The exact command depends on your Drips indexer or on-chain query interface. A minimal snapshot format expected by the migration script:

```json
[
  {
    "recipient": "GABC...",
    "rate": 10,
    "remaining_balance": 45000,
    "cliff_duration": 17280,
    "comment": "Alice - engineering cliff grant"
  },
  {
    "recipient": "GDEF...",
    "rate": 5,
    "remaining_balance": 25000,
    "cliff_duration": 8640,
    "comment": "Bob - advisor grant"
  }
]
```

Save as `migration-streams.json`. The migration script reads this file.

### Phase 3 — Handle existing Drips streams

You have two options for existing streams:

**Option A — Let them drain (recommended if recipients are actively claiming)**

Allow recipients to continue claiming from the old Drips contract until the stream ends. Create new vesting streams to start after the Drips stream ends. Communicate the switch-over date to recipients.

**Option B — Cancel and migrate immediately**

If your Drips implementation supports it:

```bash
# For each active stream in your Drips contract:
drips cancel --recipient <G...>
# This returns unstreamed tokens to the sponsor.
# Then recreate below in the new contract.
```

> **Note:** In standard Drips, cancellation before the stream ends returns the unstreamed balance proportionally. Record each refund amount so you can deposit the exact remaining balance in the new vesting contract.

### Phase 4 — Create streams in the vesting contract

Use the migration script for bulk creation:

```bash
export VESTING_CONTRACT=<contract-id>
export SPONSOR=<your-key-name>
export TOKEN=<SAC-contract-address>
export NETWORK=testnet  # or mainnet

./scripts/migrate_from_drips.sh migration-streams.json
```

Or manually for a single stream:

```bash
stellar contract invoke --id "$VESTING_CONTRACT" --network "$NETWORK" --source "$SPONSOR" \
  -- create_vesting_stream \
  --sponsor "$SPONSOR" \
  --recipient "$RECIPIENT" \
  --token "$TOKEN" \
  --rate "$RATE" \
  --cliff_duration "$CLIFF_DURATION" \
  --total_duration "$TOTAL_DURATION"
```

Key parameter mapping from Drips:

| Drips param | Vesting contract param | Notes |
|---|---|---|
| `recipient` | `--recipient` | Same address |
| `rate` | `--rate` | Same unit: tokens per ledger |
| `duration` | `--total_duration` | In ledgers; set to `remaining_balance / rate` for equivalent remaining payout |
| *(none)* | `--cliff_duration` | New: set to 1 for minimal cliff, or full cliff period if re-applying |
| *(none)* | `--token` | SAC contract address (was implicit in Drips) |
| *(none)* | `--sponsor` | Explicit: must match the signing key |

### Phase 5 — Update application code

Replace Drips-specific calls throughout your codebase:

**Stream creation**

```typescript
// Before (Drips)
await dripsClient.create({ recipient, rate, duration });

// After (vesting contract)
await stellarContract.invoke('create_vesting_stream', {
  sponsor,
  recipient,
  token,
  rate,
  cliff_duration: cliffDuration,
  total_duration: totalDuration,
});
```

**Claim**

```typescript
// Before (Drips)
await dripsClient.claim();

// After — gate on cliff first
const cliffPassed = await stellarContract.invoke('is_cliff_passed', { recipient });
if (!cliffPassed) {
  // Show countdown to cliff_ledger; do not attempt claim
  return;
}
await stellarContract.invoke('claim_vested', { recipient });
```

**Cancel**

```typescript
// Before (Drips) — admin-style cancel
await dripsAdmin.cancel({ recipient });

// After — only original sponsor can cancel
await stellarContract.invoke('cancel_stream', { sponsor, recipient });
```

**Stream state queries**

| Drips call | Vesting contract equivalent |
|---|---|
| Get stream balance | `get_schedule --recipient <G...>` |
| Get claimable now | `claimable_amount --recipient <G...>` |
| Check if active | `is_cliff_passed --recipient <G...>` |
| Get total paid out | `get_schedule` → `total_claimed` field |

**Error codes to handle**

| Code | Name | When it occurs | Recommended handling |
|---|---|---|---|
| 1 | `ScheduleNotFound` | Claim/cancel on non-existent stream | Show "no active stream" state |
| 2 | `CliffNotReached` | Claim before cliff | Show cliff countdown; disable claim button |
| 3 | `InvalidDuration` | `total_duration` ≤ `cliff_duration` | Validate inputs before submission |
| 4 | `InvalidRate` | `rate` is zero or negative | Validate inputs before submission |
| 5 | `DepositOverflow` | `rate × total_duration` overflows `i128` | Cap rate and duration to avoid overflow |
| 6 | `ScheduleAlreadyExists` | Creating a second stream for the same recipient | Cancel existing stream first |
| 7 | `NothingToClaim` | Claiming at same ledger as last claim | Show "nothing new to claim" message |
| 8 | `StreamNotExpired` | `drain_expired_stream` called too early | Check `end_ledger` before calling drain |
| 9 | `TransferFailed` | Token transfer failed | Retry; check token balance and clawback flag |
| 10 | `DrainDelayNotExpired` | Drain called before 1-year delay after `end_ledger` | Wait for delay to elapse |
| 11 | `InvalidRecipient` | Sponsor and recipient are the same address | Use different addresses |

### Phase 6 — Decommission Drips setup

Once all Drips streams have ended and all tokens have been claimed or refunded:

1. Remove Drips contract references from your codebase and environment configs.
2. Archive the migration snapshot JSON file for audit purposes.
3. Update documentation and internal runbooks to reference the new contract ID.
4. Revoke any admin keys or approvals that were Drips-specific.

---

## Common Pitfalls

### 1. Claiming before the cliff — silent failures become hard errors

Standard Drips is lenient: a claim returns 0 if nothing has accrued. This contract is strict: calling `claim_vested` before `cliff_ledger` returns `CliffNotReached` (error 2), which causes a transaction failure. Polling loops and scheduled jobs must check `is_cliff_passed` before invoking `claim_vested`.

### 2. Deposit calculation mistakes

The total deposit is `rate × total_duration`. If you set `rate = 10` and `total_duration = 172800`, the sponsor must hold exactly `1,728,000` tokens. An off-by-one on `total_duration` means the sponsor either has the wrong amount or the stream ends 1 ledger early. Always compute the deposit amount before funding the sponsor wallet and verify with a dry-run first.

### 3. Recreating a stream without cancelling the old one

If you cancel a Drips stream and then try to create a new vesting stream for the same recipient before verifying the old one is gone, you will receive `ScheduleAlreadyExists` (error 6). Only one active stream per recipient is allowed. Confirm with `get_schedule --recipient <G...>` that no schedule exists before creating.

### 4. Assuming cancel before cliff is proportional

Teams migrating from Drips often assume cancel returns a proportional split. Before the cliff, the vesting contract returns **100% to the sponsor**. Build this into any financial reconciliation or accounting integration. The pre-cliff period is an intentional holding period — recipients have not "earned" any tokens yet.

### 5. Using the wrong ledger cadence for duration/cliff conversions

On Stellar mainnet, ledgers close approximately every **5 seconds**. Duration conversions:

| Wall time | Ledgers (~5s each) |
|---|---|
| 1 hour | 720 |
| 1 day | 17,280 |
| 1 week | 120,960 |
| 1 month (30d) | 518,400 |
| 1 year (365d) | 6,307,200 |

Testnet ledger timing varies — do not hardcode wall-clock ↔ ledger conversions; always parameterise and validate against the current ledger via Horizon.

### 6. Missing TTL bumps for long-running streams

Soroban persistent storage entries expire if not accessed. This contract bumps TTL on every read and write, but if your stream is completely idle (no claims, no reads) for more than ~60 days, the entry may expire. Schedule a periodic `get_schedule` call (even read-only) via a keeper bot or cron job for streams longer than 60 days.

### 7. Sponsor key management

The sponsor key that creates a stream is the only key that can cancel it. If your Drips setup used a shared admin key, you need to decide whether to continue using one sponsor key for all streams or issue per-stream sponsor keys. There is no ownership transfer mechanism; choose carefully at creation time.

### 8. Token SAC address vs issuer address

The `token` parameter expects the **SAC contract address** (starts with `C`), not the issuer's `G` address. Passing the issuer address will fail. Derive the SAC address from the asset using the Stellar CLI:

```bash
stellar contract id asset --asset USDC:G<issuer> --network mainnet
```

---

## Rollback Plan

If migration fails part-way through, use the rollback script to cancel all newly created vesting streams and return deposits to the sponsor:

```bash
export VESTING_CONTRACT=<contract-id>
export SPONSOR=<your-key-name>
export NETWORK=testnet

./examples/migration-rollback.sh migration-streams.json
```

The rollback script:
1. Reads the same `migration-streams.json` snapshot used during migration.
2. For each recipient, calls `get_schedule` to verify a stream exists.
3. Calls `cancel_stream` for each, returning deposited tokens to the sponsor.
4. Logs each step with success/failure status.

**Manual rollback for a single recipient:**

```bash
stellar contract invoke --id "$VESTING_CONTRACT" --network "$NETWORK" --source "$SPONSOR" \
  -- cancel_stream \
  --sponsor "$SPONSOR" \
  --recipient "$RECIPIENT"
```

**Rollback is only possible before the cliff.** If the cliff has passed:
- `cancel_stream` still works, but the recipient keeps accrued tokens — the sponsor only recovers the unearned remainder.
- There is no way to retrieve tokens already transferred to a recipient.

**Rollback decision checklist:**

| Scenario | Action |
|---|---|
| Creation tx failed, no stream created | Nothing to rollback; fix input and retry |
| Creation succeeded, cliff not reached | Cancel stream to recover 100% of deposit |
| Creation succeeded, cliff passed | Cancel stream to recover uneamed tokens; recipient keeps cliff catch-up |
| Application code updated but no streams created | Revert code; no on-chain rollback needed |
| Old Drips streams cancelled + new streams created | Rollback new streams; Drips streams cannot be un-cancelled |

For full details and a worked example, see [`examples/migration-rollback.sh`](../examples/migration-rollback.sh).

---

## Timeline Estimate

A typical migration for a team with 10–50 active Drips streams:

| Phase | Estimated duration | Notes |
|---|---|---|
| **Phase 0 — Prepare** | 1–2 days | Snapshot export, recipient communication, sponsor wallet funding |
| **Phase 1 — Deploy contract** | 2–4 hours | Build + optimize + deploy; testnet dry-run recommended first |
| **Phase 2 — Snapshot** | 1–2 hours | Depends on indexer availability and number of streams |
| **Phase 3 — Handle Drips streams** | 1–30 days | If letting streams drain: duration of longest active stream. If cancelling immediately: 1 day |
| **Phase 4 — Create new streams** | 2–4 hours | Automated via migration script; 1–2 txs/minute on testnet |
| **Phase 5 — Update application code** | 2–5 days | Depends on codebase size; claim gating on cliff is the most common change |
| **Phase 6 — Decommission** | 1 day | Config cleanup, key revocation |

**Total (cancel-and-migrate path):** ~1 week of elapsed time, with 3–4 person-days of active work.

**Total (drain-and-migrate path):** Up to 30+ days elapsed (waiting for active streams to end), with the same 3–4 person-days of active work spread over that window.

**Risks that extend the timeline:**

- Recipient notification and approval cycles: +1–3 days
- Smart contract audit of the new deployment: +1–2 weeks if a full audit is required
- Multi-sig sponsor wallets: +1–2 days for key coordination
- Large number of streams (100+): +1–2 days for bulk creation and verification

**Recommended approach for most teams:**

1. Run a full migration rehearsal on testnet first (1–2 days).
2. Give recipients at least 1 week's notice.
3. Cancel Drips streams and migrate in a single coordinated window.
4. Keep rollback script ready for 48 hours post-migration.
