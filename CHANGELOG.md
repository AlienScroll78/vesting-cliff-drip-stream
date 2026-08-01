# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `StreamCreated` events now carry the full schedule payload (`token`, `rate`, `start_ledger`, `cliff_ledger`, `end_ledger`, `total_deposit`) so off-chain indexers can reconstruct stream state from events alone.
- Admin-controlled token allowlisting for `create_vesting_stream` with `add_allowed_token`, `remove_allowed_token`, `get_allowed_tokens`, and `TokenNotAllowed` error handling.
- Schedule versioning with a monotonically increasing `version` counter stored in `VestingSchedule` and surfaced via `get_schedule`.

### Changed

- The `StreamCreated` event topics remain minimal at three values: `"StreamCreated"`, `sponsor`, and `recipient` for efficient filtering.

## [1.0.0] - 2026-06-26

### Added

- `create_vesting_stream` entry-point: sponsor deposits full allocation upfront; cliff and total duration specified in ledgers.
- `claim_vested` entry-point: recipient claims all accrued tokens; blocked with `CliffNotReached` before the cliff ledger; returns the amount transferred.
- `cancel_stream` entry-point: sponsor cancels an active stream; recipient keeps accrued tokens if cliff has passed, otherwise full deposit is refunded to sponsor.
- View functions: `get_schedule`, `claimable_amount`, `is_cliff_passed`.
- `VestingSchedule` storage type with `start_ledger`, `cliff_ledger`, `end_ledger`, `rate`, `sponsor`, `token`, and `claimed` fields.
- `VestingError` enum with seven typed codes: `ScheduleNotFound`, `CliffNotReached`, `InvalidDuration`, `InvalidRate`, `DepositOverflow`, `ScheduleAlreadyExists`, `NothingToClaim`.
- Structured on-chain events emitted on stream creation, claim, and cancellation.
- Persistent storage helpers with automatic TTL bumping (~60-day window) to prevent expiry of active streams.
- Overflow-safe arithmetic throughout; `DepositOverflow` returned instead of panicking.
- Duplicate-stream prevention: `ScheduleAlreadyExists` returned when a stream already exists for a recipient.
- Full test suite covering creation, claiming, cancellation, view functions, and edge/boundary cases.
- `Makefile` targets: `build`, `test`, `lint`, `fmt`.
- `scripts/deploy.sh` for build-optimise-deploy to Stellar testnet.
- `scripts/invoke_create.sh` and `scripts/invoke_claim.sh` CLI helpers.

[Unreleased]: https://github.com/AlienScroll78/vesting-cliff-drip-stream/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/AlienScroll78/vesting-cliff-drip-stream/releases/tag/v1.0.0
