# Contributing to Vesting Cliff Drip Stream

Thank you for contributing! This guide covers everything you need to go from a clean checkout to an approved PR.

---

## Table of Contents

- [Prerequisites](#prerequisites)
- [Getting Started](#getting-started)
- [Local Development Setup](#local-development-setup)
  - [1. Configure environment variables](#1-configure-environment-variables)
  - [2. Start infrastructure with Docker Compose](#2-start-infrastructure-with-docker-compose)
  - [3. Install backend dependencies and run migrations](#3-install-backend-dependencies-and-run-migrations)
  - [4. Start the backend](#4-start-the-backend)
  - [5. Start the frontend](#5-start-the-frontend)
- [Build](#build)
- [Tests](#tests)
  - [Contract tests (Rust)](#contract-tests-rust)
  - [Backend tests (Node.js)](#backend-tests-nodejs)
  - [Frontend tests](#frontend-tests)
  - [End-to-end tests](#end-to-end-tests)
  - [Load tests](#load-tests)
- [Deploy Contract to Testnet](#deploy-contract-to-testnet)
- [Code Style](#code-style)
- [Submitting a Pull Request](#submitting-a-pull-request)
- [PR Workflow Details](#pr-workflow-details)
- [Branch Protection on `main`](#branch-protection-on-main)
- [Troubleshooting](#troubleshooting)
- [Admin Override](#admin-override)
- [Stellar Wave Program](#stellar-wave-program)
- [Security Issues](#security-issues)
- [Code of Conduct](#code-of-conduct)

---

## Prerequisites

| Tool | Minimum Version | Install |
|------|---------|---------|
| Rust | stable (≥ 1.78) | `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \| sh` |
| wasm32 target | — | `rustup target add wasm32-unknown-unknown` |
| Stellar CLI | ≥ 21.x | [Install guide](https://developers.stellar.org/docs/tools/developer-tools/cli/install-cli) |
| Node.js | ≥ 20 | [nodejs.org](https://nodejs.org) |
| Docker + Compose | any recent | [docs.docker.com](https://docs.docker.com/get-docker/) |

Verify your setup:

```bash
rustc --version          # rustc 1.x.x (...)
cargo --version
rustup target list --installed | grep wasm32-unknown-unknown
stellar --version        # stellar 21.x.x
node --version           # v20.x.x or higher
docker --version
docker compose version
```

---

## Getting Started

```bash
git clone https://github.com/AlienScroll78/vesting-cliff-drip-stream.git
cd vesting-cliff-drip-stream
```

---

## Local Development Setup

Follow these steps in order the first time you set up the project.

### 1. Configure environment variables

Copy the example file and fill in the required values:

```bash
cp .env.example .env
```

Open `.env` and set at minimum:

```dotenv
# Required for the backend to start
VESTING_CONTRACT_ID=        # leave blank until you deploy the contract (step 5)
DATABASE_URL=postgres://vesting:vesting@localhost:5432/vesting
REDIS_URL=redis://localhost:6379
JWT_SECRET=dev-only-secret-at-least-32-characters-long
WEBHOOK_SECRET=dev-only-webhook-secret-16chars
```

For `HORIZON_URL`, `SOROBAN_RPC_URL`, and `NETWORK_PASSPHRASE` the defaults in `.env.example` already point to the public testnet — leave them as-is for local development against testnet.

See [docs/config.md](docs/config.md) for a full description of every variable.

### 2. Start infrastructure with Docker Compose

`docker-compose.yml` defines two services:

| Service | Image | Port | Purpose |
|---------|-------|------|---------|
| `postgres` | `postgres:16-alpine` | `5432` | PostgreSQL database for the event indexer |
| `backend` | local Dockerfile | `3001` | Optional — the compiled backend. Prefer `npm run dev` for development (hot reload). |

Start only the database (recommended for local development):

```bash
docker compose up -d postgres
```

Or start everything including the backend container:

```bash
docker compose up -d
```

Check that services are healthy:

```bash
docker compose ps
# postgres should show "healthy"

# If you started the backend container:
curl http://localhost:3001/health
# {"status":"ok"}
```

To stop services:

```bash
docker compose down
```

To stop and delete all data (reset the database):

```bash
docker compose down -v
```

> **Note:** The `backend` service in docker-compose uses the compiled Dockerfile image. For active development with hot reload, run the backend directly with `npm run dev` (step 4) after starting only `postgres`.

### 3. Install backend dependencies and run migrations

```bash
cd backend
npm install
```

Run database migrations to create the schema:

```bash
# Using the node-pg-migrate CLI
DATABASE_URL=postgres://vesting:vesting@localhost:5432/vesting \
  npx node-pg-migrate up --migrations-dir migrations --migration-file-language ts
```

You should see output like:

```
> Migrating files:
> - 001_create_vesting_streams
> - 002_create_claim_events
> - 003_add_cancelled_at_to_streams
> Running migrations up...
✔ Done
```

### 4. Start the backend

From the `backend/` directory:

```bash
npm run dev
```

You should see:

```
[server] Active network: testnet
[server] RPC: https://soroban-testnet.stellar.org
[server] Listening on :3001
[server] WebSocket: ws://0.0.0.0:3001/ws/claimable
```

Verify it is running:

```bash
curl http://localhost:3001/health
# {"status":"ok","uptime":...}
```

### 5. Start the frontend

In a separate terminal, from the repo root:

```bash
cd frontend
npm install
```

Create a frontend-specific env file:

```bash
cat > frontend/.env << 'EOF'
VITE_API_URL=http://localhost:3001
VITE_NETWORK=testnet
VITE_CONTRACT_ID=          # fill in after deploying contract
VITE_HORIZON_URL=https://horizon-testnet.stellar.org
EOF
```

Start the dev server:

```bash
npm run dev
```

The frontend is now available at `http://localhost:5173`.

---

## Build

```bash
# Compile the contract to WASM
make build

# Optimize the WASM binary (requires stellar CLI)
make optimize
```

The optimized binary is written to `target/vesting_cliff_drip_stream.optimized.wasm`.

To build the backend TypeScript:

```bash
cd backend && npm run build
```

---

## Tests

### Contract tests (Rust)

```bash
# Run all unit tests (native target — fastest)
make test

# Run tests through the Soroban WASM runner (same target as on-chain)
make spec-test        # builds WASM first automatically

# Lint — zero warnings policy
make lint

# Format check
cargo fmt --all -- --check

# Mutation testing
make mutants
```

### Backend tests (Node.js)

```bash
cd backend

# All unit + integration tests
npm test

# Watch mode during development
npx vitest

# With coverage report
npm run coverage

# Property-based tests only
npm run test:property

# Horizon resilience tests (requires WireMock — see docker-compose.toxiproxy.yml)
npm run test:resilience
```

### Frontend tests

```bash
cd frontend

# Unit tests with Vitest + Testing Library
npx vitest run

# Watch mode
npx vitest

# Type checking
npm run typecheck
```

### End-to-end tests

E2E tests require Docker (for the local Stellar quickstart node) and all services running.

```bash
# Start the full E2E environment
docker compose -f docker-compose.e2e.yml up -d

# Run Playwright E2E tests
make test-e2e

# Run with UI (headed browser)
make test-e2e-ui

# Run visual regression tests
cd frontend && npm run test:visual

# Update visual snapshots (after intentional UI changes)
cd frontend && npm run test:visual:update
```

### Load tests

See [`tests/load/README.md`](tests/load/README.md) for running k6 and Locust load scenarios.

---

## Deploy Contract to Testnet

1. **Generate and fund a testnet keypair:**

   ```bash
   stellar keys generate default --network testnet --fund
   stellar keys address default
   # GABC...XYZ  ← your deployer address
   ```

2. **Build and optimize the contract:**

   ```bash
   make build
   make optimize
   ```

3. **Deploy to testnet:**

   ```bash
   ./scripts/deploy.sh default
   # Contract deployed: CABC...XYZ  ← copy this
   ```

4. **Set the contract ID in your environment:**

   ```bash
   # In .env
   VESTING_CONTRACT_ID=CABC...XYZ

   # In frontend/.env
   VITE_CONTRACT_ID=CABC...XYZ
   ```

5. **Invoke the contract:**

   ```bash
   export VESTING_CONTRACT=CABC...XYZ
   export SPONSOR=default
   export RECIPIENT=G...           # recipient public key
   export TOKEN=C...               # SAC token address
   export RATE=10
   export CLIFF_DURATION=17280     # ~1 day at 5 s/ledger
   export TOTAL_DURATION=172800    # ~10 days

   ./scripts/invoke_create.sh      # create a vesting stream
   ./scripts/invoke_claim.sh       # claim vested tokens
   ```

---

## Code Style

**Rust**
- Follow `rustfmt` defaults — enforced by `cargo fmt --all`.
- Clippy with `--all-targets --all-features -- -D warnings` must pass with zero warnings.
- Use `checked_*` arithmetic for any value that can overflow.
- Add a doc comment (`///`) to every public function and type.

**TypeScript / CSS**
- Match the style of the surrounding file.
- No new dependencies without discussion in an issue first. See the [SBOM & License Compliance](docs/sbom.md#contributor-guide--adding-dependencies) guide for how to add dependencies correctly.

**Commit messages** — [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add multi-token support
fix: clamp claimable amount at stream end
docs: update restore runbook
chore: bump soroban-sdk to 22.0
```

Append `!` or add `BREAKING CHANGE:` in the footer for breaking changes.

---

## Changelog and Release Notes

This repository maintains a structured `CHANGELOG.md` and uses a standardized release notes template in `.github/release-notes-template.md`.

### What goes in each section
- `Breaking Changes`: incompatible API or behavior changes, required migrations, or removals. Use `BREAKING CHANGE:` in the commit body or `!` in the commit header.
- `New Features`: new entry points, view functions, UI behavior, or capabilities added in a backwards-compatible way. Use `feat:`.
- `Bug Fixes`: correctness fixes, stability improvements, and bug resolutions. Use `fix:`.
- `Security`: vulnerability fixes, hardening, and security-related remediation. Use `security:`.
- `Deprecations`: deprecated APIs, behaviors, or configuration that will be removed in a future major release. Use `deprecate:` or `feat!:` with a clear deprecation note.
- `Performance`: measurable performance or efficiency improvements. Use `perf:`.
- `Miscellaneous`: internal maintenance, tooling, docs, and other non-user-facing work. These are hidden in the changelog when generated automatically.

### Writing changelog entries
- Use short, imperative phrasing: `Add ...`, `Fix ...`, `Deprecate ...`.
- Describe the impact for users or operators, not just implementation details.
- Reference issues and PRs using `#123`, `PR #456`, or `owner/repo#123` when relevant.
- Prefer `Closes #<issue>` in PR descriptions to link issues automatically.
- Use backticks for code artifacts: `create_vesting_stream`, `VestingSchedule`, `CliffNotReached`.

### Semantic versioning policy
- `MAJOR` bump for incompatible API/behavior changes, removals, or any `BREAKING CHANGE:` commit.
- `MINOR` bump for new features and backwards-compatible improvements.
- `PATCH` bump for bug fixes, documentation changes, tests, and non-behavioral maintenance.
- Let release automation infer the release type from commit metadata when possible.

### Release automation
- This repository uses `release-please` and the configuration in `release-please-config.json`.
- `release-please` reads commit types and changelog sections from `release-please-config.json` to generate release PRs, tags, and changelog entries.
- Breaking changes are inferred from `!` in commit headers or `BREAKING CHANGE:` in commit bodies.
- Keep PR titles, commit messages, and changelog entries aligned with the section conventions above.

---

## Submitting a Pull Request

1. Fork or create a feature branch (see [PR Workflow Details](#pr-workflow-details) for naming).
2. Make your changes and write tests for new behaviour.
3. Run `make test && make lint` locally — fix any failures before pushing.
4. Open a PR against `main` using the PR template.
5. Address review feedback; keep the branch up to date with `main`.
6. Squash-merge preferred; no force pushes to shared branches.

---

## PR Workflow Details

### Branch naming

| Type | Pattern | Example |
|------|---------|---------|
| Feature | `feat/issue-N-short-description` | `feat/issue-297-export-endpoints` |
| Bug fix | `fix/issue-N-short-description` | `fix/issue-301-cliff-math` |
| Documentation | `docs/issue-N-short-description` | `docs/issue-336-config-reference` |
| Chore / deps | `chore/short-description` | `chore/bump-soroban-sdk` |
| Hotfix | `hotfix/short-description` | `hotfix/null-sponsor-crash` |

### Commit style

Use [Conventional Commits](https://www.conventionalcommits.org/). The `conventional-commits` CI check enforces this on every PR.

```
<type>(<optional scope>): <description>

[optional body]

[optional footer: Closes #N, BREAKING CHANGE: ...]
```

Common types: `feat`, `fix`, `docs`, `test`, `chore`, `refactor`, `perf`, `ci`.

### What to include in the PR description

Use the [pull request template](.github/pull_request_template.md). At minimum:

- **Summary:** What changed and why.
- **Testing:** How you verified the change (test output, manual steps, screenshots).
- **Closes:** `Closes #<issue-number>` — required for Stellar Wave reward allocation.

### Review process

- 1 approving review required before merge.
- All CI checks must be green (`test`, `build`, `lint`, `conventional-commits`).
- Branch must be up to date with `main` before merging.
- Dismiss stale reviews: any new push resets the approval.

---

## Branch Protection on `main`

| Rule | Setting |
|------|---------|
| Require pull request | ✅ |
| Required approving reviews | 1 |
| Dismiss stale reviews on new push | ✅ |
| Require CI to pass before merge | ✅ (`test`, `build` checks) |
| Require branch to be up to date | ✅ |
| Allow force push | ❌ |
| Allow branch deletion | ❌ |

To (re-)apply protection rules after a fresh clone:

```bash
export GITHUB_TOKEN=<pat-with-repo-scope>
export REPO=AlienScroll78/vesting-cliff-drip-stream
bash scripts/apply_branch_protection.sh
```

---

## Troubleshooting

### 1. PostgreSQL port 5432 is already in use

```
Error: listen tcp4 0.0.0.0:5432: bind: address already in use
```

Find and stop the conflicting process:

```bash
# Find what is using port 5432
sudo lsof -i :5432
# or
sudo ss -tlnp | grep 5432

# Stop a locally running Postgres
sudo systemctl stop postgresql

# Or change the mapped port in docker-compose.yml:
#   ports: ["5433:5432"]
# Then update DATABASE_URL to use port 5433
```

### 2. `DATABASE_URL connection refused` / backend fails to start

Checklist:
1. Is Postgres running? `docker compose ps` — the `postgres` service must show `(healthy)`.
2. Did you wait for the health check? Postgres takes a few seconds to accept connections on first start.
3. Is `DATABASE_URL` set in your `.env`? Check with `grep DATABASE_URL .env`.
4. Is the port correct? Default is `5432`. If you changed it in docker-compose, update the URL.
5. Try connecting manually: `psql postgres://vesting:vesting@localhost:5432/vesting -c '\l'`

### 3. `stellar: command not found`

The Stellar CLI is not installed or not in your `PATH`.

```bash
# Install via cargo
cargo install --locked stellar-cli --features opt

# Or follow the official guide:
# https://developers.stellar.org/docs/tools/developer-tools/cli/install-cli

# Verify
stellar --version
```

### 4. WASM build fails — `wasm32-unknown-unknown` target missing

```
error[E0463]: can't find crate for `std`
  = note: the `wasm32-unknown-unknown` target may not be installed
```

```bash
rustup target add wasm32-unknown-unknown
# Verify
rustup target list --installed | grep wasm32
```

### 5. Backend fails with `JWT_SECRET: String must contain at least 32 character(s)`

The Zod config schema requires `JWT_SECRET` to be at least 32 characters. Generate a proper secret:

```bash
openssl rand -base64 32
# e.g.: 4K8xZp3mN1qRvWcL7tYeAhJdBsGuFnOi...

# Then set it in .env:
JWT_SECRET=<output from above>
```

### 6. Rate limiting errors / auth nonces not working — Redis connection refused

Redis is required for rate limiting and auth nonce storage. If `REDIS_URL` is not set or Redis is not running, these features will fail.

```bash
# Start Redis via Docker
docker compose up -d redis

# Or if redis is not in docker-compose.yml, start it directly:
docker run -d -p 6379:6379 redis:7-alpine

# Set in .env:
REDIS_URL=redis://localhost:6379

# Test the connection:
redis-cli -u redis://localhost:6379 ping
# PONG
```

### 7. `node-pg-migrate: command not found` / migrations fail

```bash
# Install dependencies first
cd backend && npm install

# Then run migrations with npx:
DATABASE_URL=postgres://vesting:vesting@localhost:5432/vesting \
  npx node-pg-migrate up --migrations-dir migrations --migration-file-language ts
```

### 8. Frontend build error — `VITE_CONTRACT_ID not set`

The frontend expects `VITE_CONTRACT_ID` to be set at build time. For local development before deploying the contract, you can use a placeholder:

```bash
# frontend/.env
VITE_CONTRACT_ID=CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
```

Replace with your real contract ID after deploying (see [Deploy Contract to Testnet](#deploy-contract-to-testnet)).

---

## Admin Override

Admins can merge without a review in exceptional circumstances (incident hotfix, CI outage):

1. `enforce_admins: false` allows admins to bypass review requirements.
2. **Document the reason** in the PR using the `## Emergency Merge` section.
3. Follow up within 24 hours with a normal PR that adds or confirms tests.
4. Post a note in `#eng-oncall` linking the PR.

---

## Stellar Wave Program

This repository participates in the **[Stellar Wave Program](docs/stellar-wave.md)** — a monthly one-week contribution sprint run by the [Stellar Development Foundation](https://stellar.org/foundation) via [Drips Wave](https://drips.network/wave). Contributors earn a share of a reward pool for resolving labelled issues.

### Finding Wave issues

Issues in scope for the current Wave carry the **`Stellar Wave`** label. Browse them directly:

```
https://github.com/AlienScroll78/vesting-cliff-drip-stream/labels/Stellar%20Wave
```

Or discover issues across all participating repos on the [Drips Wave Explore page](https://drips.network/wave).

### Quick-start for contributors

1. Complete **KYC** in [Settings → Profile](https://drips.network/wave) on the Drips Wave app (required before applying).
2. Find an issue with the `Stellar Wave` label and click **Apply** in the app with a short message.
3. Wait to be assigned — do not start coding until the maintainer assigns you.
4. Open a PR against `main` following the standard workflow above.
5. Include `Closes #<issue-number>` in your PR description — this is how Points are allocated.
6. After the Wave ends, withdraw your rewards from the Drips Wave app.

### Points and rewards

| Complexity | Points |
|------------|--------|
| Trivial    | 100    |
| Medium     | 150    |
| High       | 200    |

Your payout = `(your points / total points in wave) × reward budget`.

### The `Stellar Wave` label

The label is applied by **maintainers only**, either through the Drips Wave app or directly on GitHub. Do not add or remove it yourself.

For the full details — qualifying criteria, submission requirements, application limits, and FAQ — see **[docs/stellar-wave.md](docs/stellar-wave.md)**.

---

## Security Issues

Please **do not** open a public issue for security vulnerabilities. See [SECURITY.md](SECURITY.md) for the responsible-disclosure process.

---

## Code of Conduct

This project follows the [Contributor Covenant 2.1](CODE_OF_CONDUCT.md). Be kind.
