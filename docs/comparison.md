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
8. [XDR encoding differences](#xdr-encoding-differences)
9. [Error code mapping](#error-code-mapping)
10. [API endpoint mapping](#api-endpoint-mapping)
11. [Migration Guide from Standard Drips](#migration-guide-from-standard-drips)
12. [Common Pitfalls](#common-pitfalls)
13. [Rollback Plan](#rollback-plan)
14. [Timeline Estimate](#timeline-estimate)

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
| `create` with immediate release | **Requires change** | Must supply `cliff_duration`; use `1` for no-cliff semantics (see [Migration Guide](#recreating-a-drips-stream-as-a-vestingdrips-stream)) |
| `create` with custom rate | **Requires change** | `rate` is **scaled by `RATE_DECIMALS` (10,000,000)** before being written to `rate_per_ledger`. A Drips rate of 1 token/ledger must be sent as `10_000_000`. See [XDR encoding differences](#xdr-encoding-differences) |
| `create` with duration | **Compatible** | `duration` maps to `total_duration`, but **both are in ledgers**, not seconds — see [XDR encoding differences](#xdr-encoding-differences) |
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

## XDR encoding differences

Both contracts are Soroban contracts and therefore both encode their arguments as `ScVal` unions rather than the classic `MuxedAccount`/`ScAddress` structures. The wire format is the same family — the dev-dependency here is `stellar-xdr 22.1.0` with the `curr` feature, so both sides use the current protocol version. What differs is the *meaning* of the fields, and three of those differences are silent: a value that encodes fine and produces a wrong result.

### `rate` is fixed-point scaled

This is the one most likely to cost you a migration.

| | Drips | VestingDrips |
|---|---|---|
| Field | `rate` | `rate_per_ledger` |
| Type | `i128` | `i128` |
| Unit | tokens per unit period, unscaled | tokens per ledger × `RATE_DECIMALS` |
| Example for 1 token/ledger | `1` | `10_000_000` |

`RATE_DECIMALS` is `10_000_000`, so a fractional rate is expressible where Drips would need an integer truncation. Passing a Drips rate through unscaled does not error — it sets the rate to 1/10,000,000 of the intended value, and every subsequent claim is short by that factor. There is no on-chain check that would catch it, so verify the encoding before submitting a live stream.

Note that `RATE_DECIMALS` is currently referenced by the contract but not defined in `types.rs`; see #856. Until that is resolved, treat the constant as documented-but-uncompiled and confirm the deployed contract's behaviour against a testnet stream.

### Durations are ledgers, not seconds

Both sides take a duration, and both callers think in seconds. Here `cliff_duration` and `total_duration` are `u32` **ledger counts**, where a ledger closes roughly every 5 seconds. A Drips duration of one year in seconds (~31,536,000) is about 6,300,000 ledgers here, and `31_536_000` ledgers would be roughly five years. Both values fit in `u32`, so an unconverted seconds value is again accepted and silently wrong.

`DRAIN_DELAY_LEDGERS` is `3_153_600` — about 182.5 days, not a full year despite often being described as one. `TTL_BUFFER_LEDGERS` is `6_307_200`.

### Funding model: one step instead of two

Drips v2 splits funding from stream creation: `create` prepares a config, then `create_streamable` finalises it, and the sponsor approves separately.

| | Drips v2 | VestingDrips |
|---|---|---|
| Steps | `create` then `create_streamable` | `create_vesting_stream` |
| Token movement | approve-and-pull | full deposit transferred in one call |
| Failure mode | config exists without a stream | all-or-nothing; no partial config |
| On failure | stale config to clean up | nothing persisted |

A migration must therefore collapse the two Drips steps into one call, and there is no equivalent of Drips' stale-configuration state to reconcile.

### Struct layout

`create_vesting_stream` takes, in order:

```
sponsor: Address, recipient: Address, token: Address,
rate: i128, cliff_duration: u32, total_duration: u32
```

Both the token and the participants are **contract addresses (`C...`)**, not classic issuer public keys (`G...`) — the contract moves tokens through the Stellar Asset Contract interface. `token` must implement SAC, including `transfer`; `clawback` is additionally required only for `clawback_stream`.

The stored `VestingSchedule` is not the argument tuple: it adds `start_ledger`, `cliff_ledger`, `end_ledger`, `last_claimed_ledger`, `total_claimed`, `claimed_amount`, `metadata`, `paused_at_ledger`, `accumulated_pause_ledgers` and `version`, with `version` placed last for XDR forward compatibility. Decoding a `VestingSchedule` from raw XDR is therefore a different shape from encoding the arguments, and `version` will grow as fields are appended.

---

## Error code mapping

This contract pins its error codes in `error.rs` and the numbering is deliberate — see [ADR-0004](adr/0004-error-code-numbering.md). A Drips caller that catches on message text rather than on the code number will not match anything here.

| Situation | Drips behaviour | VestingDrips error | Code |
|---|---|---|---|
| Claim before any accrual | no-op or zero return | `NothingToClaim` | 7 |
| Claim before the cliff | *not applicable* — Drips has no cliff | `CliffNotReached` | 2 |
| Claim / cancel with no stream | revert or no-op | `ScheduleNotFound` | 1 |
| Create for a recipient that already has a stream | Drips allows many streams | `ScheduleAlreadyExists` | 6 |
| Create with `total_duration <= cliff_duration` | n/a | `InvalidDuration` | 3 |
| Create with `rate <= 0` | n/a | `InvalidRate` | 4 |
| Create or transfer with `sponsor == recipient` | n/a | `InvalidRecipient` | 11 |
| Token is not a SAC | n/a | `InvalidToken` | 12 |
| Arithmetic overflow computing a deposit | n/a | `DepositOverflow` | 5 |
| Token transfer rejected by the SAC | surfaces the SAC error | `TransferFailed` | 9 |
| Drain before `end_ledger` | n/a | `StreamNotExpired` | 8 |
| Drain before `end_ledger + DRAIN_DELAY_LEDGERS` | n/a | `DrainDelayNotExpired` | 10 |
| Pause an already-paused stream | n/a | `StreamAlreadyPaused` | *undeclared* |
| Resume a stream that is not paused | n/a | `StreamNotPaused` | *undeclared* |
| Deposit below the configured minimum | n/a | `DepositBelowMinimum` | *undeclared* |

The rows marked *undeclared* are referenced by `contract.rs` but not defined in `error.rs`, so the crate does not currently compile; see #856. No code number is given for them here because ADR-0004 pins numbering deliberately and the assignable values should be chosen as part of that fix, not by a documentation change.

**Codes 0 and 13–19 are unused.** 0 is reserved for success, and 13–19 are gaps left by earlier drafts.

For a full list including the compliance errors (`MetadataTooLong` 20, `TokenDoesNotSupportClawback` 21, `ReasonTooLong` 22), see [docs/flows.md](flows.md#invalid-transitions-and-error-mapping).

---

## API endpoint mapping

The on-chain contract is the source of truth; the HTTP API in `backend/` is an optional convenience layer. These endpoints are not a stable public interface and are not covered by the semver policy — pin the deployment if you depend on them.

| Operation | On-chain (authoritative) | Backend endpoint |
|---|---|---|
| Read a schedule | `get_schedule(recipient)` | `GET /api/v1/schedules/:recipient` |
| List a sponsor's streams | `get_streams_for_sponsor(sponsor)` | `GET /api/v1/schedules/sponsor/:sponsor` (paginated) |
| Create a stream | `create_vesting_stream(...)` | none — submit the transaction yourself |
| Claim | `claim_vested(recipient)` | none |
| Cancel | `cancel_stream(sponsor, recipient)` | none |
| Pause / resume | `pause_stream` / `resume_stream` | none |
| Clawback | `clawback_stream(...)` | none |
| Drain | `drain_expired_stream(...)` | none |
| Admin operations | `set_fee`, `set_config`, `set_min_deposit` | `/admin/*`, Bearer token via `ADMIN_API_KEY` |

The split is deliberate: state-changing operations go through a signed Soroban transaction and are not proxied, so the API can never move funds on a caller's behalf. Only reads are served over HTTP, and a read can always be replaced by a `simulateTransaction` call against the contract.

When the API is unavailable, read state with `simulateTransaction` invoking the view functions directly. `get_schedule` and `claimable_amount` cover the common cases; `stream_status` returns the full `StreamStatus` including the `Paused` state.

**One API-shaped caveat:** `get_schedule` is not side-effect free — it renews the entry's TTL, as does every other `get_*` in `storage.rs`. Reads through a view function therefore still write. See the `get_schedule_readonly` note in `src/storage.rs` and #856.

---

## Migration Guide from Standard Drips

The automated migration helper script lives in [`scripts/migrate_from_drips.sh`](../scripts/migrate_from_drips.sh).

### Recreating a Drips stream as a VestingDrips stream

#### `cliff_duration = 1` is the Drips equivalent

This is the setting that reproduces Drips' "claimable immediately" semantics, and it is the single most common migration mistake — the compatibility matrix previously suggested `0`, which does not express the intent.

| `cliff_duration` | Behaviour | Use for |
|---|---|---|
| `0` | `cliff_ledger == start_ledger`, so accrual begins immediately. Cliffs of zero are not rejected, but they leave no room to distinguish "before the cliff" from "after". | A stream that is genuinely unlocked from the instant it is created. |
| **`1`** | `cliff_ledger == start_ledger + 1`. The first ledger after creation is already past the cliff, so `is_cliff_passed` is true almost immediately and `claim_vested` behaves exactly as Drips `claim` does. | **Migrating a Drips stream.** This is the default to use. |
| `> 1` | Nothing is claimable until the cliff. | A genuine time lock. |

The practical difference between `0` and `1` is one ledger, but it matters for a migration in two ways:

- A recipient who polls `is_cliff_passed` immediately after creation gets a different answer for each. With `0` the first call already passes; with `1` the first call can still fail, and an integration that treats a `CliffNotReached` error as fatal will reject a stream that is one ledger from being claimable.
- With `1` the contract still enforces the cliff code path, so the migrated stream exercises the same validation as a locked stream and you can confirm your error handling works before committing to a real cliff.

`total_duration` must be strictly greater than `cliff_duration`, so `cliff_duration = 1` requires `total_duration >= 2`.

#### Worked example

Migrating a Drips stream paying 1 token per day, with 30 days remaining:

```jsonc
{
  "recipient": "CDLZ...",
  "sponsor":   "CDAB...",
  "token":     "CCUS...",
  // Drips: 1 token/day unscaled.   Here: multiply by RATE_DECIMALS (10_000_000).
  "rate":              10_000_000,
  // Drips equivalent: no time lock.  1 ledger, not 0 — see above.
  "cliff_duration":    1,
  // 30 days. Durations here are LEDGERS, not seconds: 30 * 17280.
  "total_duration":    518400
}
```

Three conversions, each of which fails silently if missed:

1. `rate` × 10,000,000.
2. duration in **seconds → ledgers** (1 day ≈ 17,280 ledgers at ~5 s/ledger).
3. `cliff_duration = 1`, not `0`.

The script performs the duration derivation and reads `cliff_duration` from each input record, with `CLIFF_OVERRIDE` to force a single value across a whole batch. It does **not** rescale `rate` — that is the caller's responsibility, and it is the field most likely to be wrong:

```bash
# One cliff for every stream in the batch.
export CLIFF_OVERRIDE=1
```

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
5. **Un-scaled `rate`:** The single most damaging mistake. Drips rates must be multiplied by `RATE_DECIMALS` (10,000,000). Nothing rejects an un-scaled value and no error surfaces — the stream simply pays 1/10,000,000 of the intended amount, forever. See [XDR encoding differences](#xdr-encoding-differences).
6. **Durations in seconds:** `cliff_duration` and `total_duration` are ledger counts, not seconds. A seconds value is accepted and is off by a factor of roughly 17,280.
7. **`cliff_duration = 0` instead of `1`:** Both express "no time lock", but `0` can answer `is_cliff_passed` differently on the very first poll. `1` is the documented Drips equivalent. See [Recreating a Drips stream](#recreating-a-drips-stream-as-a-vestingdrips-stream).
8. **Expecting `Cancelled` or `Drained` from a status poll:** Neither is ever returned. Every terminal path deletes the schedule, so all of them read as `NotFound`. Poll for the absence of a schedule instead of waiting for a terminal status. See [docs/flows.md](flows.md#lifecycle-state-machine).
9. **Assuming `get_schedule` is side-effect free:** It renews the entry's TTL, as does every other `get_*` in `storage.rs`. Reads write.

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
