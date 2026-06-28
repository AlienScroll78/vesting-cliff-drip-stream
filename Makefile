# ──────────────────────────────────────────────────────────────
# Vesting Cliff Drip Stream – Build & Test Makefile
# ──────────────────────────────────────────────────────────────

CONTRACT_NAME = vesting_cliff_drip_stream
WASM_OUTPUT   = target/wasm32-unknown-unknown/release/$(CONTRACT_NAME).wasm
OPTIMIZED     = target/$(CONTRACT_NAME).optimized.wasm

.PHONY: all build test spec-test optimize clean fmt lint check doc

all: build

## Compile the contract to WASM
build:
	cargo build --target wasm32-unknown-unknown --release

## Run all unit tests (native target, with testutils)
test:
	cargo test --features testutils

## Validate the on-chain contract spec (schema) against the expected API.
## Requires the WASM to be built first; spec-test depends on `build`.
spec-test: build
	cargo test --test contract_spec

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

## Build rustdoc; fails on any missing-doc warning (mirrors CI)
doc:
	RUSTDOCFLAGS="-D warnings" cargo doc --no-deps

## Run mutation testing on contract.rs and storage.rs (requires cargo-mutants)
## Install: cargo install cargo-mutants --locked
## Results written to mutants.out/
mutants:
	cargo mutants --features testutils \
		--file src/contract.rs --file src/storage.rs \
		--output mutants.out

## Remove build artifacts
clean:
	cargo clean

## Run Playwright E2E tests (requires Node.js + npm install in frontend/)
test-e2e-ui:
	cd frontend && npm install --prefer-offline && npx playwright install chromium --with-deps && npm run test:e2e

## Run E2E tests against local Stellar quickstart (issue #97)
## Starts docker-compose, builds WASM, runs test suite, then tears down.
test-e2e: build
	docker compose -f docker-compose.e2e.yml up -d
	node tests/e2e/run_e2e.js; status=$$?; \
	docker compose -f docker-compose.e2e.yml down; \
	exit $$status
