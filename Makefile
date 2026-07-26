# ──────────────────────────────────────────────────────────────
# Vesting Cliff Drip Stream – Build & Test Makefile
# ──────────────────────────────────────────────────────────────

CONTRACT_NAME = vesting_cliff_drip_stream
WASM_OUTPUT   = target/wasm32-unknown-unknown/release/$(CONTRACT_NAME).wasm
OPTIMIZED     = target/$(CONTRACT_NAME).optimized.wasm

.PHONY: all build test spec-test optimize clean fmt lint check doc \
        test-integration test-e2e test-e2e-ui \
        bench bench-http bench-compare bench-update-baseline

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

## Run integration tests for the indexer event pipeline (issue #46)
## Requires a running local Stellar quickstart node and a built WASM.
test-integration: build
	docker compose -f docker-compose.e2e.yml up -d
	node tests/integration/indexer_pipeline.test.js; status=$$?; \
	docker compose -f docker-compose.e2e.yml down; \
	exit $$status

# ──────────────────────────────────────────────────────────────────────────────
# Performance benchmarks
# ──────────────────────────────────────────────────────────────────────────────

## Measure WASM instruction counts per contract entry point.
## Writes benchmarks/results.json.
bench:
	cargo test --features testutils --test bench bench_all_write_json -- --nocapture
	@echo "Results written to benchmarks/results.json"

## Run HTTP response-time benchmarks against a local frontend server.
## Starts the Vite dev server on port 3000, runs autocannon, then stops it.
## Writes benchmarks/http_results.json.
bench-http:
	@echo "Starting frontend dev server on port 3000..."
	cd frontend && npm install --prefer-offline --silent && \
	  npx vite --port 3000 & \
	  sleep 5 && \
	  node ../benchmarks/http_bench.js --url http://localhost:3000 && \
	  kill %1 || true
	@echo "Results written to benchmarks/http_results.json"

## Compare latest benchmark results against baseline.json.
## Exits with code 1 if any metric regresses more than 10%.
bench-compare:
	node benchmarks/compare.js

## Update baselines from the latest benchmark results.
## Only use this after verifying a regression is intentional.
bench-update-baseline:
	@echo "Current results:"
	@cat benchmarks/results.json 2>/dev/null || echo "(no WASM results — run 'make bench' first)"
	@cat benchmarks/http_results.json 2>/dev/null || echo "(no HTTP results — run 'make bench-http' first)"
	@echo ""
	@echo "Review benchmarks/baseline.json and update values manually, or run:"
	@echo "  node -e \"const r=require('./benchmarks/results.json'); const b=require('./benchmarks/baseline.json'); b.wasm_instruction_counts=r.wasm_instruction_counts; require('fs').writeFileSync('benchmarks/baseline.json', JSON.stringify(b,null,2)+'\n')\""
