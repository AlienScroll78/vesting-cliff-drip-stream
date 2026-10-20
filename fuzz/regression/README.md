# Fuzz Regression Inputs

This directory contains crash inputs that were found by the fuzz targets and
committed as regression tests. Each sub-directory corresponds to a fuzz target.

## Layout

```
regression/
├── README.md          (this file)
├── create_vesting_stream/   crash inputs for fuzz_create
├── claim_vested/            crash inputs for fuzz_claim
├── cancel_stream/           crash inputs for fuzz_cancel
└── metadata_validation/     crash inputs for fuzz_metadata
```

## Adding a crash input

When a fuzzer finds a crash:

1. The input is automatically saved under `fuzz/artifacts/<target>/crash-<hash>`.
2. Reproduce locally:

   ```bash
   cargo fuzz run <target> fuzz/artifacts/<target>/crash-<hash>
   ```

3. Once confirmed, copy the input into the corresponding `regression/<target>/`
   sub-directory and give it a descriptive name:

   ```bash
   cp fuzz/artifacts/<target>/crash-<hash> \
      fuzz/regression/<target>/<descriptive-name>
   ```

4. Commit the regression input alongside a fix. The CI fuzz job replays all
   regression inputs on every run to prevent regressions.

## Replaying all regression inputs

```bash
# Run every regression corpus entry for a target (no time limit – exits after corpus)
cargo fuzz run create_vesting_stream fuzz/regression/create_vesting_stream/
cargo fuzz run claim_vested          fuzz/regression/claim_vested/
cargo fuzz run cancel_stream         fuzz/regression/cancel_stream/
```
