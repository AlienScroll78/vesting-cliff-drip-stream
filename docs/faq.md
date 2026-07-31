# Frequently Asked Questions

---

## Table of Contents

- [General](#general)
- [Stream Lifecycle](#stream-lifecycle)
- [Claiming](#claiming)
- [Token Support](#token-support)
- [Fees & Gas](#fees--gas)
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

**Q: What happens if the cliff ledger is never reached?**

Nothing is claimable. Tokens stay locked in the contract vault until either the cliff ledger arrives (at which point the recipient can claim all accrued tokens at once) or the sponsor cancels the stream. If the sponsor cancels before the cliff, the **full deposit is refunded to the sponsor** — the recipient receives nothing.

---

**Q: What happens when the stream reaches `end_ledger`?**

Accrual stops at `end_ledger`. The recipient can still call `claim_vested` after that point to collect any unclaimed tokens; the cap logic in the contract uses `min(current_ledger, end_ledger)` so no extra tokens are paid out. Once the final claim is processed the schedule is deleted from storage and a `StreamCompleted` event is emitted.

---

**Q: Can the rate be changed after a stream is created?**

No. `rate_per_ledger` is immutable once the stream is created. There is no `update_stream` entry-point. To change the rate you must cancel the existing stream (subject to the refund rules above) and create a new one.

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

No pause mechanism exists. The contract has no admin key and no pause entry-point. The only options are cancel-and-recreate or wait.

---

**Q: Can a stream be transferred to a different recipient?**

No. The recipient address is set at creation and is immutable. There is no `transfer_stream` entry-point. If you need to change the recipient, cancel the current stream and create a new one for the new address.

---

**Q: Is it possible to drain a stream early (send all remaining tokens at once)?**

No. The contract only releases tokens at the linear drip rate after the cliff; there is no "drain all" operation. The sponsor can cancel the stream to recover unaccrued tokens, but cannot force-deliver all tokens early to the recipient.

---

**Q: Can a stream be created with milestone-based vesting instead of linear drip?**

Not with this contract. This contract implements a cliff + linear model only. Milestone-based vesting would require a different contract design. See [docs/comparison.md](comparison.md) for a feature comparison with standard Drips.

---

**Q: Can the vesting rate vary over time (variable rate)?**

No. The rate is a single `i128` value (tokens per ledger) set at creation and fixed for the life of the stream. Variable-rate schedules are not supported in this version.

---

## Claiming

**Q: How often should a recipient call `claim_vested`?**

As often or as rarely as you like — there is no penalty for waiting. Each call collects all accrued tokens since the last claim in a single transfer. Waiting costs nothing beyond the opportunity cost of having tokens sit in the contract.

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

---

**Q: Can native XLM be streamed?**

Yes. The native XLM asset has a SAC contract address on every Stellar network. Pass that address as the `token` argument. You can obtain the native asset contract address with:

```bash
stellar contract id asset --asset native --network testnet
```

---

**Q: Are NFTs or non-fungible assets supported?**

No. The contract works with fungible amounts expressed as `i128`. NFTs do not expose the SAC fungible token interface.

---

**Q: Can I use a custom Soroban token (not a SAC-wrapped classic asset)?**

Yes, as long as your token contract fully implements the SEP-41 interface including `transfer(from: Address, to: Address, amount: i128)`. Any deviation from the interface (different argument types, missing function) will cause the deposit step to fail.

---

**Q: Does the contract support tokens with a transfer fee or rebasing supply?**

Fee-on-transfer tokens will cause the deposited amount to be less than intended, and rebasing tokens will have their balance change inside the vault without the contract being aware. Both cases produce undefined and likely incorrect vesting behaviour. Stick to standard non-rebasing, fee-free SEP-41 tokens.

---

## Fees & Gas

**Q: Who pays the transaction fees?**

The transaction submitter pays Stellar network fees (the base fee in stroops). For `create_vesting_stream` the sponsor typically submits and pays. For `claim_vested` the recipient submits and pays. There are no protocol-level fees charged by this contract itself.

---

**Q: How expensive is `create_vesting_stream` in fees?**

The operation performs one token `transfer` (sponsor → contract vault) and one persistent storage write plus a TTL bump. Expect a higher fee than a simple payment due to the storage write, but still well within typical Soroban resource budgets. Run `stellar contract invoke --fee <amount>` with a generous fee on testnet to measure the actual resource consumption for your specific inputs.

---

**Q: Is there a risk of the stream data expiring from storage?**

TTL is extended to ~60 days on every read or write. For streams longer than 60 days without any interaction (no claims, no cancellation), call `get_schedule` periodically to trigger a TTL bump. In practice, any `claim_vested` call resets the TTL. If a stream's storage entry does expire it can no longer be claimed or cancelled — tokens would be locked. Keep streams active by claiming at least once every ~60 days.

---

**Q: How can I estimate fees before creating a stream?**

Use the `POST /estimate` backend endpoint. Provide `rate`, `cliff_duration`, and `total_duration` to get `total_deposit` and `estimated_fee_xlm` back. The fee estimate is based on the current Horizon p90 base fee and is clearly marked as an estimate. See [docs/api-reference.md](api-reference.md).

---

**Q: Are there any fees for using the backend REST API?**

No. The backend API is a self-hosted convenience layer. You pay only Stellar network fees for on-chain transactions.

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

No. There is no `upgrade` entry-point. The contract WASM is immutable once deployed. This is by design — it prevents any party (including the original deployer) from changing behaviour after the fact. If you need new functionality, deploy a new contract version and migrate streams by cancelling old ones and recreating under the new contract.

---

**Q: Does the contract support clawback (sponsor recovering tokens after the cliff)?**

There is no clawback mechanism beyond `cancel_stream`. After cancellation, the sponsor receives only the **unaccrued** portion. Tokens already accrued to the recipient (post-cliff) cannot be recovered by the sponsor.

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

For a human-readable explanation of each error with remediation steps, see [docs/error-handling.md](error-handling.md).

---

**Q: I get `ScheduleNotFound` but I'm sure I created the stream. What happened?**

Three possible causes: (1) The stream's storage TTL expired (possible for streams inactive for >60 days — see the TTL FAQ entry above). (2) You are querying a different recipient address than the one used at creation (check for typos or address encoding differences). (3) A prior `cancel_stream` or successful final claim deleted the schedule. Use `claimable_amount` and `get_schedule` view functions to inspect the current state.

---

## Security & Errors

**Q: Can the contract be upgraded or paused by a hidden admin?**

No. The contract has no `upgrade`, `pause`, or admin entry-point. Once deployed, behaviour is fixed by the WASM bytecode. There is no owner key.

---

**Q: What does error code 5 (`DepositOverflow`) mean?**

The product `rate × total_duration` exceeds `i128::MAX`. Lower the rate or the duration. The safe upper bound for rate given a duration is `i128::MAX / total_duration` (≈ `1.7 × 10^38 / total_duration`).

---

*Last updated: 2026-07-30. Open an issue if your question isn't answered here.*
