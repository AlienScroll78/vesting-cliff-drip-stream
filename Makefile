# ──────────────────────────────────────────────────────────────
# Vesting Cliff Drip Stream – Build & Test Makefile
# ──────────────────────────────────────────────────────────────

CONTRACT_NAME    = vesting_cliff_drip_stream
WASM_OUTPUT      = target/wasm32-unknown-unknown/release/$(CONTRACT_NAME).wasm
OPTIMIZED        = target/$(CONTRACT_NAME).optimized.wasm
MAX_WASM_SIZE_KB ?= 50

.PHONY: all build test spec-test optimize check-wasm-size clean fmt lint check doc test-integration test-e2e test-e2e-ui

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

## Check that the optimized WASM does not exceed MAX_WASM_SIZE_KB (default: 50 KB).
## Builds and optimizes first if the optimized WASM is not already present.
## Exit 1 if over threshold; exit 0 if within budget.
## Override threshold:  make check-wasm-size MAX_WASM_SIZE_KB=60
check-wasm-size: optimize
	@SIZE_BYTES=$$(wc -c < "$(OPTIMIZED)"); \
	SIZE_KB=$$(( SIZE_BYTES / 1024 )); \
	echo "Optimized WASM size: $${SIZE_KB} KB ($${SIZE_BYTES} bytes) — limit: $(MAX_WASM_SIZE_KB) KB"; \
	if [ "$$SIZE_KB" -gt "$(MAX_WASM_SIZE_KB)" ]; then \
		echo "ERROR: WASM size $${SIZE_KB} KB exceeds limit of $(MAX_WASM_SIZE_KB) KB" >&2; \
		exit 1; \
	fi; \
	echo "OK: $${SIZE_KB} KB <= $(MAX_WASM_SIZE_KB) KB"

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

## Run integration tests for the indexer event pipeline (issue #46)
## Requires a running local Stellar quickstart node and a built WASM.
test-integration: build
	docker compose -f docker-compose.e2e.yml up -d
	node tests/integration/indexer_pipeline.test.js; status=$$?; \
	docker compose -f docker-compose.e2e.yml down; \
	exit $$status
