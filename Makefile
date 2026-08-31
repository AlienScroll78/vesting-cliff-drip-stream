# ──────────────────────────────────────────────────────────────
# Vesting Cliff Drip Stream – Build & Test Makefile
# ──────────────────────────────────────────────────────────────

CONTRACT_NAME = vesting_cliff_drip_stream
WASM_OUTPUT   = target/wasm32-unknown-unknown/release/$(CONTRACT_NAME).wasm
OPTIMIZED     = target/$(CONTRACT_NAME).optimized.wasm

.PHONY: all build test spec-test optimize clean fmt lint check doc test-integration test-e2e test-e2e-ui test-load test-load-dryrun fuzz fuzz-ci

all: build

## Compile the contract to WASM
build:
	cargo build --target wasm32-unknown-unknown --release

## Run all unit tests (native target, with testutils)
test:
	cargo test --features testutils

## Run coverage with cargo-llvm-cov (install: cargo install cargo-llvm-cov)
## Generates HTML report in docs/coverage/html and lcov.info in docs/coverage/
coverage:
	cargo llvm-cov --features testutils --html --output-dir docs/coverage/html
	cargo llvm-cov --features testutils --lcov --output-path docs/coverage/lcov.info

## Run coverage in CI mode with threshold enforcement
## Fails if line coverage < 90% or branch coverage < 80%
coverage-ci:
	cargo llvm-cov --features testutils --fail-under-lines 90 --fail-under-branches 80 -- --lib

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

## Run fuzz targets with cargo-fuzz (requires nightly toolchain)
## Each target runs for 60 seconds by default
fuzz:
	RUSTUP_TOOLCHAIN=nightly cargo fuzz run create_vesting_stream -- -max_total_time=60 -artifact_prefix=fuzz/artifacts/create_vesting_stream/
	RUSTUP_TOOLCHAIN=nightly cargo fuzz run claim_vested -- -max_total_time=60 -artifact_prefix=fuzz/artifacts/claim_vested/
	RUSTUP_TOOLCHAIN=nightly cargo fuzz run metadata_validation -- -max_total_time=60 -artifact_prefix=fuzz/artifacts/metadata_validation/

## Run fuzz targets in CI mode – 10-minute wall-clock budget per target.
## Runs create_vesting_stream first (with the full structured corpus), then
## claim_vested and metadata_validation at 60 s each.
## Usage: make fuzz-ci
## Requires: nightly Rust toolchain, cargo-fuzz installed.
fuzz-ci:
	mkdir -p fuzz/artifacts/create_vesting_stream fuzz/artifacts/claim_vested fuzz/artifacts/metadata_validation
	RUSTUP_TOOLCHAIN=nightly cargo fuzz run create_vesting_stream \
		fuzz/corpus/create_vesting_stream \
		-- \
		-max_total_time=600 \
		-print_final_stats=1 \
		-artifact_prefix=fuzz/artifacts/create_vesting_stream/
	RUSTUP_TOOLCHAIN=nightly cargo fuzz run claim_vested \
		fuzz/corpus/claim_vested \
		-- \
		-max_total_time=60 \
		-print_final_stats=1 \
		-artifact_prefix=fuzz/artifacts/claim_vested/
	RUSTUP_TOOLCHAIN=nightly cargo fuzz run metadata_validation \
		fuzz/corpus/metadata_validation \
		-- \
		-max_total_time=60 \
		-print_final_stats=1 \
		-artifact_prefix=fuzz/artifacts/metadata_validation/

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

## Run integration tests for the indexer event pipeline (issue #46)
## Requires a running local Stellar quickstart node and a built WASM.
test-integration: build
	docker compose -f docker-compose.e2e.yml up -d
	node tests/integration/indexer_pipeline.test.js; status=$$?; \
	docker compose -f docker-compose.e2e.yml down; \
	exit $$status

## Run k6 backend load tests (requires a running backend on localhost:3001)
## See tests/load/backend_scenarios.js for scenario description.
test-load:
	cd tests/load && k6 run backend_scenarios.js

## Run k6 load tests in dry-run mode (skips create/claim mutations)
test-load-dryrun:
	cd tests/load && k6 run backend_scenarios.js -e SKIP_MUTATIONS=1
