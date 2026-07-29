# ──────────────────────────────────────────────────────────────
# Vesting Cliff Drip Stream – Build & Test Makefile
# ──────────────────────────────────────────────────────────────

CONTRACT_NAME = vesting_cliff_drip_stream
WASM_OUTPUT   = target/wasm32-unknown-unknown/release/$(CONTRACT_NAME).wasm
OPTIMIZED     = target/$(CONTRACT_NAME).optimized.wasm

.PHONY: all build test optimize clean fmt lint check mutants

all: build

## Compile the contract to WASM
build:
	cargo build --target wasm32-unknown-unknown --release

## Run all unit tests (native target, with testutils)
test:
	cargo test --features testutils

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

## Run mutation testing against critical arithmetic paths.
## Fails (non-zero exit) if any arithmetic mutant in contract.rs or storage.rs survives.
## Requires cargo-mutants: cargo install cargo-mutants
mutants:
	cargo mutants --package vesting-cliff-drip-stream --features testutils \
	    -- --test-threads=1
