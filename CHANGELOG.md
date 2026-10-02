# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Optional stream label (`metadata: Option<String>`) on `VestingSchedule`. Sponsors can attach a human-readable label (e.g. `"Q1 Grant"`) at creation time for off-chain indexing and display. Empty strings are normalised to `None`; values longer than 256 UTF-8 bytes are rejected with `MetadataTooLong` (error code 20). The label is immutable after stream creation. ([#15](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/15))
- `StreamCreated` events now carry the full schedule payload (`token`, `rate`, `start_ledger`, `cliff_ledger`, `end_ledger`, `total_deposit`) so off-chain indexers can reconstruct stream state from events alone. ([#321](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/321))
- Admin-controlled token allowlisting for `create_vesting_stream` with `add_allowed_token`, `remove_allowed_token`, and `get_allowed_tokens` entry-points. Creating a stream with a non-allowlisted token returns `RecipientNotAllowed` (error code 14). ([#320](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/320))
- Schedule versioning: a monotonically increasing `version` counter is stored in `VestingSchedule` and surfaced via `get_schedule`. Incremented on every mutating operation (claim, cancel, transfer). ([#318](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/318), [#319](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/319))
- Fuzz harness for `metadata` length validation added to `fuzz/fuzz_targets/metadata_validation.rs`.
- Integration test suite for `schedule_version` increments under claim, cancel, and transfer operations (`tests/integration/schedule_version.test.js`).

### Changed

- The `StreamCreated` event topics remain minimal at three values: `"StreamCreated"`, `sponsor`, and `recipient` for efficient filtering.

---

## [1.2.0] - 2026-08-31

### Added

#### Contract

- `pause_stream` and `resume_stream` entry-points: admin or sponsor can pause an active stream; claims on a paused stream return `StreamPaused` (error code 15); `resume_stream` restores normal dripping. ([#571](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/571))
- `transfer_recipient`: sponsor can atomically reassign a stream to a new recipient address; emits `RecipientTransferred` event. ([#588](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/588))
- `create_variable_stream` / `claim_variable_vested`: variable-rate streams defined by a `Vec<RateSegment>` (each with `start_ledger` + `rate`). Invalid segments (empty, out-of-order, non-positive rate) return `InvalidSegments` (error code 19). ([#574](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/574), [#572](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/572))
- `batch_create` / `batch_claim`: process up to 20 streams in a single transaction; exceeding the cap returns `BatchTooLarge` (error code 16). ([#572](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/572))
- `set_fee` / fee collection mechanism: optional basis-point fee deducted at claim time and forwarded to a treasury address. Fee capped at 500 bps (5%); higher values return `InvalidRate` (error code 4). ([#575](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/575))
- `InvalidToken` (error code 12): `create_vesting_stream` now validates that the token address is a live SAC by calling `try_balance` before persisting the schedule. ([#9](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/9))
- `stream_status()` on-chain view function returning the full lifecycle state enum (`Active`, `Paused`, `Expired`, `Cancelled`, `Drained`). ([#583](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/583))
- `get_total_claimed`, `get_stats`, `get_streams_for_sponsor`, `get_status` view functions. ([#579](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/579), [#580](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/580), [#581](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/581))
- `set_config` / `get_config`: admin-settable `ConfigMaxCliffRatio` and `ConfigMinRate` guards enforced on stream creation. ([#11](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/11))
- `emergency_drain`: admin-gated immediate recovery of tokens from any vault (bypass drain delay). ([#579](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/579))
- Reentrancy guard using a `LOCK` flag in instance storage for defence-in-depth. ([#13](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/13))
- Proactive TTL refresh for long-duration streams, preventing storage expiry mid-stream. ([#585](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/585))
- Fixed-point rate representation and cliff-ratio guard added to `create_vesting_stream`. ([#567](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/567))
- `clawback_stream` hardened with SAC flag check — returns `ClawbackNotSupported` (error code 26) for tokens without the SAC clawback flag. Sponsor identity re-validated. ([#584](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/584))
- `StreamAlreadyPaused` (error code 23) and `StreamNotPaused` (error code 24) error codes.
- `VersionOverflow` (error code 25) returned when the version counter reaches `u32::MAX`.

#### Backend API (v1.1.0 — 2026-08-28)

- **GET `/health`** — Liveness probe returning `{ status, version, uptime }`.
- **GET `/health/horizon`** — Horizon connectivity check returning `{ status, endpoints }`.
- **GET `/health/horizon/circuit-breaker`** — Circuit-breaker state (`closed` / `open` / `half-open`).
- **GET `/api/openapi.json`** — Raw OpenAPI 3.0 spec.
- **GET `/api/v1/schedules`** — Paginated schedule list (JWT-authenticated; `sub` claim must match `sponsor` param).
- **GET `/api/v1/schedules/export`** — CSV/JSON export with `from`/`to` date filtering.
- **GET `/api/v1/schedules/sponsor/{sponsor}`** — Legacy Horizon-based sponsor lookup.
- **GET `/admin/indexer/status`** — Indexer health (Basic Auth, internal only).
- **GET `/admin/metrics`** — Prometheus text metrics (Basic Auth, internal only).
- **POST `/api/v1/admin/drain`** — Drain expired streams with optional dry-run.
- **GET `/api/v1/metrics`** — JSON operational metrics (cache hit rates).
- **WebSocket `/ws/claimable`** — Real-time claimable balance subscription. ([#698](https://github.com/AlienScroll78/vesting-cliff-drip-stream/pull/698))
- **GET `/streams/:recipient/versions`** — Retrieve full version history for a schedule. ([#286](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/286))
- **POST `/api/v1/backfill`** — Replay Horizon events into `stream_events` after indexer downtime. ([#286](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/286))
- Soroban RPC view-call caching with per-function TTLs (Redis). ([#699](https://github.com/AlienScroll78/vesting-cliff-drip-stream/pull/699))
- Zod request validation on all API endpoints. ([#700](https://github.com/AlienScroll78/vesting-cliff-drip-stream/pull/700))
- Admin API protected by Bearer token auth. ([#701](https://github.com/AlienScroll78/vesting-cliff-drip-stream/pull/701))
- PostgreSQL connection pool with Prometheus metrics and health endpoint. ([#689](https://github.com/AlienScroll78/vesting-cliff-drip-stream/pull/689))
- Complete OpenTelemetry tracing with distributed correlation IDs. ([#697](https://github.com/AlienScroll78/vesting-cliff-drip-stream/pull/697))
- Horizon circuit breaker with `/health` state exposure. ([#703](https://github.com/AlienScroll78/vesting-cliff-drip-stream/pull/703))
- Webhook retry logic, dead-letter queue (DLQ), and HMAC validation. ([#552](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/552))
- Stricter rate limits on write endpoints. ([#551](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/551))
- GraphQL depth-limit enforcement. ([#553](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/553))
- Cursor-based pagination for the schedules list endpoint. ([#554](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/554))
- Structured logging with full correlation ID propagation throughout the backend. ([#705](https://github.com/AlienScroll78/vesting-cliff-drip-stream/pull/705))
- `schedule-version-recorder.js`: persists schedule version history to `schedule_versions` table. ([#005](https://github.com/AlienScroll78/vesting-cliff-drip-stream/blob/main/backend/migrations/005_create_schedule_versions.ts))
- Event indexer pipeline with backfill script and integration tests. ([#286](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/286))
- `stream_events` table and migration `004_create_stream_events.ts`.

#### Frontend

- Vesting dashboard with real-time progress bars, sort/filter/table view, and 30-second auto-refresh. ([#277](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/277), [#661](https://github.com/AlienScroll78/vesting-cliff-drip-stream/pull/661))
- Multi-step create-stream wizard (4 steps with live deposit preview). ([#267](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/267))
- Unified wallet connection modal (Freighter / WalletConnect / Albedo). ([#659](https://github.com/AlienScroll78/vesting-cliff-drip-stream/pull/659))
- Offline caching via service worker with offline splash page. ([#539](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/539))
- Full dark mode support with OS preference detection and 200 ms transitions. ([#273](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/273))
- PDF print/export with `PrintButton` and `VestingSchedulePrint` components. ([#274](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/274), [#541](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/541))
- Mobile claim bottom sheet with swipe-to-dismiss. ([#542](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/542))
- `StreamStatusBadge` component with all 6 lifecycle states and accessible colour tokens. ([#543](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/543))
- Component styles migrated to CSS Modules. ([#540](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/540))
- Horizon API status banner, mobile bottom navigation bar, and i18n framework (EN/ES). ([#278](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/278), [#279](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/279), [#280](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/280))
- Interactive deposit cost calculator with `i128` overflow validation. ([#276](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/276))
- Glossary tooltip system with `@floating-ui/react`. ([#380](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/380))
- Skeleton loading screens with shimmer animation. ([#549](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/549))
- Error boundaries with per-card Sentry integration. ([#275](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/275), [#545](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/545))
- Onboarding tour for first-time sponsor users. ([#544](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/544))
- Transaction history panel backed by Horizon event stream.
- CANCEL-typed confirmation gate for cancel-stream action. ([#550](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/550))
- Wallet connection state persisted across page reloads.
- Full event tracking / analytics integration. ([#546](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/546))
- SVG vesting timeline component and stream comparison view. ([#381](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/381))

#### Infrastructure & Operations

- Automated Terraform drift detection scheduled daily at 02:00 UTC; opens a GitHub issue and sends Slack alert on detected drift. ([#411](https://github.com/AlienScroll78/vesting-cliff-drip-stream/pull/411))
- Cost anomaly alerting with ECS/RDS CloudWatch monitors and Slack relay Lambda. ([#566](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/566))
- Migration rollback support with CLI scripts and integration tests. ([#561](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/561))
- Kubernetes NetworkPolicy resources for least-privilege pod networking. ([#410](https://github.com/AlienScroll78/vesting-cliff-drip-stream/pull/410))
- Production-ready Kubernetes manifests for backend-api, event-worker, and frontend deployments.
- Production Helm chart (`helm/vesting-backend`) with staging/production value overrides. ([#264](https://github.com/AlienScroll78/vesting-cliff-drip-stream/pull/264))
- External Secrets Operator configuration for AWS Secrets Manager and HashiCorp Vault. ([#8ececef](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/8ececef))

### Changed

- Backend API version bumped from `1.0.0` to `1.1.0`; all new endpoints are additive (no breaking changes to existing `GET /api/v1/schedules/{recipient}`).
- `StreamCreated` event payload extended with full schedule fields (non-breaking; existing topic structure unchanged).
- `clawback_stream` now validates SAC clawback flag before proceeding; previously would fail at the token-transfer step.

### Fixed

- WASM build failure under `#![deny(missing_docs)]` — added `#[allow(missing_docs)]` on the `contracterror` macro output. ([#336be60](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/336be60))
- Merge conflict in `Makefile` between `main` and `perf-regression-ci` branches resolved. ([#413](https://github.com/AlienScroll78/vesting-cliff-drip-stream/pull/413))
- Production readiness CI checks repaired after pipeline regression. ([#7b0f41c](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/7b0f41c))
- Cross-browser compatibility issues with Playwright E2E tests on WebKit. ([#547](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/547))

### Security

- SBOM (SPDX 2.3 JSON) generated for every release and license scanning on every PR. ([#414](https://github.com/AlienScroll78/vesting-cliff-drip-stream/pull/414))
- Container image signed with `cosign` and SLSA provenance attached to each release. ([#416](https://github.com/AlienScroll78/vesting-cliff-drip-stream/pull/416))
- CodeQL SAST analysis added to pipeline. ([#216](https://github.com/AlienScroll78/vesting-cliff-drip-stream/pull/216))
- Automated dependency vulnerability scanning pipeline (`cargo audit`, `npm audit`). ([#419](https://github.com/AlienScroll78/vesting-cliff-drip-stream/pull/419))

---

## [1.1.0] - 2026-07-29

### Added

#### Contract

- `drain_expired_stream`: permissionless cleanup of fully expired streams. Any caller can invoke after `end_ledger + 6,307,200` ledgers (~1 year); transfers remaining tokens to the original sponsor. Returns `DrainDelayNotExpired` (error code 10) if called early. Emits `StreamDrained` event. ([#316](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/316))
- `clawback_stream`: compliance clawback recovering all remaining vault tokens to the original sponsor, bypassing cliff state. Only available on tokens with `AUTH_CLAWBACK_ENABLED_FLAG`. Accepts a `reason` string (max 256 chars). Emits `StreamClawedBack` event. ([#317](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/317))
- `set_min_deposit` / `get_min_deposit`: admin-controlled minimum total deposit threshold (default 100 tokens). Stream creation is rejected with `RateTooLow` (error code 17) when `rate × total_duration` falls below the threshold. ([#314](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/314))
- `initialize` admin entry-point: one-time contract initialisation storing the admin address; subsequent calls return `AlreadyInitialized` (error code 13). ([#321](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/321))
- `upgrade` admin entry-point: admin-gated Wasm hash replacement for live contract upgrades. ([#931bdc7](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/931bdc7))
- `transfer_admin`: atomic admin key rotation to a new address.
- `StreamCreated` event now includes `token`, `rate`, `start_ledger`, `cliff_ledger`, `end_ledger`, and `total_deposit` in the data payload for richer indexer reconstruction. ([#318](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/318))
- `InvalidCliffDuration` (error code 12 → renumbered to 12 in this version): rejects streams where `cliff_duration` is zero.
- `InvalidRecipient` (error code 11): rejects streams where sponsor and recipient are the same address.
- `NotInitialized` (error code 18): returned by all mutating functions before `initialize` is called.
- `ClawbackNotSupported` (error code 26) stub (enforced in v1.2.0).
- Mutation testing setup with `cargo-mutants`; baseline mutation score ≥ 80%. ([#315](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/315))

#### Backend

- Initial backend API server (`backend/`) with Node.js/TypeScript, Express, and PostgreSQL.
- **GET `/api/v1/schedules/{recipient}`** — Full vesting schedule with computed fields (initial v1.0.0 endpoint; now served by new backend).
- Database migrations V1–V4: `schedules`, `events`, `claims`, and cursor-pagination index. ([#285](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/285))
- Soroban view proxy (`sorobanViews.js`) with configurable RPC endpoint.
- Event indexer (`indexer.ts`) polling Horizon for `StreamCreated`, `VestingClaimed`, and `StreamCancelled` events.
- `contract-version.js` helper surfacing on-chain contract version for health checks.

#### Infrastructure

- Production Helm chart `helm/vesting-backend` with GitHub Pages chart publishing. ([#260](https://github.com/AlienScroll78/vesting-cliff-drip-stream/pull/260))
- k6 load tests for concurrent stream creation and backend API scenarios. ([#165](https://github.com/AlienScroll78/vesting-cliff-drip-stream/pull/165))
- Playwright E2E lifecycle test suite (create → cliff → claim → cancel). ([#451](https://github.com/AlienScroll78/vesting-cliff-drip-stream/pull/451))
- Horizon network resilience tests using Toxiproxy. ([#357](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/357))
- Performance regression gate: blocks merge if `claimable_amount` CPU instruction count regresses by >5%. ([#415](https://github.com/AlienScroll78/vesting-cliff-drip-stream/pull/415))
- Storybook stories with interaction tests and `@storybook/addon-a11y`. ([#387](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/387))
- Usability testing protocol and research documentation. ([#388](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/388))
- cargo-fuzz targets for `create_vesting_stream` and `claim_vested`. ([#3d360ab](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/3d360ab))
- Playwright visual regression snapshots for all major UI components. ([#445](https://github.com/AlienScroll78/vesting-cliff-drip-stream/pull/445))
- Comprehensive smoke tests for testnet deployment (`scripts/smoke_test.sh`). ([#516](https://github.com/AlienScroll78/vesting-cliff-drip-stream/pull/516))
- Container registry pipeline with cosign image signing. ([#416](https://github.com/AlienScroll78/vesting-cliff-drip-stream/pull/416))
- Automated staging CI/CD pipeline with smoke tests and rollback. ([#417](https://github.com/AlienScroll78/vesting-cliff-drip-stream/pull/417))
- Branch protection rules, CODEOWNERS file, and CI job naming conventions. ([#418](https://github.com/AlienScroll78/vesting-cliff-drip-stream/pull/418))

### Performance

- `claimable_amount` and `is_cliff_passed` views skip TTL bump on read-only access, reducing per-call ledger write overhead. ([#16](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/16))

### Fixed

- `end_ledger` boundary: tokens accrued exactly at `end_ledger` are now claimable (off-by-one corrected). ([#dd158f1](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/dd158f1))
- WASM build repaired under CI `wasm32-unknown-unknown` target after dependency update. ([#170](https://github.com/AlienScroll78/vesting-cliff-drip-stream/pull/170))

---

## [1.0.0] - 2026-06-26

### Added

#### Contract

- `create_vesting_stream` entry-point: sponsor deposits full token allocation upfront into the contract vault. Parameters: `sponsor`, `recipient`, `token` (SAC address), `rate` (tokens per ledger), `cliff_duration` (ledgers until cliff), `total_duration` (total stream length, must be > `cliff_duration`). ([#1](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/1))
- `claim_vested` entry-point: recipient claims all accrued tokens in a single call. Returns the amount transferred. Returns `CliffNotReached` (error code 2) before `cliff_ledger`; provides instant catch-up for all tokens accrued since `start_ledger` at the cliff. ([#2](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/2))
- `cancel_stream` entry-point: sponsor cancels an active stream. If the cliff has passed, the recipient receives all accrued tokens and the sponsor recovers the remainder. If the cliff has not passed, the full deposit is refunded to the sponsor. ([#3](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/3))
- `VestingSchedule` storage type with fields: `start_ledger`, `cliff_ledger`, `end_ledger`, `rate`, `sponsor`, `token`, `claimed`.
- `VestingError` enum with seven typed error codes:
  - `1` — `ScheduleNotFound`
  - `2` — `CliffNotReached`
  - `3` — `InvalidDuration`
  - `4` — `InvalidRate`
  - `5` — `DepositOverflow`
  - `6` — `ScheduleAlreadyExists`
  - `7` — `NothingToClaim`
- View functions: `get_schedule(recipient)`, `claimable_amount(recipient)`, `is_cliff_passed(recipient)`.
- Structured on-chain events: `StreamCreated`, `VestingClaimed`, `StreamCancelled`.
- Persistent storage helpers with automatic TTL bumping (~60-day window) to prevent expiry of active streams.
- Overflow-safe arithmetic throughout using `checked_mul` / `checked_add`; returns `DepositOverflow` instead of panicking.
- Duplicate-stream prevention: `ScheduleAlreadyExists` returned for a second stream to the same recipient.
- Full test suite: creation, claiming, cancellation, view functions, edge/boundary cases, property-based tests, event snapshots, and auth edge cases.
- `Makefile` targets: `build`, `test`, `lint`, `fmt`, `mutants`.
- `scripts/deploy.sh`: build-optimise-deploy to Stellar testnet.
- `scripts/invoke_create.sh` and `scripts/invoke_claim.sh`: CLI helpers for manual testing.

#### Frontend (initial release)

- Wallet connect button with Freighter/WalletConnect/Albedo support and three states (disconnected, connecting, connected). ([#130](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/130))
- Stream-status badges with colour-coded lifecycle states. ([#128](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/128))
- Mobile claim bottom sheet (initial design). ([#129](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/129))
- Date/time picker for cliff and total duration. ([#131](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/131))
- Segmented progress bar with locked/cliff/drip sections and tooltips.
- Transaction status drawer (pending / confirmed / failed).
- Sponsor stream creation success screen with confetti and share link. ([#132](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/132))
- SVG logo, favicon set (16/32/180 px), and web manifest. ([#128](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/128))
- Print stylesheet for vesting schedule summary. ([#129](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/129))
- i18n date/time utility with `Intl.DateTimeFormat` and relative clock. ([#134](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/134))
- Keyboard shortcut reference modal. ([#133](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/133))
- Design system component library with CSS custom properties and design tokens.
- Improved number formatting for large token amounts. ([#127](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/127))
- i18n framework, analytics event tracking, admin panel, and keyboard navigation. ([#66](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/66), [#67](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/67), [#68](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/68), [#69](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/69))
- Transaction history panel and cancel confirmation modal. ([#57](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/57), [#56](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/56))
- Error boundary components for resilient UI. ([#275](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/275))
- Playwright E2E test suite on local Stellar quickstart. ([#97](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/97))

#### Infrastructure & CI

- GitHub Actions CI pipeline: lint (`cargo fmt` + `clippy`), `contract-test`, WASM `build`, and TypeScript `typecheck` jobs. ([#135](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/135))
- Automated WASM optimization and size-check CI (95 KB budget). ([#136](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/136))
- Docker build/push/scan workflow with multi-stage Dockerfile. ([#137](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/137))
- Staging deployment pipeline. ([#139](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/139))
- Terraform IaC modules for ECS, RDS, VPC, and Redis on AWS. ([#140](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/140))
- AWS Secrets Manager integration with ECS task-definition snippet. ([#141](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/141))
- CloudWatch log aggregation with runbook. ([#142](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/142))
- `cargo audit` dependency vulnerability scanning. ([#138](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/138))
- Automated release workflow with semantic versioning and WASM artifact attachment. ([#144](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/144))
- Uptime monitoring and alerting setup. ([#143](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/143))
- RDS automated backup workflow and restore runbook. ([#146](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/146))
- Branch protection script and CONTRIBUTING.md. ([#145](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/145))
- Accessibility audit report and `axe-core` integration. ([#126](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/126))
- Sponsor cost calculator documentation. ([#184](https://github.com/AlienScroll78/vesting-cliff-drip-stream/pull/184))
- Mermaid sequence diagrams for contract flows (`docs/flows.md`).
- Error handling guide for integrators (`docs/error-handling.md`). ([#87](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/87))
- Wallet integration guide with JS SDK examples. ([#183](https://github.com/AlienScroll78/vesting-cliff-drip-stream/pull/183))
- Comparison guide versus standard Drips protocol. ([#94](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/94))
- Architecture Decision Records (ADRs 0001–0006).
- SECURITY.md vulnerability disclosure policy.
- CODE_OF_CONDUCT.md (Contributor Covenant 2.1).
- Property-based tests for `claimable_amount` with `proptest`. ([#96](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/96))
- Snapshot tests for all contract events. ([#102](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/102))
- Contract upgrade / migration test. ([#105](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/105))
- `DepositOverflow` boundary test (`i128::MAX / total_duration + 1`). ([#168](https://github.com/AlienScroll78/vesting-cliff-drip-stream/pull/168))
- Mutation testing with `cargo-mutants` and targeted survivor tests. ([#169](https://github.com/AlienScroll78/vesting-cliff-drip-stream/pull/169))
- Visual regression snapshot baseline. ([#167](https://github.com/AlienScroll78/vesting-cliff-drip-stream/pull/167))

---

<!-- Link definitions -->
[Unreleased]: https://github.com/AlienScroll78/vesting-cliff-drip-stream/compare/v1.2.0...HEAD
[1.2.0]: https://github.com/AlienScroll78/vesting-cliff-drip-stream/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/AlienScroll78/vesting-cliff-drip-stream/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/AlienScroll78/vesting-cliff-drip-stream/releases/tag/v1.0.0
