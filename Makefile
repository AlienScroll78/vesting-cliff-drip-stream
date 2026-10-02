# ──────────────────────────────────────────────────────────────
# Vesting Cliff Drip Stream – Build & Test Makefile
# ──────────────────────────────────────────────────────────────

CONTRACT_NAME    = vesting_cliff_drip_stream
WASM_OUTPUT      = target/wasm32-unknown-unknown/release/$(CONTRACT_NAME).wasm
OPTIMIZED        = target/$(CONTRACT_NAME).optimized.wasm
MAX_WASM_SIZE_KB ?= 50

.PHONY: all build test spec-test optimize clean fmt lint check doc test-integration test-e2e test-e2e-ui test-load test-load-dryrun fuzz fuzz-ci bench bench-update db-migrate db-rollback db-migrate-dry-run

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

## Enforce a minimum 90% line coverage threshold (issue #785).
## Generates HTML report in docs/coverage/html/ and LCOV in docs/coverage/lcov.info,
## then fails the build if line coverage drops below 90%.
## Excludes test helper files from coverage calculation.
## Install: cargo install cargo-llvm-cov
coverage-check:
	cargo llvm-cov \
		--features testutils \
		--html \
		--output-dir docs/coverage/html \
		--lcov \
		--output-path docs/coverage/lcov.info \
		--ignore-filename-regex 'src/tests/.*' \
		--fail-under-lines 90

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

## Dry-run schema migration: lists likely legacy schedules from indexed events.
## Requires DATABASE_URL and SCHEMA_V2_LEDGER.
## Example:
##   make migrate-dry-run SCHEMA_V2_LEDGER=123456 DATABASE_URL=postgres://...
migrate-dry-run:
	@echo "=== Schema Migration Dry-Run ==="
	@test -n "$(DATABASE_URL)" || (echo "ERROR: DATABASE_URL is required."; exit 1)
	@test -n "$(SCHEMA_V2_LEDGER)" || (echo "ERROR: SCHEMA_V2_LEDGER is required."; exit 1)
	@DATABASE_URL="$(DATABASE_URL)" SCHEMA_V2_LEDGER="$(SCHEMA_V2_LEDGER)" node backend/scripts/migrate_dry_run.js

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

## Run full stream lifecycle integration tests against a local Stellar node (issue #779).
## Starts a stellar/quickstart:testing node, deploys the contract, funds accounts,
## runs all 5 lifecycle scenarios, then tears down.
## Requires: Docker, Stellar CLI, Python 3.11+, Rust wasm32 target.
integration-test: build
	@echo "==> Starting local Stellar quickstart node..."
	docker compose -f docker-compose.integration.yml up -d
	@echo "==> Waiting for node to be ready..."
	@for i in $$(seq 1 60); do \
		curl -sf http://localhost:8000 > /dev/null 2>&1 && echo "  Node ready." && break; \
		echo "  Attempt $$i/60..."; sleep 5; \
	done
	@echo "==> Configuring Stellar CLI network..."
	stellar network add local \
		--rpc-url http://localhost:8000/soroban/rpc \
		--network-passphrase "Standalone Network ; February 2017" \
		2>/dev/null || true
	@echo "==> Funding test accounts..."
	source scripts/fund_accounts.sh
	@echo "==> Deploying contract..."
	$(eval VESTING_CONTRACT := $(shell bash scripts/deploy_contract.sh))
	@echo "  Contract: $(VESTING_CONTRACT)"
	@echo "==> Running lifecycle integration tests..."
	VESTING_CONTRACT=$(VESTING_CONTRACT) \
	SOROBAN_RPC_URL=http://localhost:8000/soroban/rpc \
	HORIZON_URL=http://localhost:8000 \
	STELLAR_NETWORK=local \
	python3 tests/integration/test_lifecycle.py; \
	STATUS=$$?; \
	docker compose -f docker-compose.integration.yml down; \
	exit $$STATUS

## Run k6 backend load tests (requires a running backend on localhost:3001)
## See tests/load/backend_scenarios.js for scenario description.
test-load:
	cd tests/load && k6 run backend_scenarios.js

## Run k6 load tests in dry-run mode (skips create/claim mutations)
test-load-dryrun:
	cd tests/load && k6 run backend_scenarios.js -e SKIP_MUTATIONS=1

## Run performance benchmarks and evaluate against baselines (see docs/performance.md)
bench:
	@mkdir -p benchmarks
	cargo test --features testutils bench_ -- --nocapture 2>/dev/null \
		| grep '^BENCH' \
		| sed 's/^BENCH //' \
		| jq -s '{benchmarks: .}' > benchmarks/results.json
	node scripts/check_perf.js --results benchmarks/results.json --baseline benchmarks/baseline.json

## Run benchmarks and record results to benchmarks/results.json (see docs/performance.md)
bench-update:
	@mkdir -p benchmarks
	cargo test --features testutils bench_ -- --nocapture 2>/dev/null \
		| grep '^BENCH' \
		| sed 's/^BENCH //' \
		| jq -s '{benchmarks: .}' > benchmarks/results.json
	@echo "Benchmark results captured in benchmarks/results.json"

## Apply pending PostgreSQL migrations (requires DATABASE_URL).
db-migrate:
	cd backend && npm run migrate

## Revert the most recently applied PostgreSQL migration.
db-rollback:
	cd backend && npm run migrate:down

## Preview pending migrations without applying them.
db-migrate-dry-run:
	cd backend && npm run migrate:dry-run

