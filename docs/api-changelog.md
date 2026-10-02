# API Changelog

All notable changes to the Vesting Cliff Drip Stream **contract API** and **backend REST API** are
documented here. This file follows the [Keep a Changelog](https://keepachangelog.com/en/1.0.0/)
format and [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

> **CI requirement:** Contributors must update this file whenever they modify `src/contract.rs` or
> any OpenAPI spec file (e.g. `openapi.yaml`, `openapi.json`). Pull requests that touch those files
> without a corresponding changelog entry will be blocked by the `changelog-enforcer` CI check.

---

## [Unreleased]

### Contract API

#### Added

- **Variable-rate streams** — `create_vesting_stream` now accepts an optional `segments` field
  that defines a sequence of per-segment rates, enabling non-linear emission schedules.
- **`InvalidSegments` error (code 19)** — Returned when `segments` is provided but is empty,
  contains out-of-order ledger boundaries, or contains a zero/negative rate in any segment.

---

## [2.2.0] — 2026-09-15

### Contract API

#### Added

- **`pause_stream`** — Admin or original sponsor can pause an active stream, preventing any
  further claims until the stream is resumed. Closes #799 (see ADR-0007).
- **`resume_stream`** — Admin or original sponsor resumes a previously paused stream.
- **`StreamPaused` error (code 15)** — Returned when `claim_vested` is called on a paused stream.
- **`StreamAlreadyPaused` error (code 23)** — Returned when `pause_stream` is called on a stream
  that is already paused.
- **`StreamNotPaused` error (code 24)** — Returned when `resume_stream` is called on a stream
  that is not currently paused.

---

## [2.1.0] — 2026-09-01

### Contract API

#### Added

- **`drain_expired_stream`** — Permissionless cleanup entry-point. Any caller may invoke this
  after `end_ledger + 6,307,200` ledgers (~1 year) have elapsed. Transfers remaining vault tokens
  back to the original sponsor and emits a `StreamDrained` event. Resolves issue #316.
- **`clawback_stream`** — Sponsor compliance clawback that recovers all remaining vault tokens
  regardless of cliff state. Only available on tokens that support the SAC clawback flag.
  Emits `StreamClawedBack` event with a `reason` string (max 256 chars). Resolves issue #317.
- **`DrainDelayNotExpired` error (code 10)** — Returned by `drain_expired_stream` when the
  1-year delay after `end_ledger` has not yet elapsed.
- **`ClawbackNotSupported` error (code 26)** — Returned by `clawback_stream` when the stream
  token does not have the SAC clawback flag enabled.

#### Changed

- **`cancel_stream`** — The `StreamCancelled` on-chain event payload now includes the `sponsor`
  address alongside `recipient` and `refund_amount`. Indexers consuming this event must be updated.

---

## [2.0.0] — 2026-07-15 ⚠ BREAKING

### Contract API

#### Added

- **`initialize`** — New required entry-point that must be called once before any other contract
  function. Stores admin address and initial configuration in instance storage.
- **`set_min_deposit`** — Admin-only function to update the minimum total deposit threshold
  (default 100 tokens).
- **`batch_create_vesting_streams`** — Creates up to 20 streams in a single transaction,
  accepting a vector of stream parameter structs.
- **`AlreadyInitialized` error (code 13)** — Returned if `initialize` is called more than once.
- **`BatchTooLarge` error (code 16)** — Returned by `batch_create_vesting_streams` when the
  input vector exceeds 20 entries.
- **`RateTooLow` error (code 17)** — Returned when `rate × total_duration` is below the
  configured minimum deposit threshold.
- **`NotInitialized` error (code 18)** — Returned by any contract function if `initialize` has
  not yet been called.
- **`Unauthorized` error (code 21)** — Returned when the caller is neither the contract admin
  nor the original sponsor of the stream.
- **`DepositBelowMinimum` error (code 22)** — Returned when the computed total deposit falls
  below the minimum configured by `set_min_deposit`.
- **`VersionOverflow` error (code 25)** — Returned when the internal version counter would
  exceed `u32::MAX`.

#### Breaking Changes

- **`initialize` is now mandatory.** Existing deployments that have not called `initialize` will
  have every function return `NotInitialized (18)`. A migration transaction calling `initialize`
  must be submitted before normal operations can resume.

---

## [1.2.0] — 2026-07-01

### Contract API

#### Added

- **`metadata` field on `VestingSchedule`** — Optional `String` field (max 256 UTF-8 bytes)
  stored with each schedule. Pass `None` to omit.
- **`MetadataTooLong` error (code 20)** — Returned when `metadata` exceeds 256 bytes.
- **Token allowlisting** — Three new entry-points manage a per-contract token allowlist:
  - `add_allowed_token(admin, token)` — Add a token to the allowlist.
  - `remove_allowed_token(admin, token)` — Remove a token from the allowlist.
  - `get_allowed_tokens()` — Return the current allowlist as a vector of addresses.
- **`RecipientNotAllowed` error (code 14)** — Returned when `create_vesting_stream` is called
  with a token not present on the allowlist.
- **Schedule versioning** — `VestingSchedule` now carries a `version: u32` counter that
  increments on each successful `claim_vested` call, enabling clients to detect state changes
  without re-reading full schedule data.
- **`get_min_deposit()` view function** — Returns the current minimum deposit threshold as
  `i128`.
- **`InvalidCliffDuration` error (code 12)** — Returned when `cliff_duration` is zero.
- **`InvalidRecipient` error (code 11)** — Returned when `sponsor` and `recipient` are the
  same address.

---

## [1.1.0] — 2026-08-28

### REST API

#### Added

- **GET `/health`** — Liveness probe. Returns `{ status, version, uptime }`.
- **GET `/health/horizon`** — Horizon connectivity check. Returns `{ status, endpoints }`.
- **GET `/health/horizon/circuit-breaker`** — Circuit breaker state
  (plain text: `closed` / `open` / `half-open`).
- **GET `/api/openapi.json`** — Raw OpenAPI 3.0 spec as JSON.
- **GET `/api/v1/schedules`** — Paginated schedule list for authenticated sponsors. Requires JWT.
- **GET `/api/v1/schedules/export`** — CSV/JSON export of streams. Supports `from`/`to` date
  filtering.
- **GET `/api/v1/schedules/sponsor/{sponsor}`** — Legacy Horizon-based sponsor schedule lookup.
- **GET `/admin/indexer/status`** — Indexer health (admin, Basic Auth, internal only).
- **GET `/admin/metrics`** — Prometheus text metrics (admin, Basic Auth, internal only).
- **POST `/api/v1/admin/drain`** — Drain expired streams with optional dry-run.
- **GET `/api/v1/metrics`** — JSON operational metrics (cache hit rates).
- **WebSocket `/ws/claimable`** — Real-time claimable balance subscription.

#### Changed

- API version bumped from `1.0.0` to `1.1.0`.
- OpenAPI spec expanded from 1 endpoint (`/api/v1/schedules/{recipient}`) to 13 endpoints.

#### Breaking Changes

None. All new endpoints are additive. The existing `GET /api/v1/schedules/{recipient}` endpoint
is unchanged.

#### Notes

- Admin endpoints (`/admin/*`) are HTTP Basic Auth protected and intended for internal network
  access only — not exposed through public ingress.
- The `/api/v1/schedules` (paginated) endpoint requires a JWT where the `sub` claim matches the
  `sponsor` query parameter, preventing cross-sponsor data access.
- WebSocket protocol: connect, send `{"action":"subscribe","recipient":"G..."}`, receive periodic
  balance updates.

---

## [1.0.0] — 2026-06-26

### Contract API — Initial Release

#### Added

- **`create_vesting_stream`** — Create a new vesting stream. Sponsor deposits the full allocation
  upfront; tokens are locked until `cliff_ledger`.
- **`claim_vested`** — Recipient claims all tokens accrued since `start_ledger` (catch-up at
  cliff) or since the last claim (linear drip thereafter). Returns the amount transferred.
- **`cancel_stream`** — Sponsor cancels an active stream. Post-cliff: recipient keeps accrued
  tokens, sponsor receives the remainder. Pre-cliff: full deposit refunded to sponsor.
- **`get_schedule(recipient)`** view — Returns `Option<VestingSchedule>`.
- **`claimable_amount(recipient)`** view — Returns `i128`; `0` if cliff not yet reached.
- **`is_cliff_passed(recipient)`** view — Returns `bool`.
- **Structured on-chain events:**
  - `StreamCreated` — Emitted on successful stream creation.
  - `StreamClaimed` — Emitted on each successful claim.
  - `StreamCancelled` — Emitted on cancellation.
- **Error codes 1–9:**

  | Code | Name | Meaning |
  |------|------|---------|
  | 1 | `ScheduleNotFound` | No active schedule for the recipient |
  | 2 | `CliffNotReached` | Current ledger is before `cliff_ledger` |
  | 3 | `InvalidDuration` | `total_duration` ≤ `cliff_duration` |
  | 4 | `InvalidRate` | `rate` is zero or negative |
  | 5 | `DepositOverflow` | Arithmetic overflow computing total deposit |
  | 6 | `ScheduleAlreadyExists` | A stream already exists for this recipient |
  | 7 | `NothingToClaim` | Claimable amount is zero at current ledger |
  | 8 | `StreamNotExpired` | `end_ledger` has not yet been reached |
  | 9 | `TransferFailed` | Token transfer failed |

---

## [1.0.0] — 2026-06-03

### REST API — Initial Release

#### Added

- **GET `/api/v1/schedules/{recipient}`** — Full vesting schedule with computed fields.
