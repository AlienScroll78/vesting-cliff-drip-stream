# ──────────────────────────────────────────────────────────────
# Vesting Cliff Drip Stream – Build & Test Makefile
# ──────────────────────────────────────────────────────────────

CONTRACT_NAME = vesting_cliff_drip_stream
WASM_OUTPUT   = target/wasm32-unknown-unknown/release/$(CONTRACT_NAME).wasm
OPTIMIZED     = target/$(CONTRACT_NAME).optimized.wasm

.PHONY: all build test optimize clean fmt lint check test-snapshots test-e2e test-a11y test-migrations

all: build

## Compile the contract to WASM
build:
	cargo build --target wasm32-unknown-unknown --release

## Run all unit tests (native target, with testutils)
test:
	cargo test --features testutils

## Run contract event snapshot tests only (#363)
test-snapshots:
	cargo test --features testutils test_event_snapshots

## Regenerate event snapshot JSON files (#363)
update-snapshots:
	UPDATE_SNAPSHOTS=1 cargo test --features testutils test_event_snapshots

## Run Playwright E2E tests across all browsers (#362, #364)
test-e2e:
	cd frontend && npm ci && npx playwright install --with-deps && npx playwright test

## Run axe-core accessibility tests only (#362)
test-a11y:
	cd frontend && npm ci && npx playwright install --with-deps && npx playwright test --grep @a11y

## Run database migration tests (#365)
test-migrations:
	cd backend && npm ci && npm run test:migrations

## Optimize the WASM binary with soroban CLI
optimize: build
	stellar contract optimize --wasm $(WASM_OUTPUT) --wasm-out $(OPTIMIZED)
	@echo "Optimized: $(OPTIMIZED)"
	@ls -lh $(OPTIMIZED)

## Format source code
fmt:
	cargo fmt --all

## Run clippy lints
lint:
	cargo clippy --all-targets --all-features -- -D warnings

## Type-check without building
check:
	cargo check --all-targets --all-features

## Remove build artifacts
clean:
	cargo clean
