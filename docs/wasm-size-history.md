# WASM Size History

Tracks the optimized WASM binary size for `vesting_cliff_drip_stream` on every merge to `main`.

New rows are appended automatically by the [`wasm-size-history`](./../.github/workflows/wasm-size.yml)
CI job. You can also run the check locally:

```bash
make check-wasm-size                     # enforce 50 KB default
make check-wasm-size MAX_WASM_SIZE_KB=60 # custom threshold
```

The configurable threshold is controlled by `MAX_WASM_SIZE_KB` in
[`.github/workflows/wasm-size.yml`](../.github/workflows/wasm-size.yml) (default: **50 KB**).

| Date | Commit | Size (KB) | Size (bytes) |
|------|--------|-----------|--------------|
