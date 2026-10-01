# Frequently Asked Questions

---

## Table of Contents

- [General](#general)
- [Stream Lifecycle](#stream-lifecycle)
- [Claiming](#claiming)
- [Token Support](#token-support)
- [Fees & Gas](#fees--gas)
- [Cancellation & Clawback](#cancellation--clawback)
- [Multiple Streams & Wallets](#multiple-streams--wallets)
- [Integration & API](#integration--api)
- [Webhooks](#webhooks)
- [Testnet & Mainnet](#testnet--mainnet)
- [Data & Export](#data--export)
- [Advanced Features](#advanced-features)
- [Error Codes](#error-codes)
- [Security & Errors](#security--errors)

---

## General

**Q: What is Vesting Cliff Drip Stream?**

Vesting Cliff Drip Stream is a production-ready Soroban smart contract on the Stellar network that combines a **time-locked cliff** with **linear token streaming**. Sponsors deposit tokens upfront; recipients cannot claim anything until a cliff ledger is reached, after which tokens drip linearly per ledger until the stream ends. See the [README](../README.md) for the full concept overview.

---

**Q: Do I need an API key to use the contract directly?**

No. Interacting with the contract itself (via `stellar contract invoke` or any Stellar SDK) requires only a funded Stellar keypair and network fees — no API key. The backend REST API (`/estimate`, `/admin/bulk-claim`) is a convenience layer; the admin endpoint requires a Bearer token configured via `ADMIN_API_KEY` in your environment. See [docs/config.md](config.md).

---

**Q: Is the contract audited?**

Security considerations and the vulnerability reporting process are documented in [SECURITY.md](../SECURITY.md). The contract has no admin backdoor, no upgrade entry-point, and uses checked arithmetic throughout. Check the security section of the README for a full list of protections.

---

**Q: What wallets are compatible?**

Any wallet that supports Soroban contract invocations on Stellar can interact with the contract. Freighter is the primary tested wallet for the web UI. For programmatic access any Stellar SDK that supports Soroban (JavaScript `@stellar/stellar-sdk`, Python `py-stellar-base`, etc.) works. See [docs/wallet-integration.md](wallet-integration.md) for Freighter-specific integration notes.

---

**Q: Is there mobile support?**

The web UI is mobile-responsive and has been tested on modern mobile browsers. Freighter is available as a browser extension on desktop; for mobile, wallet interactions depend on mobile Stellar wallet support for Soroban. See [docs/mobile-claim-bottom-sheet.md](mobile-claim-bottom-sheet.md) for the mobile claim UI design details.

---

## Stream Lifecycle

**Q: What happens if I don't claim before the cliff?**

Nothing — and nothing is lost. No tokens exist for the recipient until the cliff ledger is reached, so there is nothing to claim and nothing to lose. Tokens accrue silently during the cliff period and all of them unlock at once in the first post-cliff claim (the "catch-up" transfer described below). Skipping claims before the cliff has zero cost.

---

**Q: What happens if the cliff ledger is never reached?**

Nothing is claimable. Tokens stay locked in the contract vault until either the cliff ledger arrives (at which point the recipient can claim all accrued tokens at once) or the sponsor cancels the stream. If the sponsor cancels before the cliff, the **full deposit is refunded to the sponsor** — the recipient receives nothing.

---

**Q: Can I have multiple streams from different sponsors?**

Not on the same contract deployment. Each stream is keyed by recipient address only, so a second `create_vesting_stream` for the same recipient fails with `ScheduleAlreadyExists` (error 6), even if it comes from a different sponsor. If you need two independent streams for one recipient (for example from two employers), deploy a second contract instance and create the second stream there. See [docs/storage.md](storage.md) for how schedules are keyed.

---

**Q: What happens when a stream expires?**

Accrual stops at `end_ledger`. The recipient can still call `claim_vested` after that point to collect any unclaimed tokens; the cap logic in the contract uses `min(current_ledger, end_ledger)` so no extra tokens are paid out. Once the final claim is processed the schedule is deleted from storage and a `StreamCompleted` event is emitted.

If the recipient stops claiming, unclaimed tokens sit in the vault until the drain delay passes, after which anyone can call `drain_expired_stream` to return the remainder to the sponsor — see the expiry question below.

---

**Q: Can the rate be changed after a stream is created?**

It depends which entry-point you use. A standard `create_vesting_stream` schedule is fixed: its `rate_per_ledger` is immutable and there is no `update_stream`. But the contract also exposes `create_variable_stream` / `create_variable_vesting_stream`, which take a list of rate segments up front. Those segments are still write-once after creation — the point is that a step-based rate is defined at creation rather than edited later. To change a rate mid-stream you must still cancel and recreate.

---

**Q: Can `cliff_duration` or `total_duration` be changed after creation?**

No, for the same reason — the `VestingSchedule` stored on-chain is write-once after `create_vesting_stream`. Cancel and recreate if you need different durations.

---

**Q: Can a recipient have more than one active stream at a time?**

Not from the same contract deployment — the schedule is keyed by recipient address, so a second `create_vesting_stream` call for the same recipient fails with `ScheduleAlreadyExists` (error 6). If you need multiple concurrent streams for one address, deploy a second contract instance.

---

**Q: Who can cancel a stream?**

Only the original **sponsor** (the address that called `create_vesting_stream`). The sponsor address is not stored explicitly; `cancel_stream` accepts a `sponsor` argument and calls `sponsor.require_auth()`, so the transaction must be signed by the sponsor. Recipients cannot cancel their own stream.

---

**Q: What does the recipient keep when a stream is cancelled?**

- **Before the cliff**: the recipient keeps nothing; the full remaining deposit is returned to the sponsor.
- **After the cliff**: the recipient keeps all tokens accrued up to the cancellation ledger (they are transferred immediately by the cancel transaction). The sponsor receives the unaccrued remainder.

---

**Q: Is there a way to pause a stream?**

Yes. The sponsor can call `pause_stream` to halt token accrual at the current ledger and `resume_stream` to restart it. Resuming shifts `end_ledger` and `cliff_ledger` forward by the paused duration, so neither party loses scheduled time — the stream effectively freezes and continues later. Only the original sponsor can pause or resume. See [docs/adr/0007-pause-resume-design.md](adr/0007-pause-resume-design.md) for the design rationale.

---

**Q: Can a stream be transferred to a different recipient?**

Yes. The sponsor can call `transfer_recipient` to reassign a stream to a new recipient address before it completes. Once the stream completes (final claim) or is cancelled there is nothing left to transfer. For older contract deployments without this entry-point, the fallback remains cancel-and-recreate.

---

**Q: What happens to tokens after the stream expires and the recipient stops claiming?**

The tokens remain locked in the [vault](glossary.md#vault). After approximately one year (~1 year of [ledgers](glossary.md#ledger)) past `end_ledger` — the [drain delay](glossary.md#drain-delay) — anyone can call `drain_expired_stream` to return unclaimed tokens to the sponsor.

---


**Q: Is it possible to drain a stream early (send all remaining tokens at once)?**

No. The contract only releases tokens at the linear drip rate after the cliff; there is no "drain all" operation. The sponsor can cancel the stream to recover unaccrued tokens, but cannot force-deliver all tokens early to the recipient.

---

**Q: Can a stream be created with milestone-based vesting instead of linear drip?**

Yes — the contract has a dedicated milestone path. Milestone streams are created with `create_variable_vesting_stream` (the overload that takes `milestones: Vec<(u32, u32)>` — ledger plus basis-points-unlocked pairs summing to 10000, in ascending ledger order) and released with `claim_milestone`, which pays out every milestone unlocked so far in one transfer. This is a different vesting *shape* than the linear drip — the two live side by side in the same contract, selected by the entry-point you call — not a replacement for it. See [milestone stream](glossary.md#milestone-stream) and [docs/comparison.md](comparison.md) for how the two models compare against standard Drips.

---

**Q: Can the vesting rate vary over time (variable rate)?**

No. The rate is a single `i128` value (tokens per ledger) set at creation and fixed for the life of the stream. Variable-rate schedules are not supported in this version.

---

## Claiming

**Q: What is the minimum claimable amount?**

There is no protocol-enforced minimum. A `claim_vested` call succeeds whenever the accrued amount is at least one base unit of the token; if the accrued amount rounds down to zero at the current ledger the contract returns `NothingToClaim` (error 7) instead of doing a zero-value transfer. Because accrual is linear in ledgers, streams with very small `rate_per_ledger` can go several ledgers between "claimable" moments — query the read-only `claimable_amount` view first to avoid wasting fees on a failed transaction.

---

**Q: Why does my claimable amount show 0?**

Work through this checklist:

1. **The cliff has not been reached yet.** Before `cliff_ledger` nothing is claimable — this is by design, not a bug. Check `get_schedule` and compare `cliff_ledger` with the current ledger.
2. **The stream is paused.** Accrual halts while a sponsor-paused stream is paused; the amount stays at 0 (or frozen) until `resume_stream` is called.
3. **You are already up to date.** Everything accrued so far was collected by a previous claim — accrual restarts on the next ledger.
4. **The rate rounds to zero this ledger.** With a very small `rate_per_ledger`, the per-ledger accrual can round below one base unit — see the minimum claimable amount above.
5. **The stream ended and was fully claimed.** A final successful claim deletes the schedule; `get_schedule` then returns empty.

If none of these apply, see the `ScheduleNotFound` troubleshooting entry below — the storage TTL may have expired.

---

**Q: How often should a recipient call `claim_vested`?**

As often or as rarely as you like — there is no penalty for waiting. Each call collects all accrued tokens since the last claim in a single transfer. Waiting costs nothing beyond the opportunity cost of having tokens sit in the contract. If you use automated claiming bots, ensure you track the submitted transaction sequence number as an [idempotency key](glossary.md#idempotency-key) to avoid duplicate submissions on network timeout.

---

**Q: What happens on the first claim after the cliff?**

All tokens accrued from `start_ledger` through the current ledger are released in a single "catch-up" transfer. This is the intended cliff behaviour — tokens accumulate silently during the cliff period and unlock in one lump sum.

---

**Q: Why does `claim_vested` return `NothingToClaim`?**

Either the cliff has not been reached yet (which returns `CliffNotReached`, error 2), or the stream has ended and all tokens were already claimed in a previous transaction. `claimable_amount` is a free read-only view you can query before attempting a claim to avoid a failed transaction.

---

**Q: Can multiple recipients be claimed in a single transaction (batch claim)?**

Not via a single `claim_vested` call — each call handles one recipient. The backend `POST /admin/bulk-claim` endpoint provides a convenience wrapper that submits claim transactions sequentially for a list of recipients. See [docs/api-reference.md](api-reference.md) for the full request/response schema.

---

## Token Support

**Q: Which tokens are supported?**

Any token that implements the Stellar Asset Contract (SAC) interface — i.e. exposes a `transfer(from, to, amount)` function conforming to the SEP-41 token interface. This covers all Stellar classic assets wrapped via SAC and any custom Soroban token that follows the standard. Non-standard tokens missing the `transfer` function will cause the `create_vesting_stream` transaction to fail at the transfer step.

Additionally, the contract admin can configure a token [allowlist](glossary.md#allowlist); when set, `create_vesting_stream` only accepts tokens on that list, and the transaction fails for anything else. Check `get_allowed_tokens` before creating a stream; if the list is empty, all SEP-41 tokens are accepted.

---

**Q: Can native XLM be streamed?**

Yes. The native XLM asset has a SAC contract address on every Stellar network. Pass that address as the `token` argument. You can obtain the native asset contract address with:

```bash
stellar contract id asset --asset native --network testnet
```

---

**Q: Can a stream vest multiple tokens at once?**

No. Each `VestingSchedule` is bound to a single `token` address set at creation. The contract has one vault per stream, and the [rate](glossary.md#rate) is denominated in that token's base unit. To stream multiple tokens to the same recipient, deploy separate contract instances or create separate streams on multiple contract deployments — one per token. A multi-token design is tracked in [docs/design/multi-token.md](design/multi-token.md).

---

**Q: What is the minimum deposit and why does it exist?**

The [minimum deposit](glossary.md#minimum-deposit) is a configurable threshold (default 100 tokens) that `rate × total_duration` must meet or exceed when calling [`create_vesting_stream`](api-reference.md#create_vesting_stream). It exists to prevent [dust](glossary.md#dust)-level streams that would consume persistent storage and ledger resources disproportionate to the tokens at stake. Violation returns error code 14 (`DepositBelowMinimum`). The threshold is stored in [instance storage](glossary.md#instance-storage) and can be updated by the contract admin via [`set_min_deposit`](api-reference.md#set_min_deposit). Check the current value with [`get_min_deposit`](api-reference.md#get_min_deposit) before stream creation.

---

**Q: Are NFTs or non-fungible assets supported?**

No. The contract works with fungible amounts expressed as `i128`. NFTs do not expose the SAC fungible token interface.

---

**Q: Can I create a stream with a custom token?**

Yes, if the token (1) fully implements the SEP-41 interface including `transfer(from: Address, to: Address, amount: i128)`, and (2) is on the admin-configured allowlist when one is set. If `create_vesting_stream` fails with `TokenNotAllowed`, ask the contract admin to add your token via the allowlist entry-point. See the token support questions above for interface requirements.

---

**Q: What happens to unclaimed tokens if the contract is upgraded?**

Nothing, as long as the upgrade is done correctly. The contract has no self-upgrade entry-point; an upgrade means deploying a new contract and migrating streams (see [docs/runbooks/contract-upgrade.md](runbooks/contract-upgrade.md)). During a proper migration, vault balances are transferred to the new contract and stream schedules are re-created before the old contract is retired, so recipients keep the ability to claim. If the storage TTL of an old stream is allowed to lapse before migration, the tokens could become unreachable — recipients should claim any accrued amounts before a announced migration deadline. Treat unannounced upgrades of a deployed contract as a red flag; the deployed WASM for a given contract ID cannot change silently.

---

**Q: Can I use a custom Soroban token (not a SAC-wrapped classic asset)?**

Yes, as long as your token contract fully implements the SEP-41 interface including `transfer(from: Address, to: Address, amount: i128)`. Any deviation from the interface (different argument types, missing function) will cause the deposit step to fail.

---

**Q: Does the contract support tokens with a transfer fee or rebasing supply?**

Fee-on-transfer tokens will cause the deposited amount to be less than intended, and rebasing tokens will have their balance change inside the vault without the contract being aware. Both cases produce undefined and likely incorrect vesting behaviour. Stick to standard non-rebasing, fee-free SEP-41 tokens.

---

## Fees & Gas

**Q: Who pays the transaction fees?**

The transaction submitter pays Stellar network fees (the base fee in stroops). For `create_vesting_stream` the sponsor typically submits and pays. For `claim_vested` the recipient submits and pays. Any [protocol fee](glossary.md#protocol-fee) configured by the contract admin is deducted from the claimable amount at transfer time; the default is 0 bps (no fee).

---

**Q: How expensive is `create_vesting_stream` in fees?**

The operation performs one token `transfer` (sponsor → contract vault) and one persistent storage write plus a TTL bump. Expect a higher fee than a simple payment due to the storage write, but still well within typical Soroban resource budgets. Run `stellar contract invoke --fee <amount>` with a generous fee on testnet to measure the actual resource consumption for your specific inputs.

---

**Q: Can a tiny amount of tokens get left over in the vault?**

Yes — this is called [dust](glossary.md#dust). It can arise from [variable rate](glossary.md#variable-rate) streams where segment boundaries don't divide evenly. Dust is swept to the recipient on the final `claim_vested` call, or recovered by the sponsor after the [drain delay](glossary.md#drain-delay) via `drain_expired_stream`.

---

**Q: Is there a risk of the stream data expiring from storage?**

TTL is extended to ~60 days on every read or write. For streams longer than 60 days without any interaction (no claims, no cancellation), call `get_schedule` periodically to trigger a TTL bump. In practice, any `claim_vested` call resets the TTL. If a stream's storage entry does expire it can no longer be claimed or cancelled — tokens would be locked. Keep streams active by claiming at least once every ~60 days.

---

**Q: How can I estimate fees before creating a stream?**

Use the `POST /estimate` backend endpoint. Provide `rate`, `cliff_duration`, and `total_duration` to get `total_deposit` and `estimated_fee_xlm` back. The fee estimate is based on the current Horizon p90 base fee and is clearly marked as an estimate. See [docs/api-reference.md](api-reference.md).

---

**Q: Is there a fee for creating a stream?**

You pay two things when creating a stream:

1. **Stellar network fees** for the transaction itself (always charged, paid in XLM by the submitter).
2. **The protocol fee**, if the contract admin has configured one. The fee is a percentage of the total deposit in basis points (1 bp = 0.01%), capped at 500 bps (5%), and is deducted from the deposit at `create_vesting_stream` time — the sponsor pays it, and the net amount is what goes into the vault. The default configuration is 0 bps (no protocol fee).

Use `POST /estimate` on the backend API to see the deposit and estimated fee before committing — see the fee estimation question below.

---

**Q: Is there a fee for claiming?**

No protocol fee. The recipient pays only the Stellar network fee for the `claim_vested` transaction — the full accrued amount is transferred to the recipient. Note that if a protocol fee was configured, it was taken from the deposit at creation time, so it does not reduce claims.

---

**Q: Who receives protocol fees?**

The treasury address configured by the contract admin. The admin sets both the fee percentage and the treasury in the `initialize` call at deployment (and can change them later with `set_fee`). When a stream is created, the full deposit moves sponsor → vault and the fee (if any) is then moved vault → treasury, so the sponsor always bears the whole cost and the vault only ever holds the net amount. A `FeeCollected` event records each collection.

---

**Q: Are there any fees for using the backend REST API?**

No. The backend API is a self-hosted convenience layer. You pay only Stellar network fees for on-chain transactions.

---

## Cancellation & Clawback

**Q: What is the difference between cancel and clawback?**

| | `cancel_stream` | `clawback_stream` |
|---|---|---|
| Who can call it | Sponsor | Sponsor (requires SAC clawback support on the token) |
| Tokens the recipient keeps | Post-cliff accrued tokens stay claimable | Remaining unclaimed tokens return to the sponsor; the stream is removed |
| Tokens the sponsor gets back | Only the unaccrued remainder | All remaining unclaimed tokens, even past the cliff |
| Intended for | Ending a stream early under normal terms | Compliance/forfeiture scenarios (e.g. regulatory clawback, contract breach) |
| Failure mode | Refund rules described above | Fails with `TokenDoesNotSupportClawback` (error 21) if the token's issuer has not enabled the SAC clawback flag; `ReasonTooLong` (error 22) if `reason` exceeds 256 bytes |

In short: cancel is the normal, fair way to end a stream — whatever the recipient has already earned stays theirs. Clawback bypasses the cliff and recovers all remaining tokens from the vault, so it is only usable when the token contract itself grants clawback authority. It is limited to tokens whose issuer has enabled `AUTH_CLAWBACK_ENABLED_FLAG`, it must be called by the stream's original sponsor (otherwise `Unauthorized`), and it requires a `reason` string of at most 256 bytes for the audit trail. A clawback event carrying the sponsor, token, amount, and reason is emitted.

---

**Q: Can a stream be cancelled after the cliff?**

Yes. Cancelling after the cliff works differently from cancelling before it:

- **After the cliff:** tokens accrued up to the cancellation ledger are transferred to the recipient immediately (or stay claimable if a claim is pending); the sponsor receives the unaccrued remainder.
- **Before the cliff:** the recipient receives nothing; the full deposit is refunded to the sponsor.

Either way the schedule is removed once cancellation succeeds and a `StreamCancelled` event is emitted. Recipients cannot block a sponsor cancellation.

---

## Multiple Streams & Wallets

**Q: Can I create streams for many recipients at once (batch create)?**

The contract does not have a batch entry-point, but you can script multiple `create_vesting_stream` calls. See [`examples/batch-create.sh`](../examples/batch-create.sh) for a shell script that loops over a list of recipients and submits individual create transactions.

---

**Q: Can one sponsor manage streams for hundreds of recipients?**

Yes. Each stream is stored independently by recipient address. A single sponsor can create streams for as many recipients as needed, subject only to having sufficient token balance for the combined deposits and enough XLM for transaction fees.

---

**Q: Can two different sponsors both create streams for the same recipient address?**

Not on the same contract deployment — the storage key is solely the recipient address, so the second `create_vesting_stream` for that recipient will fail with `ScheduleAlreadyExists` (error 6) regardless of who the sponsor is. Deploy a second contract instance if you need two independent streams for one recipient.

---

## Integration & API

**Q: Where is the full REST API reference?**

See [docs/api-reference.md](api-reference.md). It documents all endpoints, request/response schemas, error codes, and example `curl` invocations.

---

**Q: How do I integrate with the backend API from my own application?**

Send standard HTTP requests. The API uses JSON bodies and returns JSON responses. No SDK or special library is required. For authenticated endpoints include `Authorization: Bearer <ADMIN_API_KEY>` in the request header.

---

**Q: Can I use GraphQL or gRPC instead of the REST API?**

Not at this time. The backend exposes a plain HTTP/JSON API only. Submit a feature request if you need an alternative transport.

---

## Webhooks

**Q: What is the webhook system and how do I register one?**

Webhooks let you receive real-time HTTP POST notifications when stream events occur. Register an endpoint with `POST /api/v1/webhooks`, providing your HTTPS URL and the list of events you want. Supported events: `cliff_reached`, `tokens_claimed`, `stream_cancelled`, `stream_expired`. See [docs/api-reference.md](api-reference.md) for the full registration schema.

---

**Q: How do I verify that a webhook delivery came from this service?**

Every delivery includes an `X-Vesting-Signature` header containing `sha256=<hmac-hex>`. Compute `HMAC-SHA256(secret, raw_request_body)` on your end and compare — reject requests where the signatures do not match. The secret is returned when you register the webhook (store it securely; it is not retrievable afterwards).

---

**Q: What happens if my webhook endpoint is down?**

The system retries up to 3 times with exponential backoff (1 s, 2 s, 4 s). After 3 failed attempts the delivery is marked `failed` in the delivery log. You can inspect past deliveries via `GET /api/v1/webhooks/:id/deliveries`. There is no automatic re-queue after the retry window; you will need to handle missed events by polling the contract state if necessary.

---

**Q: My webhook URL uses HTTP, not HTTPS — is that supported?**

No. Only HTTPS URLs are accepted at registration time to ensure delivery security. Plain HTTP URLs are rejected with a `422` error.

---

## Testnet & Mainnet

**Q: How do I switch from testnet to mainnet?**

Update `HORIZON_URL`, `NETWORK_PASSPHRASE`, `SOROBAN_RPC_URL`, and `CONTRACT_ID` in your `.env` to the mainnet values and redeploy the contract. The `NETWORK_PASSPHRASE` for mainnet is `Public Global Stellar Network ; September 2015`. See [docs/config.md](config.md).

---

**Q: Can I use testnet tokens on mainnet (or vice versa)?**

No. Testnet and mainnet are completely separate ledgers. Assets issued on testnet have no value on mainnet. Always test on testnet first, then deploy a new contract instance on mainnet with real assets.

---

**Q: Is testnet reliable for pre-production testing?**

Testnet is periodically reset by the Stellar Development Foundation (typically every quarter). All contracts, balances, and history are wiped on reset. Do not rely on testnet state persisting long-term. For staging environments consider using Futurenet or maintaining your own local standalone network.

---

## Data & Export

**Q: Is there a CSV export of stream activity?**

Not built into the contract or the backend API directly. All events (`StreamCreated`, `TokensClaimed`, `StreamCancelled`, `StreamCompleted`) are emitted as Soroban events and indexed by Horizon. You can query them via `GET /horizon/accounts/{account}/operations` or use a third-party Soroban event indexer and export to CSV from there.

---

**Q: Can I retrieve historical claim amounts for a recipient?**

The contract itself only stores the current schedule state; claim history is not kept on-chain beyond emitted events. Query Stellar Horizon (or a Soroban event indexer) for `TokensClaimed` events filtered by recipient address to reconstruct claim history.

---

**Q: Is stream metadata (description, label, tags) stored on-chain?**

No. The `VestingSchedule` struct stores only the fields required for vesting logic: `sponsor`, `token`, `rate_per_ledger`, `start_ledger`, `cliff_ledger`, `end_ledger`. Any metadata you want to associate with a stream must be stored off-chain and linked by recipient address or a transaction hash.

---

## Advanced Features

**Q: Can the contract be upgraded after deployment?**

No. The contract WASM is not mutable by the original deployer. An `upgrade` entry-point does exist, but it is gated on the admin address set during `initialize` — `upgrade` reverts with `Unauthorized` for anyone else. The admin can be moved with `transfer_admin`, and that new admin can then upgrade the WASM in place. So if you trust the admin who initialized the contract, behaviour *can* change after deployment. See [docs/runbooks/contract-upgrade.md](runbooks/contract-upgrade.md).

---


## Error Codes

**Q: What do the contract error codes mean?**

| Code | Name | Meaning |
|---|---|---|
| 1 | `ScheduleNotFound` | No active schedule exists for the given recipient address |
| 2 | `CliffNotReached` | Current ledger is still before `cliff_ledger`; nothing is claimable |
| 3 | `InvalidDuration` | `total_duration` is not strictly greater than `cliff_duration` |
| 4 | `InvalidRate` | `rate` is zero or negative |
| 5 | `DepositOverflow` | `rate × total_duration` exceeds `i128::MAX`; lower rate or duration |
| 6 | `ScheduleAlreadyExists` | A stream already exists for this recipient; cancel it first |
| 7 | `NothingToClaim` | Cliff is passed but the claimable amount rounds to zero at this ledger |
| 8 | `StreamNotExpired` | `end_ledger` has not been reached yet |
| 9 | `TransferFailed` | The token `transfer` call reverted |
| 10 | `DrainDelayNotExpired` | `emergency_drain` called before the drain delay elapsed |
| 11 | `InvalidRecipient` | `sponsor` and `recipient` are the same address |
| 12 | `InvalidToken` | The token address is not a valid SAC contract |
| 20 | `MetadataTooLong` | The `metadata` string exceeds 256 bytes |
| 21 | `TokenDoesNotSupportClawback` | `clawback_stream` called on a token without the SAC clawback flag |
| 22 | `ReasonTooLong` | The clawback `reason` string exceeds 256 bytes |

> These codes are pinned so clients can switch on them reliably across upgrades — see [ADR-0004](adr/0004-error-code-numbering.md). Admin-only codes (`AlreadyInitialized`, `Unauthorized`) are also part of the enum.

For a human-readable explanation of each error with remediation steps, see [docs/error-handling.md](error-handling.md).

---

**Q: I get `ScheduleNotFound` but I'm sure I created the stream. What happened?**

Three possible causes: (1) The stream's storage TTL expired (possible for streams inactive for >60 days — see the TTL FAQ entry above). (2) You are querying a different recipient address than the one used at creation (check for typos or address encoding differences). (3) A prior `cancel_stream` or successful final claim deleted the schedule. Use `claimable_amount` and `get_schedule` view functions to inspect the current state.

---

## Security & Errors

**Q: Can the contract be upgraded or paused by a hidden admin?**

The contract has no hidden pause or emergency-stop switch that an outsider can trigger. There *is* an admin role (set in `initialize`), but it is limited to `upgrade`, `transfer_admin`, `set_fee`, `set_min_deposit` / `set_config`, and the `add_allowed_token` / `remove_allowed_token` allowlist. Admin calls from any other address revert with `Unauthorized`. A sponsor can also `pause_stream` their own stream, which only halts that stream's accrual.

---

**Q: What does error code 5 (`DepositOverflow`) mean?**

The product `rate × total_duration` exceeds `i128::MAX`. Lower the rate or the duration. The safe upper bound for rate given a duration is `i128::MAX / total_duration` (≈ `1.7 × 10^38 / total_duration`).

---

*Last updated: 2026-09-26. Open an issue if your question isn't answered here.*
