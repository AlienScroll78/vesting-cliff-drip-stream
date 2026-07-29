# Glossary

Domain-specific terms used throughout this project's documentation and code.

---

### Accrual

The continuous accumulation of tokens over time according to the stream's `rate`. Tokens accrue every ledger from `start_ledger` to `end_ledger`, but cannot be claimed until the [cliff](#cliff) is reached.

---

### Address

A Stellar account identifier or contract identifier. In Soroban, both user accounts (`G…`) and contracts (`C…`) are represented as `Address` values and can hold tokens or authorize transactions.

---

### Auth / `require_auth()`

A Soroban SDK call that enforces that a given `Address` has signed the current transaction. This contract requires the sponsor to authorize `create_vesting_stream` and `cancel_stream`, and the recipient to authorize `claim_vested`.

---

### Catch-up Claim

The lump-sum transfer made at the first claim after the cliff. Because tokens have been accruing since `start_ledger` but were locked, the recipient receives all accrued tokens in a single transaction the moment the cliff is passed.

---

### Checked Arithmetic

Rust operations (e.g., `checked_mul`, `checked_add`) that return `None` instead of panicking on integer overflow. This contract uses them everywhere to return [`DepositOverflow`](../src/error.rs) rather than trap.

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

### Deposit

The total token amount locked into the contract vault at stream creation, computed as `rate × total_duration`. The sponsor must hold this balance at the time `create_vesting_stream` is called.

---

### Drips / Drip Stream

A token-streaming primitive where tokens flow to a recipient at a constant rate per block or ledger. This project extends the concept with a mandatory [cliff](#cliff) before any tokens are released.

---

### `end_ledger`

The absolute ledger sequence number at which the stream ends, computed as `start_ledger + total_duration`. After this ledger, no further tokens accrue.

---

### Horizon

The REST API server for the Stellar network, operated by the Stellar Development Foundation and third-party providers. Clients query Horizon to fetch account balances, transaction history, and current ledger sequence numbers.

---

### Ledger

The fundamental unit of time on the Stellar network. A new ledger closes approximately every 5 seconds. All time parameters in this contract (`cliff_duration`, `total_duration`, `rate`) are expressed in ledgers rather than wall-clock time.

---

### Persistent Storage

A Soroban storage tier whose entries survive across ledger closings indefinitely, subject to [TTL](#ttl-time-to-live) rent. This contract stores each `VestingSchedule` in persistent storage and bumps the TTL on every read and write.

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

### `total_duration`

The total length of the vesting stream in [ledgers](#ledger), passed as a `u32` to `create_vesting_stream`. Must be strictly greater than `cliff_duration`. Determines the [`end_ledger`](#end_ledger) and the total [deposit](#deposit).

---

### TTL (Time-to-Live)

A rent mechanism in Soroban persistent storage. Each entry has a TTL expressed in ledgers; if not refreshed, the entry expires and is deleted. This contract bumps TTL to ~60 days (~1,036,800 ledgers) on every read and write to keep active streams alive.

---

### Vault

The contract's internal token balance — the tokens held by the contract address itself after the sponsor's upfront deposit. Tokens are released from the vault to the recipient on each `claim_vested` call.

---

### VestingSchedule

The core data struct stored in [persistent storage](#persistent-storage) for each recipient. Contains `sponsor`, `token`, `rate`, `start_ledger`, `cliff_ledger`, `end_ledger`, and `claimed` (total tokens already transferred).

---

### WASM (WebAssembly)

A portable binary instruction format. Soroban contracts are compiled from Rust to WASM (`wasm32-unknown-unknown` target) before deployment. The compiled `.wasm` file is what gets uploaded on-chain.

---

### XDR (External Data Representation)

The binary serialization format used by the Stellar network for transactions, ledger entries, and contract data. The Stellar CLI and SDKs encode/decode XDR automatically; you encounter it mainly when inspecting raw transaction envelopes or contract state.
