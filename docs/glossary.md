# Glossary

Domain-specific terms used throughout this project's documentation and code.
Terms are ordered alphabetically for quick reference.

Each entry links to related terms within this file and, where applicable, to the
relevant source file or documentation page. To add a new term, follow the
[contributing guide](../CONTRIBUTING.md) and open a PR using the standard
template.

---

### Accrual

The continuous accumulation of tokens over time according to the stream's
[`rate`](#rate). Tokens accrue every ledger from [`start_ledger`](#start_ledger)
to [`end_ledger`](#end_ledger), but cannot be claimed until the
[cliff](#cliff) is reached. Accrual is computed lazily on each
[`claim_vested`](api-reference.md#claim_vested) call rather than stored
incrementally.

**Related:** [Rate](#rate), [Cliff](#cliff), [Catch-up Claim](#catch-up-claim)

---

### Address

A Stellar account identifier or contract identifier. In Soroban, both user
accounts (`G…`) and contracts (`C…`) are represented as `Address` values and
can hold tokens or authorize transactions. Passed as parameters to all contract
entry points; the runtime validates the format before execution begins.

**Related:** [Soroban](#soroban), [Auth / `require_auth()`](#auth--require_auth)

---

### Admin

The privileged [address](#address) with authority to perform sensitive contract
operations: [`upgrade`](api-reference.md#upgrade) (deploy new WASM),
[`transfer_admin`](api-reference.md#transfer_admin) (delegate authority),
[`set_min_deposit`](api-reference.md#set_min_deposit) (configure thresholds),
and [`migrate_schedule`](api-reference.md#migrate_schedule) (update legacy
schemas). Set once via [`initialize`](api-reference.md#initialize) and stored
in [instance storage](#instance-storage). Unlike [sponsor](#sponsor), the admin
does not fund streams and cannot cancel or claim on behalf of users.
Unauthorized admin operations return error code 21 (`Unauthorized`).

**Related:** [Sponsor](#sponsor), [Instance Storage](#instance-storage),
[Auth / `require_auth()`](#auth--require_auth)

---

### Allowlist

An optional on-chain registry of [addresses](#address) permitted to receive
vesting streams. When enabled, [`create_vesting_stream`](api-reference.md#create_vesting_stream)
checks that the `recipient` address appears in the allowlist before accepting
the stream; unlisted recipients are rejected with error code 14
(`RecipientNotAllowed`). The allowlist is managed by the contract [admin](#admin)
and stored in [instance storage](#instance-storage). By default the allowlist
feature is disabled and any valid recipient address is accepted. See
[`set_allowlist`](api-reference.md#set_allowlist) and
[`get_allowlist`](api-reference.md#get_allowlist) for management functions.

**Related:** [Recipient](#recipient), [Admin](#admin),
[Instance Storage](#instance-storage)

---

### Auth / `require_auth()`

A Soroban SDK call that enforces that a given `Address` has signed the current
transaction. Without this guard an attacker could invoke contract functions on
behalf of any account. This contract requires:

- [Sponsor](#sponsor) authorization on `create_vesting_stream` and
  `cancel_stream`.
- [Recipient](#recipient) authorization on `claim_vested`.
- [Admin](#admin) authorization on `upgrade`, `set_min_deposit`, and
  `initialize`.

The [`drain_expired_stream`](api-reference.md#drain_expired_stream) function is
[permissionless](#permissionless) and requires no authorization.

**Related:** [Permissionless](#permissionless), [Sponsor](#sponsor),
[Recipient](#recipient), [Admin](#admin)

---

### Authorization

See [Auth / `require_auth()`](#auth--require_auth).

---

### Basis Points (bps)

A unit of measure equal to one hundredth of a percentage point (0.01%). Used
throughout this contract to express the [protocol fee](#protocol-fee) and the
maximum [cliff](#cliff) ratio as integer values, avoiding floating-point
arithmetic on-chain. Conversion: `bps / 10 000 = percentage`. Examples:

| bps | Percentage |
|-----|-----------|
| 1 | 0.01% |
| 50 | 0.5% |
| 500 | 5.0% |
| 5 000 | 50% |
| 10 000 | 100% |

The maximum allowable `fee_bps` is 500 (5%); values above this return error
code 4 (`InvalidRate`). The default maximum cliff ratio is 5 000 bps (50%).
See `MAX_FEE_BPS` in [`contract.rs`](../src/contract.rs).

**Related:** [Protocol Fee](#protocol-fee), [Cliff](#cliff)

---

### BytesN

A Soroban SDK type representing a fixed-length byte array. `BytesN<32>` is
commonly used for cryptographic hashes like WASM contract hashes (SHA-256).
When calling [`upgrade`](api-reference.md#upgrade), the `new_wasm_hash`
parameter must be a `BytesN<32>` value obtained from `stellar contract install`.
The Stellar CLI automatically handles encoding; raw SDK users must construct
from a `[u8; 32]` array. See the
[Soroban SDK documentation](https://docs.rs/soroban-sdk/) for type conversions.

**Related:** [WASM (WebAssembly)](#wasm-webassembly), [Upgrade](#upgrade)

---

### Catch-up Claim

The lump-sum transfer made at the first claim after the cliff. Because tokens
have been [accruing](#accrual) since [`start_ledger`](#start_ledger) but were
locked by the [cliff](#cliff), the recipient receives all accrued tokens in a
single transaction the moment the cliff is passed. Subsequent claims release
only tokens accrued since the previous claim.

**Related:** [Cliff](#cliff), [Accrual](#accrual), [Recipient](#recipient)

---

### Checked Arithmetic

Rust operations (e.g., `checked_mul`, `checked_add`) that return `None` instead
of panicking on integer overflow. This contract uses them everywhere to
return [`DepositOverflow`](#depositoverflow) rather than trap the transaction.
See [ADR-0006](adr/0006-checked-arithmetic-strategy.md) for the full strategy.

**Related:** [DepositOverflow](#depositoverflow), [Overflow](#overflow)

---

### Clawback

A compliance mechanism allowing the original [sponsor](#sponsor) to recover all
remaining tokens from a vesting stream, regardless of [cliff](#cliff) status.
Only available on tokens that support the SAC (Stellar Asset Contract) clawback
flag; attempting clawback on unsupported tokens returns error code 26
(`ClawbackNotSupported`). Used for regulatory compliance scenarios such as AML
violations, sanctions list matches, or court orders. Invoked via
[`clawback_stream`](api-reference.md#clawback_stream) with a mandatory reason
string (max 256 chars) for audit trails. Emits a `vc_claw` event with the
reason field for off-chain compliance monitoring.

**Related:** [SAC (Stellar Asset Contract)](#sac-stellar-asset-contract),
[Sponsor](#sponsor), [Compliance](#compliance)

---

### Cliff

A mandatory waiting period before any tokens can be claimed. Defined by
`cliff_duration` (in [ledgers](#ledger)) at stream creation. No tokens are
claimable before `cliff_ledger = start_ledger + cliff_duration`, even though
[accrual](#accrual) begins immediately at `start_ledger`. After the cliff is
reached, a [catch-up claim](#catch-up-claim) releases all accrued tokens at
once.

**Related:** [`cliff_duration`](#cliff_duration), [`cliff_ledger`](#cliff_ledger),
[Catch-up Claim](#catch-up-claim), [Accrual](#accrual)

---

### `cliff_duration`

The number of [ledgers](#ledger) from [`start_ledger`](#start_ledger) until the
cliff is reached. Passed as a `u32` to `create_vesting_stream`. Must be
strictly less than `total_duration` (violation returns error code 3,
`InvalidDuration`) and must be greater than zero (violation returns error code
12, `InvalidCliffDuration`). The default maximum allowed cliff ratio is 50% of
`total_duration`; this is configurable via `set_max_cliff_ratio`.

**Related:** [Cliff](#cliff), [`cliff_ledger`](#cliff_ledger),
[`total_duration`](#total_duration)

---

### `cliff_ledger`

The absolute ledger sequence number at which the cliff occurs, computed as
`start_ledger + cliff_duration`. Claims before this ledger fail with error
code 2 (`CliffNotReached`). Stored in [`VestingSchedule`](#vestingschedule)
and checked on every `claim_vested` call.

**Related:** [Cliff](#cliff), [`cliff_duration`](#cliff_duration),
[`start_ledger`](#start_ledger)

---

### Compliance

Regulatory requirements that may necessitate recovering vested tokens from a
stream, typically for Anti-Money Laundering (AML), sanctions enforcement, or
court orders. The contract provides
[`clawback_stream`](api-reference.md#clawback_stream) for immediate token
recovery on [clawback](#clawback)-enabled assets, requiring a mandatory
`reason` string (max 256 chars) for audit trails. Compliance actions bypass
normal [cliff](#cliff) and [accrual](#accrual) rules, transferring all
remaining [vault](#vault) tokens directly to the [sponsor](#sponsor). Emits a
`vc_claw` event with the reason field for off-chain compliance monitoring.

**Related:** [Clawback](#clawback), [SAC (Stellar Asset Contract)](#sac-stellar-asset-contract)

---

### Contract ID

A unique identifier for a deployed Soroban smart contract on the Stellar
network. Contract IDs use the `C…` Strkey encoding (56 characters starting with
`C`) and are deterministically derived from the deployer address and a salt at
deploy time. The contract ID is used as the `token` parameter in
`create_vesting_stream` (for the SAC token address) and as the target address
when invoking contract functions via the Stellar CLI or SDK. Once deployed, a
contract's ID is permanent; upgrades preserve the same ID while replacing the
underlying WASM code.

**Related:** [Soroban](#soroban), [WASM (WebAssembly)](#wasm-webassembly),
[Upgrade](#upgrade), [SAC (Stellar Asset Contract)](#sac-stellar-asset-contract)

---

### Deposit

The total token amount locked into the contract [vault](#vault) at stream
creation, computed as `rate × total_duration`. The [sponsor](#sponsor) must
hold this balance at the time `create_vesting_stream` is called. The deposit
must be at or above the [minimum deposit](#minimum-deposit) threshold; violation
returns error code 22 (`DepositBelowMinimum`). If arithmetic overflows an
`i128`, error code 5 (`DepositOverflow`) is returned.

**Related:** [Rate](#rate), [`total_duration`](#total_duration), [Vault](#vault),
[Minimum Deposit](#minimum-deposit), [DepositOverflow](#depositoverflow)

---

### DepositOverflow

Error code 5. Returned when `rate × total_duration` exceeds `i128::MAX` during
stream creation, making it impossible to safely compute the total deposit.
Prevented by using [checked arithmetic](#checked-arithmetic) throughout. The
maximum valid deposit rate for a given duration is `i128::MAX / total_duration`;
one unit above that triggers this error. See
[ADR-0006](adr/0006-checked-arithmetic-strategy.md) for overflow handling
strategy.

**Related:** [Checked Arithmetic](#checked-arithmetic), [Overflow](#overflow),
[Deposit](#deposit)

---

### Drain Delay

A mandatory waiting period of approximately 1 year (~3,153,600 [ledgers](#ledger),
defined as `DRAIN_DELAY_LEDGERS` in [`contract.rs`](../src/contract.rs)) after a
stream's [`end_ledger`](#end_ledger) before the
[`drain_expired_stream`](api-reference.md#drain_expired_stream) function can be
called. This safety window prevents abuse by giving [recipients](#recipient)
ample time to claim their vested tokens before the [sponsor](#sponsor) can
recover unclaimed funds. The delay is checked in ledger-time, not wall-clock
time, to ensure deterministic contract behavior. Calling too early returns error
code 10 (`DrainDelayNotExpired`).

**Related:** [Drain](#drain), [`end_ledger`](#end_ledger),
[Recipient](#recipient), [Sponsor](#sponsor)

---

### Drain

The process of recovering unclaimed tokens from a fully expired stream back to
the original [sponsor](#sponsor). Performed via
[`drain_expired_stream`](api-reference.md#drain_expired_stream), which is
[permissionless](#permissionless) — any address can trigger it after the
[drain delay](#drain-delay) (~1 year after `end_ledger`) has elapsed. Draining
emits a `vc_drain` event containing the caller, sponsor, token, and recovered
amount. This mechanism prevents tokens from being permanently locked in the
contract when a recipient never claims and their keys may be lost.

**Related:** [Drain Delay](#drain-delay), [Permissionless](#permissionless),
[Vault](#vault), [Sponsor](#sponsor)

---

### Drips / Drip Stream

A token-streaming primitive where tokens flow to a recipient at a constant rate
per block or [ledger](#ledger). This project extends the concept with a
mandatory [cliff](#cliff) before any tokens are released. See the
[comparison guide](comparison.md) for a detailed feature table vs. standard
Drips implementations.

**Related:** [Stream](#stream), [Rate](#rate), [Cliff](#cliff)

---

### Dust

A fractional token remainder too small to be economically meaningful —
typically a sub-stroop or single-unit balance left in the [vault](#vault) after
all full-ledger accruals have been claimed. Dust arises from integer division
when `rate × elapsed_ledgers` does not divide evenly over the stream's lifetime.
The contract leaves dust in the vault and returns it to the [sponsor](#sponsor)
on cancellation or via [`drain_expired_stream`](api-reference.md#drain_expired_stream)
after the [drain delay](#drain-delay) elapses. The [minimum deposit](#minimum-deposit)
threshold prevents streams so small that the entire deposit would be considered
dust.

**Related:** [Vault](#vault), [Minimum Deposit](#minimum-deposit),
[Drain](#drain), [Stroops](#stroops)

---

### Emergency Drain

A sponsor-initiated recovery mechanism
([`emergency_drain`](api-reference.md#emergency_drain)) for reclaiming tokens
from an expired stream when the [recipient](#recipient)'s keys are permanently
lost. Only callable after [`end_ledger`](#end_ledger) + [drain delay](#drain-delay)
(~1 year) have elapsed. This balances two risks: preventing indefinite token
lockup (if recipient keys are lost) versus protecting recipients from premature
sponsor clawback. Unlike [`clawback_stream`](api-reference.md#clawback_stream),
which is instantaneous and compliance-driven, emergency drain enforces a long
safety window to give recipients time to claim. Returns error code 10
(`DrainDelayNotExpired`) if called too early.

**Related:** [Drain](#drain), [Drain Delay](#drain-delay), [Clawback](#clawback)

---

### `end_ledger`

The absolute ledger sequence number at which the stream ends, computed as
`start_ledger + total_duration`. After this ledger, no further tokens accrue.
Stored in [`VestingSchedule`](#vestingschedule). Once `end_ledger` is reached,
the stream enters the `Expired` [stream status](#stream-status).

**Related:** [`start_ledger`](#start_ledger), [`total_duration`](#total_duration),
[Stream Status](#stream-status)

---

### Horizon

The REST API server for the Stellar network, operated by the Stellar
Development Foundation and third-party providers. Clients query Horizon to
fetch account balances, transaction history, and current ledger sequence
numbers. The backend event indexer polls Horizon to detect and persist on-chain
events emitted by the vesting contract. See
[`horizonClient.ts`](../backend/src/horizonClient.ts) for the backend
integration.

**Related:** [RPC](#rpc-soroban-rpc), [Ledger](#ledger),
[Stellar Network](#stellar-network)

---

### Idempotency Key

A unique, caller-supplied token included in an API or transaction request to
guarantee that retrying the same operation does not produce duplicate effects.
The contract itself enforces idempotency at the on-chain level via the
`ScheduleAlreadyExists` guard (error 6) — a second call with the same recipient
is rejected regardless of any key. Idempotency keys are primarily relevant for
the HTTP API layer described in [`docs/api.yaml`](api.yaml), where a client may
safely re-submit a `create_vesting_stream` request after a network timeout.

**Related:** [Stream](#stream), [Sponsor](#sponsor)

---

### Instance Storage

A Soroban storage tier for contract-wide configuration values that apply to all
instances of a contract. In this project, admin settings (`Admin`, `FeeBps`,
`Treasury`, `MinDeposit`, `ConfigMaxCliffRatio`, `ConfigMinRate`) are stored in
instance storage using the `DataKey` variants of the same name. Instance storage
entries have independent [TTL](#ttl-time-to-live) from
[persistent storage](#persistent-storage) and are typically used for
admin-controlled settings that don't vary per user. See
[Soroban storage documentation](https://developers.stellar.org/docs/smart-contracts/storage)
for tier comparisons and
[`storage.rs`](../src/storage.rs) for TTL bump helpers.

**Related:** [Persistent Storage](#persistent-storage), [TTL (Time-to-Live)](#ttl-time-to-live),
[Admin](#admin)

---

### Ledger

The fundamental unit of time on the Stellar network. A new ledger closes
approximately every 5 seconds. All time parameters in this contract
(`cliff_duration`, `total_duration`, [`rate`](#rate)) are expressed in ledgers
rather than wall-clock time. The current ledger sequence number is accessed
on-chain via `env.ledger().sequence()` and is used to compute the
[`start_ledger`](#start_ledger), [`cliff_ledger`](#cliff_ledger), and
[`end_ledger`](#end_ledger) of every stream.

**Related:** [`start_ledger`](#start_ledger), [`cliff_ledger`](#cliff_ledger),
[`end_ledger`](#end_ledger), [Stellar Network](#stellar-network)

---

### Metadata

An optional free-form string field (max 256 UTF-8 bytes) attached to a vesting
stream at creation via the `metadata` parameter of `create_vesting_stream`.
Intended for off-chain labels such as grant identifiers, project names, or
compliance notes. Stored in [`VestingSchedule`](#vestingschedule) as
`Option<String>`. Strings exceeding 256 bytes return error code 20
(`MetadataTooLong`). Metadata is included in the `StreamCreated` event for
off-chain indexing but is not used in any on-chain computation.

**Related:** [VestingSchedule](#vestingschedule), [Stream](#stream)

---

### Minimum Deposit

A configurable threshold (default 100 tokens, stored as `DEFAULT_MIN_DEPOSIT`
in [`storage.rs`](../src/storage.rs)) enforcing that `rate × total_duration`
must meet a minimum value when creating a vesting stream. This prevents
dust-level streams that would consume disproportionate storage and ledger
resources. The threshold is stored in [instance storage](#instance-storage) and
can be updated by the contract [admin](#admin) via
[`set_min_deposit`](api-reference.md#set_min_deposit). Violation triggers error
code 22 (`DepositBelowMinimum`).

**Related:** [Deposit](#deposit), [Dust](#dust), [Admin](#admin),
[Instance Storage](#instance-storage)

---

### Milestone Stream

A vesting variant in which token releases are gated on discrete, verifiable
project milestones rather than purely on elapsed [ledgers](#ledger). Each
milestone unlocks a pre-defined percentage of tokens (expressed in
[basis points](#basis-points-bps)) when an authorized oracle or admin attests
the milestone has been met. The `MilestoneSchedule` type in
[`types.rs`](../src/types.rs) stores a `Vec<Milestone>` of `(ledger, bps_unlock)`
pairs alongside a linear drip rate for post-milestone streaming. Unlike a
standard linear drip, a milestone stream's unlock schedule is event-driven.

**Related:** [VestingSchedule](#vestingschedule), [Basis Points (bps)](#basis-points-bps),
[Stream](#stream)

---

### Multi-Token Stream

A vesting stream that simultaneously vests multiple [SAC](#sac-stellar-asset-contract)
tokens to the same recipient at independent rates. Stored as a
`MultiTokenSchedule` in [`types.rs`](../src/types.rs), which holds a list of
`TokenAllocation` entries — each pairing a token address with a per-ledger rate.
One persistent storage entry per `(recipient, token)` pair is created, keeping
entry sizes bounded and [TTL](#ttl-time-to-live) management per-entry (see
[ADR-0008](adr/0008-multi-token-storage.md)).

**Related:** [SAC (Stellar Asset Contract)](#sac-stellar-asset-contract),
[Persistent Storage](#persistent-storage), [Rate](#rate)

---

### Overflow

An arithmetic condition where the result of a computation exceeds the
representable range of the integer type. In this contract, all multiplications
and additions involving token amounts use [checked arithmetic](#checked-arithmetic)
to detect overflow before it occurs. The most common overflow scenario is
computing `rate × total_duration` when either value is very large; this produces
error code 5 ([`DepositOverflow`](#depositoverflow)). The maximum safe rate for
a given duration is `i128::MAX / total_duration`.

**Related:** [Checked Arithmetic](#checked-arithmetic),
[DepositOverflow](#depositoverflow), [Rate](#rate)

---

### Pause / Resume

A mechanism allowing the [sponsor](#sponsor) to temporarily halt token
[accrual](#accrual) for a stream without cancelling it. When paused, the
`paused_at_ledger` field in [`VestingSchedule`](#vestingschedule) records the
ledger at which accrual stopped. The `accumulated_pause_ledgers` counter tracks
the total time spent paused, which is subtracted from accrual calculations to
ensure the recipient's entitlement is preserved. Claiming from a paused stream
returns error code 15 (`StreamPaused`). The stream resumes from where it left
off when the sponsor calls `resume_stream`.

**Related:** [Accrual](#accrual), [Sponsor](#sponsor),
[VestingSchedule](#vestingschedule), [Stream Status](#stream-status)

---

### Permissionless

A contract function callable by any [address](#address) without
[authorization](#auth--require_auth) requirements.
[`drain_expired_stream`](api-reference.md#drain_expired_stream) is
permissionless: after a stream expires and the [drain delay](#drain-delay)
elapses, **any caller** can trigger cleanup to return unclaimed tokens to the
[sponsor](#sponsor). This design allows community housekeeping, reducing the
contract's storage footprint and freeing locked tokens. Permissionless functions
still validate business logic (e.g., delay expiration) but don't require the
caller to prove identity or ownership.

**Related:** [Drain](#drain), [Drain Delay](#drain-delay),
[Auth / `require_auth()`](#auth--require_auth)

---

### Persistent Storage

A Soroban storage tier whose entries survive across ledger closings
indefinitely, subject to [TTL](#ttl-time-to-live) rent. This contract stores
each [`VestingSchedule`](#vestingschedule) (and variable-rate / milestone
variants) in persistent storage, keyed by `DataKey::Schedule(recipient)`.
The TTL is bumped to `end_ledger + TTL_BUFFER_LEDGERS` on every read and write
to ensure active streams are never evicted. See [`storage.rs`](../src/storage.rs)
and [ADR-0005](adr/0005-ttl-persistent-storage-strategy.md) for the TTL strategy.

**Related:** [TTL (Time-to-Live)](#ttl-time-to-live),
[Instance Storage](#instance-storage), [VestingSchedule](#vestingschedule)

---

### Protocol Fee

A percentage of the total stream [deposit](#deposit) charged at stream creation
and transferred to a designated treasury address. Fees are expressed in
[basis points (bps)](#basis-points-bps), where 1 bps = 0.01%. For example, a
50 bps fee on a 10,000-token deposit routes 50 tokens to the treasury and
retains 9,950 for vesting. The fee rate and collection address are set by the
contract [admin](#admin) via [`set_protocol_fee`](api-reference.md#set_protocol_fee)
and stored in [instance storage](#instance-storage). A fee of 0 bps (the
default) disables the mechanism entirely. Protocol fees are deducted before the
[minimum deposit](#minimum-deposit) check so that the threshold applies to the
net vesting amount. The maximum fee is 500 bps (5%).

**Related:** [Basis Points (bps)](#basis-points-bps), [Deposit](#deposit),
[Admin](#admin), [Instance Storage](#instance-storage)

---

### Rate

The number of tokens that [accrue](#accrual) per [ledger](#ledger), specified
as `rate_per_ledger: i128` in `create_vesting_stream`. Must be greater than
zero (violation returns error code 4, `InvalidRate`) and at or above the
configured minimum rate (`ConfigMinRate`, default 1). Multiply by
`total_duration` to get the total [deposit](#deposit). Because Stellar tokens
have 7 decimal places, a `rate` of 1 represents one stroop per ledger (~0.0000001
of a standard token).

**Related:** [Accrual](#accrual), [Deposit](#deposit), [Ledger](#ledger),
[Stroops](#stroops), [Overflow](#overflow)

---

### Recipient

The beneficiary `Address` of a vesting stream. The recipient can call
`claim_vested` to withdraw accrued tokens after the [cliff](#cliff), and is the
primary storage key used to look up a [`VestingSchedule`](#vestingschedule).
The recipient must authorize `claim_vested`. The recipient and [sponsor](#sponsor)
must be distinct addresses; using the same address for both returns error code
11 (`InvalidRecipient`).

**Related:** [Sponsor](#sponsor), [VestingSchedule](#vestingschedule),
[Cliff](#cliff), [Auth / `require_auth()`](#auth--require_auth)

---

### Reentrancy Lock

A temporary flag stored in [instance storage](#instance-storage)
(`DataKey::Lock`) that is set before any outbound token transfer and cleared
immediately after. This provides defense-in-depth against cross-contract
re-entrant calls (see issue #13): if a malicious token contract attempts to
call back into the vesting contract during a transfer, the lock flag will be
set and the nested call is blocked. See `acquire_lock` and `release_lock` in
[`storage.rs`](../src/storage.rs).

**Related:** [Instance Storage](#instance-storage),
[SAC (Stellar Asset Contract)](#sac-stellar-asset-contract)

---

### RPC (Soroban RPC)

The JSON-RPC endpoint exposed by Stellar network nodes for submitting
transactions and simulating Soroban contract calls. Unlike [Horizon](#horizon)
(which serves historical and account data), the Soroban RPC is used to:

- **Simulate** a transaction before submission to obtain fee estimates and
  return values without spending XLM.
- **Submit** signed transactions to the network.
- **Query** current contract storage state.

The Stellar CLI (`stellar contract invoke`) uses the Soroban RPC under the hood.
See [Simulation](#simulation) for the pre-submission workflow.

**Related:** [Horizon](#horizon), [Simulation](#simulation),
[Stellar CLI (`stellar`)](#stellar-cli-stellar)

---

### SAC (Stellar Asset Contract)

A Soroban smart contract that wraps a classic Stellar asset and exposes it via
the standard token interface (`transfer`, `balance`, `mint`, etc.). The `token`
parameter in `create_vesting_stream` must be a SAC contract address (`C…`).
SAC tokens may optionally have the `AUTH_CLAWBACK_ENABLED_FLAG` set by the
issuer, which is required for [`clawback_stream`](#clawback). Non-SAC token
addresses return error code 12 (`InvalidToken`).

**Related:** [Clawback](#clawback), [Contract ID](#contract-id),
[Soroban](#soroban)

---

### Schema Versioning

A forward-compatibility mechanism where each [`VestingSchedule`](#vestingschedule)
struct includes a `version: u32` field (starting at 1) indicating the schema
generation. This field is incremented on every mutating operation via
`increment_version()`, returning error code 25 (`VersionOverflow`) at
`u32::MAX`. The [`migrate_schedule`](api-reference.md#migrate_schedule) function
upgrades legacy entries (pre-versioning, implicit `version = 0`) in-place. This
pattern allows the contract to evolve its storage schema across upgrades without
breaking existing streams. See [`types.rs`](../src/types.rs) for version-specific
field interpretations.

**Related:** [VestingSchedule](#vestingschedule), [Upgrade](#upgrade),
[Persistent Storage](#persistent-storage)

---

### Simulation

The process of executing a Soroban contract function call locally against the
current ledger state without broadcasting a transaction. Simulation is performed
via the [Soroban RPC](#rpc-soroban-rpc) `simulateTransaction` endpoint and
returns the estimated fee, footprint (storage keys read/written), and return
value. All Soroban transactions must be simulated before submission to set the
correct authorization and resource usage. The Stellar CLI (`stellar contract
invoke`) handles simulation automatically; SDK integrators must call
`rpc.simulateTransaction()` explicitly. A simulation failure means the
transaction would be rejected if submitted.

**Related:** [RPC (Soroban RPC)](#rpc-soroban-rpc),
[Transaction Envelope](#transaction-envelope),
[Stellar CLI (`stellar`)](#stellar-cli-stellar)

---

### Soroban

The smart-contract platform on the Stellar network. Contracts are compiled to
[WebAssembly (WASM)](#wasm-webassembly) and executed in a deterministic,
metered sandbox. Soroban provides a typed storage API (persistent, instance, and
temporary tiers), a rich SDK for Rust, and a fee model based on computational
resources. This project is a Soroban contract; all entry points are annotated
with `#[contractimpl]`. See the
[Stellar developer documentation](https://developers.stellar.org/docs/smart-contracts)
for the full platform reference.

**Related:** [WASM (WebAssembly)](#wasm-webassembly), [Ledger](#ledger),
[Persistent Storage](#persistent-storage), [Instance Storage](#instance-storage)

---

### Sponsor

The `Address` that creates a vesting stream and deposits the full token
allocation upfront into the contract [vault](#vault). The sponsor must sign
(`require_auth`) both `create_vesting_stream` and `cancel_stream`. Only the
original sponsor can cancel a stream. The sponsor and [recipient](#recipient)
must be distinct addresses; using the same address for both returns error code
11 (`InvalidRecipient`).

**Related:** [Recipient](#recipient), [Vault](#vault),
[Auth / `require_auth()`](#auth--require_auth), [Deposit](#deposit)

---

### `start_ledger`

The absolute ledger sequence number recorded at stream creation
(`env.ledger().sequence()`). Token [accrual](#accrual) begins from this ledger,
but claims are blocked until [`cliff_ledger`](#cliff_ledger). Stored in
[`VestingSchedule`](#vestingschedule).

**Related:** [`cliff_ledger`](#cliff_ledger), [`end_ledger`](#end_ledger),
[Accrual](#accrual)

---

### Stellar CLI (`stellar`)

The official command-line interface for interacting with the Stellar network
and deploying Soroban contracts. Used in the [Quick Start](../README.md#quick-start)
and invoke scripts (`scripts/invoke_create.sh`, `scripts/invoke_claim.sh`,
`scripts/deploy.sh`). Wraps [Soroban RPC](#rpc-soroban-rpc) calls and handles
[simulation](#simulation) and transaction signing automatically.

**Related:** [Soroban](#soroban), [RPC (Soroban RPC)](#rpc-soroban-rpc),
[Simulation](#simulation)

---

### Stellar Network

A decentralized payment and smart-contract network. Validators reach consensus
via the Stellar Consensus Protocol (SCP) and close a new [ledger](#ledger)
roughly every 5 seconds. Stellar supports both classic payment operations and
[Soroban](#soroban) smart contracts. The network has distinct environments:
Mainnet (public), Testnet (funded via Friendbot), and Futurenet (cutting edge).

**Related:** [Ledger](#ledger), [Soroban](#soroban), [Horizon](#horizon)

---

### Stream

A vesting arrangement between a [sponsor](#sponsor) and a [recipient](#recipient)
in which a fixed quantity of tokens is deposited upfront and released
continuously to the recipient over time at a configured [rate](#rate). A stream
is identified on-chain by the recipient's address. Streams progress through
defined lifecycle states tracked by [stream status](#stream-status): `PreCliff`
→ `Active` → `Expired` (or `Cancelled`, `Paused`, `Drained`). See
[`docs/flows.md`](flows.md) for the full lifecycle model.

**Related:** [Sponsor](#sponsor), [Recipient](#recipient), [Rate](#rate),
[Stream Status](#stream-status), [VestingSchedule](#vestingschedule)

---

### Stream Statistics

Consolidated metrics for a vesting stream returned by
[`get_stats`](api-reference.md#get_stats) as a `StreamStats` struct. Includes:

| Field | Description |
|---|---|
| `total_deposited` | Initial token allocation deposited by sponsor |
| `total_claimed` | Tokens already transferred to recipient |
| `remaining` | Tokens still in the vault |
| `claimable_now` | Tokens claimable at the current ledger |

The contract maintains the invariant `total_deposited == total_claimed + remaining`
and `claimable_now <= remaining`. See [`StreamStats`](../src/contract.rs) in the
contract source.

**Related:** [Vault](#vault), [Deposit](#deposit), [Accrual](#accrual)

---

### Stream Status

A typed enum (`StreamStatus` in [`types.rs`](../src/types.rs)) representing the
current lifecycle state of a vesting stream. Returned by the `stream_status`
view function. The possible values are:

| Status | Meaning | Badge colour |
|--------|---------|-------------|
| `PreCliff` | Before `cliff_ledger` — tokens accruing but not claimable | Amber `#F59E0B` |
| `Active` | After cliff, before `end_ledger` — tokens claimable | Blue `#3B82F6` |
| `Expired` | After `end_ledger` but drain delay not yet elapsed | Green `#22C55E` |
| `Cancelled` | Sponsor cancelled the stream | Red `#EF4444` |
| `Paused` | Sponsor paused accrual temporarily | Yellow `#EAB308` |
| `Drained` | All tokens recovered after expiry drain delay | Purple `#A855F7` |
| `NotFound` | No schedule exists for the queried recipient | Grey `#6B7280` |

**Related:** [Stream](#stream), [Cliff](#cliff), [Drain](#drain),
[Pause / Resume](#pause--resume)

---

### Stroops

The smallest unit of XLM (Stellar's native asset) and XLM-based SAC tokens.
One XLM equals 10,000,000 stroops (7 decimal places). All token amounts in
this contract — [`rate`](#rate), [`deposit`](#deposit),
[`claimable_amount`](api-reference.md#claimable_amount) — are denominated in
the token's base unit (stroops for XLM, or the equivalent smallest unit for
other assets). A `rate` of 1 means 1 stroop per ledger (~0.0000001 XLM).
Always multiply by `10^decimals` when displaying human-readable amounts in UIs.

**Related:** [Rate](#rate), [Deposit](#deposit),
[SAC (Stellar Asset Contract)](#sac-stellar-asset-contract)

---

### `total_duration`

The total length of the vesting stream in [ledgers](#ledger), passed as a `u32`
to `create_vesting_stream`. Must be strictly greater than `cliff_duration`
(violation returns error code 3, `InvalidDuration`). Determines the
[`end_ledger`](#end_ledger) and the total [deposit](#deposit) via
`rate × total_duration`.

**Related:** [`cliff_duration`](#cliff_duration), [`end_ledger`](#end_ledger),
[Deposit](#deposit)

---

### Transaction Envelope

The complete, signed binary object submitted to the Stellar network to execute
an operation. A transaction envelope contains the transaction body (source
account, sequence number, operations, fee), one or more signatures from the
authorizing accounts, and — for Soroban — an authorization footprint describing
the storage entries the contract will read or write. The envelope is
[XDR](#xdr-external-data-representation)-encoded. The Stellar CLI and SDKs
construct envelopes automatically; raw integration requires building and signing
via the [XDR](#xdr-external-data-representation) libraries. See the
[Simulation](#simulation) workflow for how footprints are obtained before a
transaction is submitted.

**Related:** [XDR (External Data Representation)](#xdr-external-data-representation),
[Simulation](#simulation), [Auth / `require_auth()`](#auth--require_auth)

---

### TTL (Time-to-Live)

A rent mechanism in Soroban [persistent storage](#persistent-storage). Each
storage entry has a TTL expressed in ledgers; if not refreshed before expiry,
the entry is evicted and its data is lost permanently. This contract bumps TTL
proactively to `end_ledger + TTL_BUFFER_LEDGERS` (approximately 1 year beyond
stream end, capped at the Soroban maximum of ~3,110,400 ledgers) on every read
and write. See [`storage.rs`](../src/storage.rs) for the `ensure_ttl_for_stream`
helper and [ADR-0005](adr/0005-ttl-persistent-storage-strategy.md) for the
design rationale.

**Related:** [Persistent Storage](#persistent-storage),
[Instance Storage](#instance-storage)

---

### Upgrade

The process of replacing a deployed contract's [WASM](#wasm-webassembly) code
with a new version while preserving on-chain storage and the [contract
ID](#contract-id). Performed via [`upgrade`](api-reference.md#upgrade), which
requires [admin](#admin) authorization and the SHA-256 hash
([`BytesN<32>`](#bytesn)) of the new WASM binary uploaded via
`stellar contract install`. Storage entries (like
[`VestingSchedule`](#vestingschedule) structs) survive upgrades if the new code
maintains schema compatibility. Use
[`migrate_schedule`](api-reference.md#migrate_schedule) to adapt old schemas
after breaking changes. See [Schema Versioning](#schema-versioning) for how
version fields enable safe migrations.

**Related:** [WASM (WebAssembly)](#wasm-webassembly), [Admin](#admin),
[Schema Versioning](#schema-versioning), [Contract ID](#contract-id)

---

### Variable Rate

A stream configuration in which the [rate](#rate) (tokens per [ledger](#ledger))
changes over the lifetime of the stream rather than remaining constant. Instead
of a single `rate_per_ledger` value, a variable-rate stream stores a list of
`RateSegment` entries (`end_ledger`, `rate`) in a `VariableRateSchedule` (see
[`types.rs`](../src/types.rs)). The claimable amount at any ledger is computed
by summing each segment: `Σ rate_i × (min(current, end_i) − start_i)`. The
maximum number of segments is 10 (`MAX_SEGMENTS` in
[`contract.rs`](../src/contract.rs)). Variable-rate streams are the primary
source of [dust](#dust) due to integer division across segments. See
[ADR-0002](adr/0002-i128-rate-representation.md) for the rate representation
rationale.

**Related:** [Rate](#rate), [Dust](#dust), [Accrual](#accrual),
[VestingSchedule](#vestingschedule)

---

### Vault

The contract's internal token balance — the tokens held by the contract address
itself after the [sponsor](#sponsor)'s upfront [deposit](#deposit). Tokens are
released from the vault to the [recipient](#recipient) on each `claim_vested`
call, and returned to the sponsor on cancellation or after expiry [drain](#drain).
The contract never holds tokens outside of active streams; all vault balances
correspond to exactly one stream's remaining allocation.

**Related:** [Deposit](#deposit), [Drain](#drain), [Sponsor](#sponsor),
[Recipient](#recipient)

---

### VestingSchedule

The core data struct stored in [persistent storage](#persistent-storage) for
each recipient under `DataKey::Schedule(recipient)`. Defined in
[`types.rs`](../src/types.rs). Key fields:

| Field | Type | Description |
|---|---|---|
| `sponsor` | `Address` | Stream creator |
| `token` | `Address` | SAC token address |
| `rate_per_ledger` | `i128` | Tokens per ledger |
| `start_ledger` | `u32` | Stream start |
| `cliff_ledger` | `u32` | Cliff ledger |
| `end_ledger` | `u32` | Stream end |
| `last_claimed_ledger` | `u32` | Ledger through which tokens have been claimed |
| `total_claimed` | `i128` | Running total tokens transferred |
| `metadata` | `Option<String>` | Optional label (max 256 bytes) |
| `paused_at_ledger` | `Option<u32>` | Set when stream is paused |
| `accumulated_pause_ledgers` | `u32` | Total ledgers spent paused |
| `version` | `u32` | Schema version counter |

**Related:** [Persistent Storage](#persistent-storage),
[Schema Versioning](#schema-versioning), [Stream](#stream)

---

### WASM (WebAssembly)

A portable binary instruction format. Soroban contracts are compiled from Rust
to WASM (`wasm32-unknown-unknown` target) before deployment. The compiled
`.wasm` file is uploaded on-chain via `stellar contract install`, which returns
the SHA-256 hash used in [`upgrade`](#upgrade) calls. The WASM binary is
executed inside the deterministic Soroban sandbox on every contract invocation.
Build with `make build` to produce the optimized `.wasm` output.

**Related:** [Soroban](#soroban), [Upgrade](#upgrade), [BytesN](#bytesn)

---

### XDR (External Data Representation)

The binary serialization format used by the Stellar network for transactions,
ledger entries, and contract data. The Stellar CLI and SDKs encode/decode XDR
automatically; developers encounter it mainly when inspecting raw transaction
envelopes or contract state with tools like `stellar xdr decode`. Soroban
contract types annotated with `#[contracttype]` are automatically XDR-serialized
when stored in persistent storage.

**Related:** [Transaction Envelope](#transaction-envelope),
[Soroban](#soroban), [Persistent Storage](#persistent-storage)
