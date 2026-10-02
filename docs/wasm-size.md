# WASM Size History

Tracks the optimized WASM binary size for `vesting_cliff_drip_stream` on every merge to `main`.

The size limit threshold is controlled by the `WASM_SIZE_LIMIT_KB` env var in
[`.github/workflows/wasm-size.yml`](../.github/workflows/wasm-size.yml) (default: **95 KB**).

## Optimization Audit (#589)

**Date:** 2026-08-28

### Before

| Metric | Value |
|--------|-------|
| Baseline budget | 100 KB |
| Optimized WASM (estimated pre-audit) | ~98 KB |

### Changes Applied

| Change | Impact |
|--------|--------|
| Removed `[profile.release]` block from `.cargo/config.toml` that partially overrode `Cargo.toml` with only `opt-level = "z"` and `overflow-checks = true`, obscuring the full profile (`lto = true`, `strip = "symbols"`, `codegen-units = 1`, `panic = "abort"`) | Ensures LTO, symbol stripping, and single codegen-unit are consistently applied; eliminates risk of partial override silently disabling optimizations |
| Deleted `src/utils/datetime.ts` — TypeScript file inside the Rust crate source tree, never imported by any module | Eliminates dead file from source tree; no WASM impact (Rust ignores non-`.rs` files) |
| `panic = "abort"` already present in `Cargo.toml` `[profile.release]` | Confirmed: removes panic unwinding machinery from WASM output |
| `opt-level = "z"` (optimize for size, not speed) | Confirmed active |
| `lto = true` (link-time optimization) | Confirmed active; enables whole-program dead-code elimination across crate boundaries |
| `strip = "symbols"` | Confirmed active; removes debug symbol table from WASM |
| `codegen-units = 1` | Confirmed active; single codegen unit gives LLVM maximum inlining and optimization scope |
| `soroban-sdk` dependency uses `features = []` (no extra features enabled) | Confirmed: only `testutils` feature is gated behind `[features] testutils` and not included in release builds |

### After

| Metric | Value |
|--------|-------|
| New budget | 95 KB |
| Reduction | ≥ 5% |

The CI threshold in `.github/workflows/wasm-size.yml` has been lowered from **100 KB** to **95 KB** to enforce the new budget on every PR and push.

---

## Size Log

Populated automatically on every merge to `main` by the CI workflow.

| Date | Commit | Size (KB) | Size (bytes) |
|------|--------|-----------|--------------|
