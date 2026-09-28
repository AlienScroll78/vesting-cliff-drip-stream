# Vesting Cliff Drip Stream vs Standard Drips

> Unfamiliar with terms like ledger, cliff, SAC, or XDR? See the [glossary](glossary.md).

This document compares **vesting-cliff-drip-stream** with standard Drips streaming contracts to highlight architectural, behavioural, and compliance differences, and provides a complete guide for migrating existing Drips-based streams.

---

## Contents

1. [Feature Comparison](#feature-comparison)
2. [Compatibility Matrix](#compatibility-matrix)
3. [Breaking Differences](#breaking-differences)
4. [Cancel & Pause/Resume Behaviour Detail](#cancel--pauseresume-behaviour-detail)
5. [Storage Model Detail](#storage-model-detail)
6. [Transaction Cost Comparison](#transaction-cost-comparison)
7. [Advanced Compliance Features](#advanced-compliance-features)
8. [Migration Guide from Standard Drips](#migration-guide-from-standard-drips)
9. [Common Pitfalls](#common-pitfalls)
10. [Rollback Plan](#rollback-plan)
11. [Timeline Estimate](#timeline-estimate)

---

## Feature Comparison

| Feature | Standard Drips | Vesting Cliff Drip Stream |
|---|---|---|
| **Token release start** | Immediately from stream creation | Only after `cliff_ledger` is reached |
| **[Cliff](glossary.md#cliff) period** | None | Mandatory; configured via `cliff_duration` |
| **First claim** | Any amount accrued since start | All tokens accrued since `start_ledger`, released in one [catch-up transfer](glossary.md#catch-up-claim) |
| **Accrual model** | Linear per block/[ledger](glossary.md#ledger) from start | Linear or stepped per ledger, locked until cliff |
| **Pause & Resume** | Varies / Often unsupported | Native `pause_stream` & `resume_stream` shifting end/cliff ledgers by paused duration |
| **Cancel — before cliff** | Proportional split at cancel time | Full [deposit](glossary.md#deposit) refunded to sponsor; recipient receives nothing |
| **Cancel — after cliff** | Proportional split at cancel time | Recipient keeps earned tokens; sponsor gets remainder |
| **Cancel — while paused** | Proportional split | Recipient receives tokens accrued up to `paused_at_ledger`; sponsor refunded remainder |
| **Multi-token support** | ERC-20 / Native | Any Soroban SAC (Stellar Asset Contract) token, XLM, or custom asset |
| **Token Allowlist** | None | Admin-managed allowlist (`add_allowed_token`, `remove_allowed_token`, `get_allowed_tokens`) |
| **Variable-Rate / Milestone Vesting** | Separate contract or complex curves | Built-in variable rate streaming with stepped segments (`claim_variable_vested`) |
| **Recipient Reassignment** | Not supported | Beneficiary can reassign stream via `transfer_recipient` without affecting terms |
| **Clawback (compliance)** | Not available | `clawback_stream` recovers remaining vault tokens with audit reason string |
| **Expired stream cleanup** | Varies by implementation | `drain_expired_stream` — permissionless after 1-year safety delay |
| **Emergency sponsor recovery** | Not available | `emergency_drain` — sponsor recovers unclaimed tokens after 1-year delay if keys lost |
| **Protocol fee & Treasury** | Fixed / hardcoded | Configurable fee basis points (up to 5%) routed to treasury address |
| **Contract Upgrades** | Immutable or proxy | Governed `upgrade` entry point replacing WASM bytecode |
| **Stream Metadata** | Off-chain | Optional immutable 256-byte metadata label stored on-chain |
| **Schedule Versioning** | Unversioned | Monotonic `version` counter on `VestingSchedule` for optimistic indexer sync |
| **Storage model** | Off-chain or mapping | Soroban [persistent storage](glossary.md#persistent-storage) with auto-TTL extension (~60 days) |
| **Overflow protection** | Varies | All arithmetic uses [checked_*](glossary.md#checked-arithmetic); returns `DepositOverflow` on failure |
| **Min deposit enforcement** | None | Configurable via `set_min_deposit`; default 100 tokens |

---

## Compatibility Matrix

This matrix summarises which Drips concepts and call patterns map cleanly, require changes, or have new capabilities.

| Drips Concept / Call | Compatibility | Notes |
|---|---|---|
| `create` with immediate release | **Requires change** | Must supply `cliff_duration`; use `0` only for no-cliff semantics |
| `create` with custom rate | **Compatible** | `rate` maps directly to `rate_per_ledger` (tokens/ledger, `i128`) |
| `create` with duration | **Compatible** | `duration` maps to `total_duration` (in ledgers) |
| `create` with approve-and-pull model | **Breaking** | Full deposit transferred upfront at creation into the contract vault |
| `create` with variable rates | **Compatible** | Use `migrate_schedule` / `claim_variable_vested` for stepped rate segments |
| `claim` any time after creation | **Breaking** | Claims before `cliff_ledger` return error `CliffNotReached` (code 2) |
| `pause` / `resume` stream | **Compatible** | Sponsors can invoke `pause_stream` and `resume_stream` natively |
| `cancel` proportional split | **Breaking** | Before cliff: 100% to sponsor. After cliff: recipient keeps earned, sponsor gets rest |
| Admin/owner cancel | **Breaking** | No global admin cancel; only original sponsor key can cancel |
| Transfer stream recipient | **Compatible** | Beneficiary can invoke `transfer_recipient` to transfer stream to new wallet |
| Multiple streams per address | **Breaking** | One active stream per recipient address; `ScheduleAlreadyExists` (code 6) |
| Token allowlisting | **New Capability** | Integrators can verify token support via `get_allowed_tokens` |
| Event subscriptions | **Compatible** | State transitions emit structured on-chain events (`StreamCreated`, etc.) |
| SAC token compliance | **Compatible** | Supports SAC clawback and classic Stellar trustlines |

---

## Breaking Differences

### ⚠ 1. Cliff is mandatory — claims before it fail hard
Standard Drips allows claims at any time. In this contract, calling `claim_vested` before `cliff_ledger` returns `CliffNotReached` (code 2). Always check `is_cliff_passed` before attempting a claim.

### ⚠ 2. Cancel before cliff returns 100% to sponsor
Standard Drips splits the balance proportionally at any time. In this contract, if the cliff has not passed, the entire deposit is refunded to the sponsor and the recipient receives nothing.

### ⚠ 3. Full deposit required upfront
Standard Drips streams often operate on an approve-then-pull model. This contract requires the sponsor to hold and transfer the full deposit (`rate × total_duration`) at creation time.

### ⚠ 4. One active stream per recipient
Creating a second stream for the same recipient address fails with `ScheduleAlreadyExists` (code 6). The previous stream must be completed or cancelled before a new one is created.

### ⚠ 5. Paused streams freeze claims
While a stream is paused (`pause_stream`), calling `claim_vested` returns `0` claimable tokens and errors with `NothingToClaim`. Token accrual halts until `resume_stream` is called.

---

## Cancel & Pause/Resume Behaviour Detail

### 1. Standard Cancellation Flow

```
Before Cliff:
  Sponsor cancels  ──►  100% refund of deposit to Sponsor.
                        Recipient receives 0 tokens.

After Cliff:
  Sponsor cancels  ──►  Recipient receives accrued tokens:
                        (active_end − last_claimed_ledger) × rate
                   ──►  Sponsor receives remaining deposit:
                        (end_ledger − active_end) × rate
```

### 2. Interaction with Pause and Resume

When a sponsor pauses a stream (`pause_stream`), the current ledger is recorded as `paused_at_ledger`. Token accrual freezes at that ledger.

```
                    pause_stream(t_pause)              resume_stream(t_resume)
                              │                                   │
──────────────┬───────────────▼───────────────────────────────────▼───────────────
          start_ledger                                        new_end_ledger
                                  ◄─── paused duration ───►
                                     (no token accrual)
```

- **Upon `resume_stream`:** The contract computes `paused_duration = current_ledger - paused_at`. Both `cliff_ledger` and `end_ledger` are shifted forward by `paused_duration`, ensuring the recipient receives their full promised stream duration.
- **Upon `cancel_stream` while paused:**
  - If cancellation occurs **before the original/extended cliff**: the sponsor receives a **100% refund** of remaining vault tokens.
  - If cancellation occurs **after cliff**: the effective `active_end` is clamped to `paused_at_ledger`. The recipient receives tokens accrued up to the pause timestamp (`paused_at_ledger - last_claimed_ledger`), and the sponsor is refunded the remaining balance.

---

## Storage Model Detail

Vesting Cliff Drip Stream stores one `VestingSchedule` entry per recipient in Soroban **persistent storage**. On every read and write, the TTL is automatically extended to ~60 days, preventing silent state expiry on Stellar.

---

## Transaction Cost Comparison

| Operation | Standard Drips | Vesting Cliff Drip Stream |
|---|---|---|
| Create stream | 1 tx (approve/pull) | 1 tx (vault deposit upfront) |
| Claim | 1 tx per claim | 1 tx per claim |
| Pause / Resume | Not available | 1 tx each (`pause_stream`, `resume_stream`) |
| Cancel | 1 tx | 1 tx (cliff-aware split) |
| Transfer Recipient | Not available | 1 tx (`transfer_recipient`) |
| Clawback | Not available | 1 tx (`clawback_stream`) |
| Drain expired | Not available | 1 tx (`drain_expired_stream`) |
| Storage fee | Varies | Persistent entry (~256 bytes); auto-extended TTL |

---

## Advanced Compliance Features

To support enterprise, DAO treasury, and regulated institutional use cases, VestingDrips introduces dedicated compliance and governance primitives:

### 1. Stellar Asset Contract (SAC) Clawback (`clawback_stream`)
Allows sponsors of regulated assets (e.g. securities, fiat-backed stablecoins) with the SAC clawback flag enabled to recover all remaining vault tokens when legally mandated (e.g. sanctions match, regulatory compliance freeze).
- Callable only by the original stream sponsor.
- Requires an immutable `reason` string (max 256 bytes).
- Bypasses cliff restrictions to immediately return unvested tokens.
- Emits structured `StreamClawedBack` event for compliance auditing.

### 2. Token Allowlist Governance
Restricts stream creation to vetted and approved asset contracts:
- `add_allowed_token(admin, token)`: Whitelists approved SAC token addresses.
- `remove_allowed_token(admin, token)`: Revokes token approval.
- `get_allowed_tokens()`: View function enabling UI and integrators to query allowed assets.
- When allowlist is empty, contract operates in permissive mode (accepting all tokens).

### 3. Emergency Drain & Lost-Key Recovery
- `emergency_drain(sponsor, recipient)`: Allows sponsors to recover stranded tokens from expired streams after a 1-year safety delay (`end_ledger + 3,153,600` ledgers) if the recipient loses access to their private keys.
- `drain_expired_stream(caller, recipient)`: Permissionless cleanup allowing any keeper to reclaim abandoned tokens and return them to the original sponsor.

---

## Migration Guide from Standard Drips

The automated migration helper script lives in [`scripts/migrate_from_drips.sh`](../scripts/migrate_from_drips.sh).

### Key Updates in Migration Tooling:
1. **Multi-token support:** Accepts arbitrary SAC token contracts via the `TOKEN` environment variable.
2. **Allowlist compatibility:** Pre-checks if the target token is whitelisted before submitting stream creation transactions.
3. **Flexible duration calculation:** Automatically derives `total_duration = ceil(remaining_balance / rate)` or accepts explicit `total_duration`.
4. **Duplicate safety:** Verifies via `get_schedule` that no existing stream exists for the recipient before attempting creation.

### Migration Execution

```bash
# Set migration parameters
export VESTING_CONTRACT=<contract-id>
export SPONSOR=<sponsor-key-name>
export TOKEN=<SAC-contract-address>
export NETWORK=testnet

# Run the migration script
./scripts/migrate_from_drips.sh migration-streams.json
```

---

## Common Pitfalls

1. **Claiming during pause:** Calling `claim_vested` on a paused stream will fail. Check schedule status before prompting users to claim.
2. **Token address vs Issuer address:** Always supply the SAC contract address (`C...`) instead of the classic issuer public key (`G...`).
3. **Allowlist rejections:** If the token allowlist is configured, ensure your token is added by the admin before running migration scripts.
4. **Duplicate streams:** Cancel or drain any existing stream for a recipient before creating a new one.

---

## Rollback Plan

If migration issues occur, use [`examples/migration-rollback.sh`](../examples/migration-rollback.sh) to cancel newly created streams and return funds to the sponsor:

```bash
export VESTING_CONTRACT=<contract-id>
export SPONSOR=<sponsor-key-name>
export NETWORK=testnet

./examples/migration-rollback.sh migration-streams.json
```

---

## Timeline Estimate

- **Rehearsal on Testnet:** 1–2 days
- **Stream Snapshot & Notice:** 2–3 days
- **Migration Execution:** 2–4 hours (automated script)
- **Application Code Deployment:** 1–2 days
- **Decommissioning:** 1 day
