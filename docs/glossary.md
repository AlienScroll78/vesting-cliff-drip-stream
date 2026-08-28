# Glossary

Domain-specific terms used throughout this project's documentation and code. Terms are ordered alphabetically for quick reference.

---

### Accrual

The continuous accumulation of tokens over time according to the stream's `rate`. Tokens accrue every ledger from `start_ledger` to `end_ledger`, but cannot be claimed until the [cliff](#cliff) is reached.

---

### Address

A Stellar account identifier or contract identifier. In Soroban, both user accounts (`G…`) and contracts (`C…`) are represented as `Address` values and can hold tokens or authorize transactions.

---

### Admin

The privileged [address](#address) with authority to perform sensitive contract operations: [`upgrade`](api-reference.md#upgrade) (deploy new WASM), [`transfer_admin`](api-reference.md#transfer_admin) (delegate authority), [`set_min_deposit`](api-reference.md#set_min_deposit) (configure thresholds), and [`migrate_schedule`](api-reference.md#migrate_schedule) (update legacy schemas). Set once via [`initialize`](api-reference.md#initialize) and stored in [instance storage](#instance-storage). Unlike [sponsor](#sponsor), the admin does not fund streams and cannot cancel or claim on behalf of users. Unauthorized admin operations return error code 13 (`Unauthorized`).

---

### Allowlist

An optional on-chain registry of [addresses](#address) permitted to receive vesting streams. When enabled, [`create_vesting_stream`](api-reference.md#create_vesting_stream) checks that the `recipient` address appears in the allowlist before accepting the stream; unlisted recipients are rejected with an authorization error. The allowlist is managed by the contract [admin](#admin) and stored in [instance storage](#instance-storage). By default the allowlist feature is disabled and any valid recipient address is accepted. See [`set_allowlist`](api-reference.md#set_allowlist) and [`get_allowlist`](api-reference.md#get_allowlist) for management functions.

---

### Auth / `require_auth()`

A Soroban SDK call that enforces that a given `Address` has signed the current transaction. This contract requires the sponsor to authorize `create_vesting_stream` and `cancel_stream`, and the recipient to authorize `claim_vested`.

---

### Authorization

See [Auth / `require_auth()`](#auth--require_auth).

---

### BytesN

A Soroban SDK type representing a fixed-length byte array. `BytesN<32>` is commonly used for cryptographic hashes like WASM contract hashes (SHA-256). When calling [`upgrade`](api-reference.md#upgrade), the `new_wasm_hash` parameter must be a `BytesN<32>` value obtained from `stellar contract install`. The Stellar CLI automatically handles encoding; raw SDK users must construct from a `[u8; 32]` array. See [Soroban SDK documentation](https://docs.rs/soroban-sdk/) for type conversions.

---

### Catch-up Claim

The lump-sum transfer made at the first claim after the cliff. Because tokens have been accruing since `start_ledger` but were locked, the recipient receives all accrued tokens in a single transaction the moment the cliff is passed.

---

### Checked Arithmetic

Rust operations (e.g., `checked_mul`, `checked_add`) that return `None` instead of panicking on integer overflow. This contract uses them everywhere to return [`DepositOverflow`](../src/error.rs) rather than trap.

---

### Clawback

A compliance mechanism allowing the original [sponsor](#sponsor) to recover all remaining tokens from a vesting stream, regardless of [cliff](#cliff) status. Only available on tokens that support the SAC (Stellar Asset Contract) clawback flag. Used for regulatory compliance scenarios such as AML violations, sanctions list matches, or court orders. Invoked via [`clawback_stream`](api-reference.md#clawback_stream) with a mandatory reason string for audit trails.

---

### Cliff

A mandatory waiting period before any tokens can be claimed. Defined by `cliff_duration` (in ledgers) at stream creation. No tokens are claimable before `cliff_ledger = start_ledger + cliff_duration`, even though accrual begins immediately.

---

### `cliff_duration`

The number of [ledgers](#ledger) from `start_ledger` until the cliff is reached. Passed as a `u32` to `create_vesting_stream`. Must be strictly less than `total_duration`.

---

### `cliff_ledger`

The absolute ledger sequence number at which the cliff occurs, computed as `start_ledger + cliff_duration`. Claims before this ledger fail with `CliffNotReached`.

---

### Compliance

Regulatory requirements that may necessitate recovering vested tokens from a stream, typically for Anti-Money Laundering (AML), sanctions enforcement, or court orders. The contract provides [`clawback_stream`](api-reference.md#clawback_stream) for immediate token recovery on [clawback](#clawback)-enabled assets, requiring a mandatory `reason` string (max 256 chars) for audit trails. Compliance actions bypass normal [cliff](#cliff) and [accrual](#accrual) rules, transferring all remaining vault tokens directly to the [sponsor](#sponsor). Emits a `vc_clawback` event with the reason field for off-chain compliance monitoring.

---

### Deposit

The total token amount locked into the contract vault at stream creation, computed as `rate × total_duration`. The sponsor must hold this balance at the time `create_vesting_stream` is called.

---

### Drain Delay

A mandatory waiting period of approximately 1 year (~3,153,600 [ledgers](#ledger)) after a stream's [`end_ledger`](#end_ledger) before the [`emergency_drain`](api-reference.md#emergency_drain) or [`drain_expired_stream`](api-reference.md#drain_expired_stream) function can be called. This safety window prevents abuse by giving [recipients](#recipient) ample time to claim their vested tokens. The delay is checked in ledger-time, not wall-clock time, to ensure deterministic contract behavior. Defined as `DRAIN_DELAY_LEDGERS` constant in [`contract.rs`](../src/contract.rs).

---

### Drips / Drip Stream

A token-streaming primitive where tokens flow to a recipient at a constant rate per block or ledger. This project extends the concept with a mandatory [cliff](#cliff) before any tokens are released.

---

### Dust

A fractional token remainder too small to be economically meaningful — typically a sub-stroop or single-unit balance left in the vault after all full-ledger accruals have been claimed. Dust arises from integer division when `rate × elapsed_ledgers` does not divide evenly over the stream's lifetime. The contract leaves dust in the vault and returns it to the [sponsor](#sponsor) on cancellation or via [`drain_expired_stream`](api-reference.md#drain_expired_stream) after the [drain delay](#drain-delay) elapses. The [minimum deposit](#minimum-deposit) threshold prevents streams so small that the entire deposit would be considered dust.

---

### Emergency Drain

A sponsor-initiated recovery mechanism ([`emergency_drain`](api-reference.md#emergency_drain)) for reclaiming tokens from an expired stream when the [recipient](#recipient)'s keys are permanently lost. Only callable after [`end_ledger`](#end_ledger) + [drain delay](#drain-delay) (~1 year) have elapsed. This balances two risks: preventing indefinite token lockup (if recipient keys are lost) versus protecting recipients from premature sponsor clawback. Unlike [`clawback_stream`](api-reference.md#clawback_stream), which is instantaneous and compliance-driven, emergency drain enforces a long safety window to give recipients time to claim. Returns error code 10 (`DrainDelayNotExpired`) if called too early.

---

### `end_ledger`

The absolute ledger sequence number at which the stream ends, computed as `start_ledger + total_duration`. After this ledger, no further tokens accrue.

---

---

### Horizon

The REST API server for the Stellar network, operated by the Stellar Development Foundation and third-party providers. Clients query Horizon to fetch account balances, transaction history, and current ledger sequence numbers.

---

### Idempotency Key

A unique, caller-supplied token included in an API or transaction request to guarantee that retrying the same operation does not produce duplicate effects. In the context of this contract's off-chain tooling and REST wrappers, an idempotency key (typically a UUID or content hash) allows a client to safely re-submit a `create_vesting_stream` request after a network timeout without risking a second stream being created. The contract itself enforces idempotency at the on-chain level via the `ScheduleAlreadyExists` guard (error 6) — a second call with the same recipient is rejected regardless of key. Idempotency keys are primarily relevant for the HTTP API layer described in [`docs/api.yaml`](api.yaml).

---

### Instance Storage

A Soroban storage tier for contract-wide configuration values that apply to all instances of a contract. In this project, [`set_min_deposit`](api-reference.md#set_min_deposit) stores the minimum deposit threshold in instance storage using the `DataKey::MinDeposit` key. Instance storage entries have independent [TTL](#ttl-time-to-live) from [persistent storage](#persistent-storage) and are typically used for admin-controlled settings that don't vary per user. See [Soroban storage documentation](https://developers.stellar.org/docs/smart-contracts/storage) for tier comparisons.

---

### Ledger

The fundamental unit of time on the Stellar network. A new ledger closes approximately every 5 seconds. All time parameters in this contract (`cliff_duration`, `total_duration`, `rate`) are expressed in ledgers rather than wall-clock time.

---

### Minimum Deposit

A configurable threshold (default 100 tokens) enforcing that `rate × total_duration` must meet a minimum value when creating a vesting stream via [`create_vesting_stream`](api-reference.md#create_vesting_stream). This prevents dust-level streams that would consume disproportionate storage and ledger resources. The threshold is stored in [instance storage](#instance-storage) and can be updated by the contract admin via [`set_min_deposit`](api-reference.md#set_min_deposit). Violation triggers error code 14 (`DepositBelowMinimum`). See [ADR-0004](adr/README.md) for the rationale behind this constraint.

---

### Milestone Stream

A vesting variant in which token releases are gated on discrete, verifiable project milestones rather than purely on elapsed [ledgers](#ledger). Each milestone (e.g., code audit completion, product launch) unlocks a pre-defined tranche of tokens when an authorised oracle or admin attests that the milestone has been met. Unlike a standard linear drip, a milestone stream's cliff and unlock schedule are event-driven. This feature is tracked in the project roadmap; the current contract implements time-based [accrual](#accrual) only. See [docs/design/multi-token.md](design/multi-token.md) for related design discussions.

---

### Permissionless

A contract function callable by any [address](#address) without [authorization](#auth--require_auth) requirements. [`drain_expired_stream`](api-reference.md#drain_expired_stream) is permissionless: after a stream expires and the [drain delay](#drain-delay) elapses, **any user** can trigger cleanup to return unclaimed tokens to the [sponsor](#sponsor). This design allows the network community to perform housekeeping, reducing the contract's storage footprint and freeing locked tokens. Permissionless functions still validate business logic (e.g., delay expiration) but don't require the caller to prove identity or ownership.

---

### Persistent Storage

A Soroban storage tier whose entries survive across ledger closings indefinitely, subject to [TTL](#ttl-time-to-live) rent. This contract stores each `VestingSchedule` in persistent storage and bumps the TTL on every read and write.

---

### Protocol Fee

A percentage of the total stream [deposit](#deposit) charged at stream creation and transferred to a designated fee-collection address. Fees are expressed in **basis points** (bps), where 1 bps = 0.01%. For example, a 50 bps fee on a 10,000-token deposit retains 9,950 tokens for vesting and routes 50 tokens to the fee recipient. The fee rate and collection address are set by the contract [admin](#admin) via [`set_protocol_fee`](api-reference.md#set_protocol_fee) and stored in [instance storage](#instance-storage). A fee of 0 bps (the default) disables the mechanism entirely. Protocol fees are deducted before the [minimum deposit](#minimum-deposit) check so that the threshold applies to the net vesting amount.

---

### Rate

The number of tokens that accrue per [ledger](#ledger), specified as `rate: i128` in `create_vesting_stream`. Must be greater than zero. Multiply by `total_duration` to get the total [deposit](#deposit).

---

### Recipient

The beneficiary `Address` of a vesting stream. The recipient can call `claim_vested` to withdraw accrued tokens after the cliff, and is the key used to look up a `VestingSchedule` in storage.

---

### SAC (Stellar Asset Contract)

A Soroban smart contract that wraps a classic Stellar asset and exposes it via the standard token interface. The `token` parameter in `create_vesting_stream` must be a SAC contract address (`C…`).

---

### Schema Versioning

A forward-compatibility mechanism where each [`VestingSchedule`](api-reference.md#vestingschedule) struct includes a `version: u32` field indicating the schema generation. Schedules created before this field was introduced have an implicit `version = 0` (XDR default). Current schedules use `version = 1`. The [`migrate_schedule`](api-reference.md#migrate_schedule) function upgrades legacy entries in-place. This pattern allows the contract to evolve its storage schema without breaking existing streams, supporting progressive data migrations during upgrades. See [types.rs](../src/types.rs) for version-specific field interpretations.

---

### Soroban

The smart-contract platform on the Stellar network. Contracts are compiled to [WebAssembly (WASM)](#wasm-webassembly) and executed in a deterministic sandbox. This project is a Soroban contract.

---

### Sponsor

The `Address` that creates a vesting stream and deposits the full token allocation upfront. The sponsor must sign `create_vesting_stream` and `cancel_stream`. Only the original sponsor can cancel a stream.

---

### `start_ledger`

The absolute ledger sequence number recorded at stream creation (`env.ledger().sequence()`). Token accrual begins from this ledger, but claims are blocked until [`cliff_ledger`](#cliff_ledger).

---

### Stellar CLI (`stellar`)

The official command-line interface for interacting with the Stellar network and deploying Soroban contracts. Used in the [Quick Start](../README.md#quick-start) and invoke scripts.

---

### Stellar Network

A decentralized payment and smart-contract network. Validators reach consensus via the Stellar Consensus Protocol (SCP) and close a new [ledger](#ledger) roughly every 5 seconds.

---

### Stream Statistics

Consolidated metrics for a vesting stream returned by [`get_stats`](api-reference.md#get_stats). Includes `total_deposited` (initial allocation), `total_claimed` (tokens already transferred to [recipient](#recipient)), `remaining` (tokens still in [vault](#vault)), and `claimable_now` (tokens claimable at the current [ledger](#ledger)). The contract maintains the mathematical invariant `total_deposited == total_claimed + remaining` and `claimable_now <= remaining`. These fields provide a complete snapshot for UI dashboards without requiring off-chain event indexing. See [`StreamStats`](api-reference.md#streamstats) type definition.

---

### Stroops

The smallest unit of XLM (Stellar's native asset) and XLM-based SAC tokens. One XLM equals 10,000,000 stroops (7 decimal places). All token amounts in this contract—[`rate`](#rate), [`total_deposit`](#deposit), [`claimable_amount`](api-reference.md#claimable_amount)—are denominated in the token's base unit (stroops for XLM, or the equivalent smallest unit for other assets). When creating a stream with `rate = 10`, that means 10 stroops per [ledger](#ledger), not 10 whole XLM. Always multiply by `10^decimals` when displaying human-readable amounts in UIs.

---

### `total_duration`

The total length of the vesting stream in [ledgers](#ledger), passed as a `u32` to `create_vesting_stream`. Must be strictly greater than `cliff_duration`. Determines the [`end_ledger`](#end_ledger) and the total [deposit](#deposit).

---

### TTL (Time-to-Live)

A rent mechanism in Soroban persistent storage. Each entry has a TTL expressed in ledgers; if not refreshed, the entry expires and is deleted. This contract bumps TTL to ~60 days (~1,036,800 ledgers) on every read and write to keep active streams alive.

---

### Upgrade

The process of replacing a deployed contract's [WASM](#wasm-webassembly) code with a new version while preserving on-chain storage. Performed via [`upgrade`](api-reference.md#upgrade), which requires [admin](#admin) authorization and the SHA-256 hash ([`BytesN<32>`](#bytesn)) of the new WASM binary. The Stellar CLI workflow: `stellar contract install` (uploads WASM, returns hash) → `stellar contract invoke ... upgrade` (atomically updates the contract). Storage entries (like [`VestingSchedule`](api-reference.md#vestingschedule) structs) survive upgrades if the new code maintains schema compatibility. Use [`migrate_schedule`](api-reference.md#migrate_schedule) to adapt old schemas after breaking changes.

---

### Vault

The contract's internal token balance — the tokens held by the contract address itself after the sponsor's upfront deposit. Tokens are released from the vault to the recipient on each `claim_vested` call.

---

### Variable Rate

A stream configuration in which the [rate](#rate) (tokens per [ledger](#ledger)) changes over the lifetime of the stream, rather than remaining constant. A variable-rate schedule is typically expressed as a piecewise function: for example, `rate₁` tokens/ledger from `start_ledger` to a breakpoint, then `rate₂` tokens/ledger from the breakpoint to `end_ledger`. The total [deposit](#deposit) equals the sum of each segment: `(rate₁ × segment₁_duration) + (rate₂ × segment₂_duration)`. [Accrual](#accrual) and [catch-up claim](#catch-up-claim) logic must evaluate the correct rate segment for the current ledger. The current contract implements a single constant rate only; variable-rate support is a planned extension. See [ADR-0002](adr/0002-i128-rate-representation.md) for the rate representation rationale.

---

### VestingSchedule

The core data struct stored in [persistent storage](#persistent-storage) for each recipient. Contains `sponsor`, `token`, `rate`, `start_ledger`, `cliff_ledger`, `end_ledger`, and `claimed` (total tokens already transferred).

---

### WASM (WebAssembly)

A portable binary instruction format. Soroban contracts are compiled from Rust to WASM (`wasm32-unknown-unknown` target) before deployment. The compiled `.wasm` file is what gets uploaded on-chain.

---

### XDR (External Data Representation)

The binary serialization format used by the Stellar network for transactions, ledger entries, and contract data. The Stellar CLI and SDKs encode/decode XDR automatically; you encounter it mainly when inspecting raw transaction envelopes or contract state.
