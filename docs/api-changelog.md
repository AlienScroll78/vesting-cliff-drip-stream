# API Changelog

All notable changes to the Vesting Cliff Drip Stream **contract API** and **backend REST API** are documented here. This file follows the [Keep a Changelog](https://keepachangelog.com/en/1.0.0/) format and adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

This document serves as the primary technical reference for integrators, contract callers, indexers, and client developers.

---

## [Unreleased]

### Added

- **Variable-rate streams (`create_vesting_stream`)** — Optional `segments` parameter defining piecewise emission schedules (`Vec<RateSegment>`).
- **`InvalidSegments` error (code 19)** — Returned when rate segments are empty, out of order, or non-positive.

---

## [2.2.0] — 2026-09-15

### Added

- **`pause_stream(stream_id)`** — Sponsor or admin pause mechanism halts token claims temporarily.
- **`resume_stream(stream_id)`** — Resumes a paused vesting stream.
- **`StreamPaused` error (code 15)** — Returned when `claim_vested` is invoked on a paused stream.
- **`StreamAlreadyPaused` error (code 23)** — Returned when attempting to pause an already-paused stream.
- **`StreamNotPaused` error (code 24)** — Returned when attempting to resume a non-paused stream.

---

## [2.1.0] — 2026-09-01

### Added

- **`drain_expired_stream(caller, recipient)`** — Permissionless cleanup entry-point accessible 1 year (~6,307,200 ledgers) after `end_ledger`. Emits `StreamDrained`.
- **`clawback_stream(sponsor, recipient, stream_id, reason)`** — Compliance clawback entry-point for SAC tokens with clawback flags. Emits `StreamClawedBack`.
- **`DrainDelayNotExpired` error (code 10)** — Returned when `drain_expired_stream` is invoked before the 1-year grace period expires.
- **`ClawbackNotSupported` error (code 26)** — Returned when `clawback_stream` is attempted on a token lacking SAC clawback enablement.

### Changed

- **`cancel_stream`** — Emitted `StreamCancelled` event now includes `sponsor` address alongside `recipient` and `refund_amount`.

---

## [2.0.0] — 2026-07-15 — ⚠️ BREAKING

### Added

- **`initialize(admin)`** — One-time contract initialization entry-point.
- **`set_min_deposit(admin, min_deposit)`** — Configurable floor for stream creation.
- **`batch_create_vesting_streams(streams)`** — Creates up to 20 streams in a single host call.
- **`AlreadyInitialized` error (code 13)** — Returned if `initialize` is called more than once.
- **`BatchTooLarge` error (code 16)** — Returned when batch submission exceeds 20 streams.
- **`RateTooLow` error (code 17)** — Returned when stream deposit arithmetic falls below `min_deposit`.
- **`NotInitialized` error (code 18)** — Returned by mutating calls if initialization has not occurred.
- **`Unauthorized` error (code 21)** — Returned if caller is neither admin nor original sponsor.
- **`DepositBelowMinimum` error (code 22)** — Returned when total deposit is under the configured floor.
- **`VersionOverflow` error (code 25)** — Returned if schedule version counter exceeds `u32::MAX`.

### Changed

- ⚠️ BREAKING: **Mandatory Contract Initialization** — Calling mutating functions before `initialize` returns `NotInitialized` (error code 18).
- ⚠️ BREAKING: **Deposit Floor Validation** — Stream creation fails with `DepositBelowMinimum` (error code 22) or `RateTooLow` (error code 17) if `rate × total_duration < min_deposit`.

### Migration Guide

1. **Deploy & Initialize:**
   Before invoking any vesting stream lifecycle methods on a newly deployed or upgraded contract, call `initialize(admin: Address)`. Verify success by checking that `NotInitialized` (18) is no longer returned.
2. **Handle Initialization Errors:**
   Update client libraries to recognize error code `13` (`AlreadyInitialized`) and `18` (`NotInitialized`).
3. **Audit Deposit Calculations:**
   Query `get_min_deposit()` (default 100 tokens). Ensure client UI enforces `rate * total_duration >= min_deposit` before submitting transactions to avoid `DepositBelowMinimum` (22) rejections.
4. **Batch Stream Limits:**
   If using `batch_create_vesting_streams`, chunk transactions to a maximum of 20 schedules per call to prevent `BatchTooLarge` (16) failures.

---

## [1.2.0] — 2026-07-01

### Added

- **`metadata` field on `VestingSchedule`** — Optional UTF-8 string up to 256 bytes for sponsor stream labels.
- **`MetadataTooLong` error (code 20)** — Returned when label exceeds 256 bytes.
- **`add_allowed_token`, `remove_allowed_token`, `get_allowed_tokens`** — Token allowlist management.
- **`RecipientNotAllowed` error (code 14)** — Returned when token is not allowlisted.
- **`version` counter on `VestingSchedule`** — Increments monotonically with state mutations.
- **`get_min_deposit()`** view function — Returns current deposit floor.
- **`InvalidCliffDuration` error (code 12)** — Returned when `cliff_duration == 0`.
- **`InvalidRecipient` error (code 11)** — Returned when `sponsor == recipient`.

---

## [1.1.0] — 2026-08-28

### Added

#### Backend REST API
- **GET `/health`** — Liveness and uptime check (`{ status, version, uptime }`).
- **GET `/health/horizon`** — Connectivity check to Soroban RPC / Stellar Horizon.
- **GET `/health/horizon/circuit-breaker`** — Circuit-breaker operational state.
- **GET `/api/openapi.json`** — OpenAPI 3.0 specification download.
- **GET `/api/v1/schedules`** — Authenticated paginated stream list.
- **GET `/api/v1/schedules/export`** — CSV/JSON export with date range filters.
- **GET `/api/v1/schedules/sponsor/{sponsor}`** — Sponsor stream lookups.
- **GET `/admin/indexer/status`** — Internal indexer synchronization health.
- **GET `/admin/metrics`** — Prometheus scrapable operational metrics.
- **POST `/api/v1/admin/drain`** — Admin-triggered expiration drain endpoint.
- **GET `/api/v1/metrics`** — Application JSON performance metrics.
- **WebSocket `/ws/claimable`** — Real-time claimable balance stream subscriptions.

### Changed

- REST API version updated to `1.1.0`. All new endpoints maintain backwards compatibility with `1.0.0`.

---

## [1.0.0] — 2026-06-26

Current state and baseline release of the Vesting Cliff Drip Stream Contract and REST API.

### Added

#### Contract Entry-points
- **`create_vesting_stream(env, sponsor, recipient, token, rate, cliff_duration, total_duration) -> Result<u32, VestingError>`** — Creates a stream with upfront token deposit and cliff lockup.
- **`claim_vested(env, recipient, stream_id) -> Result<i128, VestingError>`** — Releases claimable tokens accrued linearly post-cliff.
- **`cancel_stream(env, sponsor, recipient, stream_id) -> Result<(), VestingError>`** — Cancels stream, granting accrued tokens to recipient and returning remainder to sponsor.

#### Contract View Functions
- **`get_schedule(recipient) -> Option<VestingSchedule>`** — Retrieves primary stream details.
- **`get_stream_ids(recipient) -> Vec<u32>`** — Lists all active stream IDs for a beneficiary.
- **`get_schedule_by_id(recipient, stream_id) -> Option<VestingSchedule>`** — Retrieves specific schedule by stream ID.
- **`claimable_amount(recipient) -> i128`** — Computes unlocked tokens available for claim (`0` if cliff not reached).
- **`get_claimable_batch(recipients) -> Vec<(Address, i128)>`** — Batch queries claimable balances.
- **`is_cliff_passed(recipient) -> bool`** — Evaluates if current ledger sequence has reached cliff ledger.

#### Contract Error Codes (1–27)

| Code | Error Name | Description / Trigger Condition |
|:---:|---|---|
| 1 | `ScheduleNotFound` | No active vesting schedule exists for recipient. |
| 2 | `CliffNotReached` | Current ledger sequence is earlier than `cliff_ledger`. |
| 3 | `InvalidDuration` | `total_duration` is less than or equal to `cliff_duration`. |
| 4 | `InvalidRate` | `rate <= 0` or fee basis points exceed maximum allowed (500 bps). |
| 5 | `DepositOverflow` | Arithmetic overflow calculating total deposit (`rate * total_duration`). |
| 6 | `ScheduleAlreadyExists` | Duplicate stream creation conflict for recipient. |
| 7 | `NothingToClaim` | Accrued claimable tokens equal zero at current ledger. |
| 8 | `StreamNotExpired` | Action requires stream completion, but `end_ledger` is in the future. |
| 9 | `TransferFailed` | Stellar Asset Contract token transfer call failed. |
| 10 | `DrainDelayNotExpired` | Permissionless drain delay period has not elapsed. |
| 11 | `InvalidRecipient` | Stream creation rejected because `sponsor == recipient`. |
| 12 | `InvalidCliffDuration` | `cliff_duration` is 0 or exceeds maximum cliff ratio. |
| 13 | `AlreadyInitialized` | `initialize` invoked on an already initialized contract. |
| 14 | `RecipientNotAllowed` | Token or recipient not allowed under configured allowlist. |
| 15 | `StreamPaused` | Mutating operation attempted while stream is paused. |
| 16 | `BatchTooLarge` | Batch parameter length exceeds 20 items. |
| 17 | `RateTooLow` | Deposit rate arithmetic fails to meet minimum total deposit. |
| 18 | `NotInitialized` | Mutating function called before contract was initialized. |
| 19 | `InvalidSegments` | Rate segment array is empty, unordered, or contains non-positive rates. |
| 20 | `MetadataTooLong` | Schedule metadata UTF-8 string exceeds 256 bytes. |
| 21 | `Unauthorized` | Caller lacks required admin or sponsor authority. |
| 22 | `DepositBelowMinimum` | Computed deposit falls below configured minimum threshold. |
| 23 | `StreamAlreadyPaused` | `pause_stream` called on an already paused stream. |
| 24 | `StreamNotPaused` | `resume_stream` called on an unpaused stream. |
| 25 | `VersionOverflow` | Monotonic schedule version counter reached maximum `u32`. |
| 26 | `ClawbackNotSupported` | Token does not have SAC `AUTH_CLAWBACK_ENABLED_FLAG` enabled. |
| 27 | `InvalidToken` | Token contract address fails SAC `try_balance` probe. |

#### Contract Structured Events
- **`StreamCreated`** — Topics: `["StreamCreated", sponsor: Address, recipient: Address]`; Data: `{ stream_id, token, rate, start_ledger, cliff_ledger, end_ledger, total_deposit }`.
- **`StreamClaimed`** — Topics: `["StreamClaimed", recipient: Address]`; Data: `{ stream_id, amount, claimed_at_ledger }`.
- **`StreamCancelled`** — Topics: `["StreamCancelled", sponsor: Address, recipient: Address]`; Data: `{ stream_id, recipient_amount, sponsor_refund }`.

#### Backend REST API Endpoints (v1.0.0)
- **GET `/api/v1/schedules/{recipient}`** — Fetches complete vesting schedule with calculated claimable amounts, cliff progress, and schedule metadata.
