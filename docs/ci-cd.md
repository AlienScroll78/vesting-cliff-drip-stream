# CI/CD Pipeline

This document covers every GitHub Actions workflow in the repository, the quality gates each workflow enforces, how to reproduce checks locally, and the full deployment pipeline from a merged PR through to production.

---

## Table of Contents

- [Workflow overview](#workflow-overview)
- [Quality gates](#quality-gates)
  - [Required checks (PR merge blockers)](#required-checks-pr-merge-blockers)
  - [Optional / advisory checks](#optional--advisory-checks)
- [Running checks locally](#running-checks-locally)
- [Deployment pipeline](#deployment-pipeline)
  - [Staging](#staging)
  - [Production release](#production-release)
- [Branch protection rules](#branch-protection-rules)
- [Debugging a failing CI step](#debugging-a-failing-ci-step)

---

## Workflow overview

All workflow files live in [`.github/workflows/`](../.github/workflows/). The table below lists every workflow with its purpose and the events that trigger it.

| File | Purpose | Triggers |
|------|---------|---------|
| [`ci.yml`](#ciyml) | Core quality gate: lint, tests, WASM build, TypeScript typecheck | Push (all branches), PR |
| [`wasm-size.yml`](#wasm-sizeyml) | Verifies the optimized WASM binary stays ≤ 100 KB | Push (all branches), PR |
| [`e2e.yml`](#e2eyml) | Contract-level E2E against Stellar quickstart + Playwright frontend E2E | Push to `main`, PR to `main` |
| [`performance.yml`](#performanceyml) | WASM instruction counts, HTTP benchmarks, Lighthouse scores, regression gate | Push to `main`, PR |
| [`lighthouse.yml`](#lighthouseyml) | Dedicated Lighthouse CI audit with hard score thresholds | PR (all branches) |
| [`visual-regression.yml`](#visual-regressionyml) | Playwright screenshot comparison for the frontend | Push to `main` / PR (`frontend/**` paths) |
| [`audit.yml`](#audityml) | Vulnerability scan: `cargo audit`, `npm audit` (backend + frontend), Trivy Docker scan | PR, push to `main`, weekly (Mon 03:00 UTC) |
| [`codeql.yml`](#codeqlyml) | GitHub CodeQL SAST for Rust and JavaScript/TypeScript | PR, push to `main`, weekly (Sun 02:00 UTC) |
| [`license-scan.yml`](#license-scanyml) | License compliance check for all Rust and Node.js dependencies | PR, push to `main` |
| [`conventional-commits.yml`](#conventional-commitsyml) | Validates PR title against Conventional Commits format | PR (opened, edited, synchronize, reopened) |
| [`storybook.yml`](#storybookyml) | Builds Storybook, runs interaction tests, deploys to GitHub Pages | Push to `main`, PR to `main` |
| [`staging.yml`](#stagingyml) | Full staging deployment: WASM + Docker + contract + backend + frontend + smoke tests | Push to `main`, `workflow_dispatch` |
| [`release.yml`](#releaseyml) | Automated release management via release-please + WASM artifact attachment | Push to `main` |
| [`docker.yml`](#dockeryml) | Builds and pushes multi-arch Docker image to `ghcr.io`, runs Trivy scan | Push to `main` |
| [`container-registry.yml`](#container-registryyml) | Production-grade image build: Trivy pre-push scan, multi-arch, cosign signing, SLSA provenance | Release, push to `main`, `workflow_dispatch` |
| [`verify-image.yml`](#verify-imageyml) | Verifies cosign signature and SLSA provenance before staging deployment | After `Container Registry` completes, `workflow_dispatch` |
| [`helm-release.yml`](#helm-releaseyml) | Lints and packages Helm charts, publishes to the `gh-pages` Helm repository | Push to `main` (`helm/**` paths), `workflow_dispatch` |
| [`sbom.yml`](#sbomyml) | Generates merged SPDX 2.3 JSON SBOM (Rust + Node) and attaches it to the GitHub Release | Push to `main` (on release), `workflow_dispatch` |
| [`drift-detection.yml`](#drift-detectionyml) | Runs `terraform plan` against production; opens a GitHub issue and Slack alert on drift | Daily 02:00 UTC, `workflow_dispatch` |
| [`rds-backup.yml`](#rds-backupyml) | Creates a daily RDS snapshot; sends a Slack alert on failure | Daily 02:00 UTC, `workflow_dispatch` |

---

## Quality gates

### Required checks (PR merge blockers)

These four jobs are configured as required status checks on the `main` branch. A PR cannot be merged until all four pass.

| Check name | Workflow | What it validates |
|---|---|---|
| `lint` | `ci.yml` | `cargo fmt --check` + `cargo clippy -- -D warnings` |
| `contract-test` | `ci.yml` | Full Soroban test suite (`cargo test --features testutils`) |
| `build` | `ci.yml` | WASM compilation (`wasm32-unknown-unknown --release`) + `cargo doc` (zero warnings) |
| `typecheck` | `ci.yml` | TypeScript type-check in `frontend/` (`npm run typecheck`) |

The `wasm-size` job (from `wasm-size.yml`) is also a hard gate: if the optimized WASM binary exceeds **100 KB**, the step exits with an error. This check runs on every push and PR, and should be added to your branch protection required checks if you add new code paths to the contract.

### Optional / advisory checks

These checks run automatically but are not configured as merge blockers. They surface warnings and reports without preventing a merge.

| Workflow | Gate / threshold | Action on failure |
|---|---|---|
| `audit.yml` — `cargo-audit` | Any advisory (`--deny warnings`) | PR blocked; weekly run opens a GitHub issue |
| `audit.yml` — `npm-audit` | HIGH or CRITICAL in production deps | PR blocked; weekly run opens a GitHub issue |
| `audit.yml` — `trivy-scan` | HIGH or CRITICAL in Docker image | PR blocked; weekly run opens a GitHub issue |
| `codeql.yml` | Any CodeQL finding | Surfaced in GitHub Security tab; does not block merge by default |
| `license-scan.yml` | Any dependency carrying a disallowed license (see `.license-policy.json`) | PR blocked |
| `conventional-commits.yml` | PR title must match `<type>: <subject>` (lowercase) | PR check fails |
| `e2e.yml` — `contract-e2e` | E2E test suite exit code | Reported on PR; advisory |
| `e2e.yml` — `playwright-e2e` | Playwright test exit code | Reported on PR; Playwright report uploaded as artifact |
| `performance.yml` — `performance-gate` | Regression > 10% vs `benchmarks/baseline.json` | `check_perf.js` exits 1; comment posted on PR |
| `lighthouse.yml` | Performance ≥ 80, Accessibility ≥ 95, Best Practices ≥ 90, SEO ≥ 80 | Scores posted as PR comment; check fails if thresholds are not met |
| `visual-regression.yml` | No visual diffs vs. committed snapshots | Diff screenshots uploaded as artifacts on failure |
| `storybook.yml` — `test` | Storybook interaction tests | Advisory; `continue-on-error: true` |

---

## Running checks locally

The `Makefile` in the repository root provides targets that mirror what CI runs. Install prerequisites first:

```bash
rustup target add wasm32-unknown-unknown
# For E2E / mutation testing:
cargo install cargo-mutants --locked
cd frontend && npm install
```

### Core CI checks

```bash
# Format check (mirrors ci.yml "Format check")
cargo fmt --all -- --check

# Apply formatting if needed
make fmt

# Clippy lints (mirrors ci.yml "Clippy")
make lint
# equivalent: cargo clippy --all-targets --all-features -- -D warnings

# Unit + contract tests (mirrors ci.yml "Run contract tests")
make test
# equivalent: cargo test --features testutils

# WASM build (mirrors ci.yml "Build WASM")
make build
# equivalent: cargo build --target wasm32-unknown-unknown --release

# Rustdoc build with zero-warning enforcement (mirrors ci.yml "Docs")
make doc
# equivalent: RUSTDOCFLAGS="-D warnings" cargo doc --no-deps

# TypeScript typecheck (mirrors ci.yml "Typecheck")
cd frontend && npm run typecheck

# Type-check without compiling (fast feedback during development)
make check
```

### WASM size check

```bash
# Build + optimize + print size (mirrors wasm-size.yml)
make optimize
# The limit is 100 KB. Check size manually:
wc -c target/vesting_cliff_drip_stream.optimized.wasm
```

### Vulnerability scanning

```bash
# Rust dependency audit (mirrors audit.yml cargo-audit job)
cargo audit --deny warnings --config audit.toml

# Node.js audit – backend
cd backend && npm audit --audit-level=high --omit=dev

# Node.js audit – frontend
cd frontend && npm audit --audit-level=high --omit=dev
```

### License compliance

```bash
# Rust licenses
cargo install cargo-license --locked
cargo license --json > /tmp/rust-licenses.json
# Compare against .license-policy.json manually or use the CI script

# Node.js licenses (root)
npm install -g license-checker@25.0.1
license-checker --json --out /tmp/node-licenses-root.json

# Node.js licenses (frontend)
cd frontend && license-checker --json --out /tmp/node-licenses-frontend.json
```

### E2E tests

```bash
# Contract E2E against a local Stellar quickstart node
make test-e2e
# Requires Docker. Starts docker-compose.e2e.yml, runs tests, tears down.

# Playwright frontend E2E (Chromium + wallet mock)
make test-e2e-ui
# Requires Node.js. Installs deps in frontend/, then runs Playwright.

# Integration tests (indexer event pipeline)
make test-integration
# Requires Docker + a running local node.
```

### Mutation testing

```bash
# Run cargo-mutants on contract.rs and storage.rs (slow — ~10–30 min)
make mutants
# Results written to mutants.out/
# Install first: cargo install cargo-mutants --locked
```

### Contract spec test

```bash
# Validate the on-chain contract spec matches the expected API shape
make spec-test
```

---

## Deployment pipeline

### Staging

Every push to `main` triggers `staging.yml`. The pipeline stages are:

```
main push
    │
    ├─ [optional] reset-keypair   ← workflow_dispatch only (reset=true)
    │                               Generates a fresh Stellar testnet keypair,
    │                               funds via Friendbot, updates STELLAR_SECRET_KEY secret
    │
    ├─ build                       Build WASM → upload artifact
    ├─ docker                      Build Docker images → push to ghcr.io with staging-<sha> tag
    │
    ├─ deploy-contract             Download WASM → deploy to Stellar testnet via scripts/deploy.sh
    │                               Stores contract ID in VESTING_CONTRACT Actions variable
    │
    ├─ deploy-backend              Helm upgrade/install vesting-backend-staging (--atomic, 5m timeout)
    ├─ deploy-frontend             Helm upgrade/install vesting-frontend-staging (--atomic, 5m timeout)
    │
    ├─ smoke-test                  Runs scripts/smoke_test.sh against live staging URLs
    │
    ├─ notify  (smoke passed)      Posts PR comment with staging URL table
    └─ rollback (smoke failed)     helm rollback to previous revision
                                   Restores previous VESTING_CONTRACT variable
                                   Posts rollback notice on PR
```

Required secrets for staging:

| Secret | Description |
|---|---|
| `STELLAR_SECRET_KEY` | Testnet deployer key (starts with `S`) |
| `KUBECONFIG_STAGING` | Base64-encoded kubeconfig for the staging cluster |
| `GH_TOKEN` | Fine-grained PAT with Actions-variable write scope |

Staging URLs (defaults — update to match your ingress):
- Frontend: `https://staging.vesting.example.com`
- Backend API: `https://api.staging.vesting.example.com`

To reset staging to a fresh testnet keypair without a code push:

```bash
gh workflow run staging.yml -f reset=true
```

### Production release

Production releases follow the release-please automation pattern:

```
main push
    │
    ├─ release.yml
    │    ├─ release-please         Opens / updates a Release PR with CHANGELOG entries
    │    │                         (conventional commits drive the version bump)
    │    │
    │    └─ attach-wasm            Runs only when release-please creates a release tag
    │         build WASM → SHA256SUMS.txt → upload both to GitHub Release
    │
    ├─ container-registry.yml      Triggered on release publish
    │    ├─ scan                   Trivy pre-push scan (fails on HIGH/CRITICAL)
    │    ├─ build-push             Multi-arch build (amd64 + arm64)
    │    │                         Tags: latest, v1.2.3, 1.2, 1, <full-sha>
    │    │                         cosign keyless signing (OIDC via Sigstore)
    │    │                         SLSA L3 provenance attestation
    │    ├─ provenance             slsa-github-generator L3 attestation (isolated job)
    │    └─ pin-digest             Opens a PR pinning the image digest in K8s manifests
    │
    ├─ verify-image.yml            Triggered after container-registry completes
    │    ├─ verify                 cosign signature + SLSA provenance + GitHub attestation
    │    └─ deploy-staging         Applies K8s manifests only after successful verification
    │
    ├─ sbom.yml                    Triggered on release
    │    └─ generate-sbom          Generates SPDX 2.3 JSON SBOMs (Rust + Node)
    │                               Merges into sbom.spdx.json, uploads to GitHub Release
    │
    └─ helm-release.yml            Packages Helm charts, publishes to gh-pages Helm repo
```

The release-please PR title is the entry point. It uses the Conventional Commits in `CHANGELOG.md` to determine whether the version bump is `major`, `minor`, or `patch`. Merge the release-please PR to create the GitHub Release and kick off all downstream release workflows.

---

## Branch protection rules

The following rules are recommended for the `main` branch (Settings → Branches → Add rule):

| Rule | Setting |
|---|---|
| Require a pull request before merging | ✅ enabled |
| Require approvals | ≥ 1 reviewer |
| Dismiss stale reviews when new commits are pushed | ✅ enabled |
| Require status checks to pass before merging | ✅ enabled |
| Required status checks | `lint`, `contract-test`, `build`, `typecheck` |
| Require branches to be up to date before merging | ✅ recommended |
| Require conversation resolution before merging | ✅ recommended |
| Do not allow bypassing the above settings | ✅ enabled (prevents admin force-merges) |

The `conventional-commits.yml` check (PR title validation) should also be added to required status checks if your team uses Conventional Commits to drive releases.

> The `wasm-size` check (`wasm-size.yml` / job `wasm-size`) should be added to required checks whenever the contract binary is expected to remain under 100 KB — it is an effective size regression guard.

---

## Debugging a failing CI step

### 1. Read the step output first

Click the failing job in the GitHub Actions run. Expand the failing step. Most failures print the exact error on the last few lines.

### 2. Reproduce locally

Every CI check has a local equivalent. Use the commands in [Running checks locally](#running-checks-locally) to reproduce the failure in your development environment before pushing.

Common issues and their local repros:

| CI failure | Local reproduction |
|---|---|
| `lint` fails (`cargo fmt`) | `cargo fmt --all -- --check` → then `make fmt` and commit |
| `lint` fails (`clippy`) | `make lint` — fix all warnings (CI uses `-D warnings`) |
| `contract-test` fails | `make test` — run with `RUST_BACKTRACE=1 make test` for stack traces |
| `build` fails (WASM) | `make build` |
| `build` fails (docs) | `make doc` |
| `typecheck` fails | `cd frontend && npm run typecheck` |
| WASM size exceeds 100 KB | `make optimize && wc -c target/vesting_cliff_drip_stream.optimized.wasm` |
| `cargo audit` fails | `cargo audit --deny warnings --config audit.toml` |
| License scan fails | Check `.license-policy.json` — add a new license to `allowed` or an exception to `explicit_exceptions` |
| E2E tests fail | `make test-e2e` (requires Docker) or `make test-e2e-ui` (requires Node) |
| Performance regression | Run `node scripts/check_perf.js --results benchmarks/results.json --baseline benchmarks/baseline.json` |

### 3. Download CI artifacts

Failing jobs often upload detailed reports as workflow artifacts. Retrieve them from the GitHub Actions run page:

| Workflow | Artifact name | Contents |
|---|---|---|
| `audit.yml` | `cargo-audit-<run-id>` | Full `cargo audit` log |
| `audit.yml` | `npm-audit-backend-<run-id>` | `npm audit` JSON report |
| `audit.yml` | `trivy-sarif-<run-id>` | Trivy SARIF findings |
| `e2e.yml` | `playwright-report` | HTML Playwright report with screenshots |
| `performance.yml` | `performance-report` | `report.md` delta table + `merged.json` |
| `lighthouse.yml` | `lighthouse-results` | Raw Lighthouse CI output |
| `visual-regression.yml` | `playwright-visual-diffs` | Screenshot diffs |
| `staging.yml` | `deploy-log-<run-id>` | Full Stellar CLI deploy output |

```bash
# Download an artifact using the GitHub CLI
gh run download <run-id> --name <artifact-name>
```

### 4. Cargo cache invalidation

If a Rust build fails with an unexpected compile error that does not reproduce locally, the CI cargo cache may be stale. Re-run the workflow with `cache: false` in the cache step temporarily, or trigger a new run after the cache key changes (e.g. after updating `Cargo.lock`).

### 5. Staging smoke test failures

If the `smoke-test` job in `staging.yml` fails:

1. Open the workflow run and expand the `Run smoke tests` step.
2. Download the `deploy-log-<run-id>` artifact to confirm the contract was deployed with the correct ID.
3. Check the Stellar testnet explorer (`https://stellar.expert/explorer/testnet`) for the contract ID stored in the `VESTING_CONTRACT` Actions variable.
4. The rollback job runs automatically. Verify the previous Helm revision is active:

   ```bash
   helm history vesting-backend-staging -n staging
   helm history vesting-frontend-staging -n staging
   ```

5. To reset staging to a known-good state, trigger `staging.yml` manually with `reset=true`.

### 6. Container verification failures

If `verify-image.yml` fails after a release:

```bash
# Install cosign
brew install cosign   # or: go install sigstore/cosign/cmd/cosign@latest

# Verify signature manually
COSIGN_EXPERIMENTAL=1 cosign verify \
  --certificate-identity-regexp="https://github.com/<org>/<repo>/.github/workflows/container-registry.yml@refs/.*" \
  --certificate-oidc-issuer="https://token.actions.githubusercontent.com" \
  ghcr.io/<org>/<repo>@<digest>

# Verify SLSA provenance
COSIGN_EXPERIMENTAL=1 cosign verify-attestation \
  --type slsaprovenance \
  --certificate-identity-regexp="https://github.com/slsa-framework/slsa-github-generator/.github/workflows/generator_container_slsa3.yml@refs/tags/v.*" \
  --certificate-oidc-issuer="https://token.actions.githubusercontent.com" \
  ghcr.io/<org>/<repo>@<digest>
```

### 7. Infrastructure drift

If the `drift-detection.yml` workflow opens a GitHub issue:

1. Review the `terraform plan` output attached to the issue.
2. Follow the [Drift Reconciliation runbook](runbooks/drift-reconciliation.md) to evaluate whether the drift is intentional.
3. Apply or revert the changes as described in the runbook.
4. Close the issue once resolved.
