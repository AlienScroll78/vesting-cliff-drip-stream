# Developer Onboarding Guide

> **Estimated setup time:** about 30 minutes to a running local stack; dependency downloads vary by connection.
>
> This guide walks a new contributor through the local development environment.
> Commands use a POSIX shell and Docker Compose v2.
>
> **Related docs:**
> - [Architecture Overview](architecture.md) — understand the system before changing it
> - [CONTRIBUTING.md](../CONTRIBUTING.md) — PR rules, branch policy, and commit conventions
> - [ADR Index](adr/README.md) — key design decisions

---

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [Repository Setup](#2-repository-setup)
3. [Local Environment](#3-local-environment-docker-compose)
4. [Running Tests](#4-running-tests)
5. [Making Changes](#5-making-changes)
6. [Testnet Deployment](#6-testnet-deployment)
7. [Troubleshooting](#7-troubleshooting)
8. [Architecture Overview](#8-architecture-overview)

---

## 1. Prerequisites

### Required versions

| Tool | Minimum | Install command |
|------|---------|----------------|
| Rust and Cargo | 1.84+ | `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \| sh` |
| WASM target | — | `rustup target add wasm32-unknown-unknown` |
| Stellar CLI | 21.3.0 | Install the release matching your OS from [Stellar CLI releases](https://github.com/stellar/stellar-cli/releases/tag/v21.3.0). |
| Node.js and npm | Node.js 22 LTS, npm 10+ | Install Node.js 22 LTS from [nodejs.org](https://nodejs.org/). |
| Docker Engine | 25+ | Install Docker Engine for your OS. |
| Docker Compose | v2.24+ | Install the Compose v2 plugin with Docker. |
| PostgreSQL | 16 | Started by the repository's Compose configuration. |
| Redis | 7 | Started by the repository's Compose configuration. |

### 1.1 Rust & WASM target

```bash
# Install Rust (if not already installed)
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
source "$HOME/.cargo/env"

# Add the WASM compile target required for Soroban
rustup target add wasm32-unknown-unknown

# Verify
rustc --version     # rustc 1.84.x or newer
cargo --version
```

### 1.2 Stellar CLI 21.3.0

```bash
## Or use the prebuilt 21.3.0 release for your platform:
## https://github.com/stellar/stellar-cli/releases/tag/v21.3.0

# Add $HOME/.cargo/bin to PATH if not already present
echo 'export PATH="$HOME/.cargo/bin:$PATH"' >> ~/.bashrc  # bash
echo 'export PATH="$HOME/.cargo/bin:$PATH"' >> ~/.zshrc   # zsh
source ~/.bashrc  # or ~/.zshrc

stellar --version   # stellar 21.3.0
```

### 1.3 Node.js 22 LTS

**Ubuntu / Debian:**

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
node --version   # v22.x.x
npm --version    # 10.x.x or newer
```

**macOS:**

```bash
# via Homebrew
brew install node@22
echo 'export PATH="/opt/homebrew/opt/node@22/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc
node --version
```

### 1.4 Docker Engine 25+ & Docker Compose v2.24+

**Ubuntu / Debian:**

```bash
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
  -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc

echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] \
  https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io \
  docker-buildx-plugin docker-compose-plugin

# Allow your user to run docker without sudo
sudo usermod -aG docker "$USER"
newgrp docker   # activate immediately (or log out and back in)
```

**macOS:** Download and install [Docker Desktop](https://www.docker.com/products/docker-desktop/).

### 1.5 Verify all prerequisites

```bash
rustc --version
rustup target list --installed | grep wasm32-unknown-unknown
stellar --version
node --version
npm --version
docker --version
docker compose version
```

All commands should succeed before continuing.

---

## 2. Repository Setup

### 2.1 Clone

```bash
git clone https://github.com/AlienScroll78/vesting-cliff-drip-stream.git
cd vesting-cliff-drip-stream
```

### 2.2 Configure environment values

```bash
cp .env.example .env
```

The backend example has safe local-development values. Copy it and replace the
placeholder contract IDs after testnet deployment (or keep them as placeholders
if you are not using contract-backed backend routes):

```bash
cp backend/.env.testnet.example backend/.env
```

Required backend variables are:

| Variable | Example | Purpose |
|---|---|---|
| `HORIZON_URL` | `https://horizon-testnet.stellar.org` | Stellar Horizon endpoint |
| `SOROBAN_RPC_URL` | `https://soroban-testnet.stellar.org` | Soroban RPC endpoint |
| `NETWORK_PASSPHRASE` | `Test SDF Network ; September 2015` | Network for signing and RPC |
| `VESTING_CONTRACT_ID` | `<testnet-contract-id>` | Contract configured for backend services |
| `TESTNET_CONTRACT_ID` | `<testnet-contract-id>` | Contract ID read by backend network selection; use the same ID |
| `DATABASE_URL` | `postgres://vesting:vesting@localhost:5432/vesting` | Local PostgreSQL |
| `REDIS_URL` | `redis://localhost:6379` | Local Redis |
| `JWT_SECRET` | `dev-only-secret-at-least-32-characters-long` | Local-only JWT secret, minimum 32 characters |
| `WEBHOOK_SECRET` | `dev-only-webhook-secret-16chars` | Local-only HMAC secret, minimum 16 characters |
| `PORT` | `3001` | Backend HTTP port |

### 2.3 Frontend environment

```bash
cat > frontend/.env.local << 'EOF'
VITE_API_URL=http://localhost:3001
VITE_NETWORK=testnet
VITE_CONTRACT_ID=<testnet-contract-id>
VITE_HORIZON_URL=https://horizon-testnet.stellar.org
EOF
```

`VITE_API_URL`, `VITE_CONTRACT_ID`, and `VITE_HORIZON_URL` are required by the
frontend. These values are public client configuration, not secrets.

| Variable | Example | Description |
|---|---|---|
| `VITE_API_URL` | `http://localhost:3001` | Local backend base URL |
| `VITE_NETWORK` | `testnet` | Stellar network selected by the app |
| `VITE_CONTRACT_ID` | `<testnet-contract-id>` | Deployed contract address |
| `VITE_HORIZON_URL` | `https://horizon-testnet.stellar.org` | Horizon endpoint for client-side queries |

### 2.4 Verify build

```bash
# Compile the smart contract (native target — fast, no WASM needed for this step)
cargo check --lib

# Build the production WASM
make build

# Install all JavaScript dependencies and start local services
make setup
```

Expected output from `make build`: a `.wasm` file under
`target/wasm32-unknown-unknown/release/`.

---

## 3. Local Environment (Docker Compose)

The `docker-compose.yml` at the repo root provides PostgreSQL and Redis for
the backend indexer. You only need this if you are working on the backend API
or end-to-end tests.

```bash
# Start PostgreSQL and Redis in the background
docker compose up -d postgres redis

# Verify both containers are healthy
docker compose ps postgres redis
# NAME                          STATUS
# vesting-cliff-drip-stream-postgres-1   running (healthy)
# vesting-cliff-drip-stream-redis-1      running

# Apply database migrations
cd backend
npm install
DATABASE_URL=postgres://vesting:vesting@localhost:5432/vesting \
  npx node-pg-migrate up \
    --migrations-dir migrations \
    --migration-file-language ts
cd ..
```

### Tearing down

```bash
docker compose down          # stop containers, keep volumes
docker compose down -v       # stop containers AND delete volumes (fresh DB)
```

---

### Start the backend

After copying `backend/.env.testnet.example` to `backend/.env` and setting both
contract ID variables as described above, start the backend from the repository
root:

```bash
cd backend
node --env-file=.env --loader tsx src/server.ts
```

You should now see the backend announce its active network and listening port.
In another terminal, confirm its health endpoint:

```bash
curl -i http://localhost:3001/health
```

You should receive an HTTP 200 response. Leave the backend process running.

### Start the frontend

Create `frontend/.env.local` as described in Section 2.3, then start Vite from
the repository root:

```bash
npm --prefix frontend run dev -- --host 0.0.0.0
```

You should now see Vite print `http://localhost:5173`. Open that address in a
browser to view the app.

## 4. Running Tests

### 4.1 Smart-contract unit tests (the most common workflow)

```bash
# Run all contract tests (native host — no WASM runner needed)
make test
# Equivalent: cargo test --features testutils

# Run a single test by name
cargo test --features testutils test_golden_path_10_day_vesting -- --nocapture

# Run tests in a specific module
cargo test --features testutils tests::test_claim

# Faster iterative loop with cargo-watch (install once: cargo install cargo-watch)
cargo watch -x 'test --features testutils'
```

Expected output ends with `test result: ok. N passed; 0 failed`.

### 4.2 Code quality

```bash
# Format check (zero diff expected)
cargo fmt --all -- --check

# Auto-format
cargo fmt --all

# Clippy lints (zero warnings enforced in CI)
make lint
# Equivalent: cargo clippy --all-targets --all-features -- -D warnings
```

### 4.3 Backend unit tests

```bash
cd backend
npm test               # node --test test/schedules.test.ts
cd ..
```

### 4.4 Frontend unit tests

```bash
cd frontend
npm test               # vitest run
npm run typecheck      # tsc --noEmit
cd ..
```

### 4.5 Integration tests (requires running Docker services)

```bash
# Start required services first (see Section 3)
docker compose up -d postgres redis

# Node.js integration tests (indexer pipeline, schedule versioning)
make test-integration

# End-to-end browser tests
make test-e2e-ui
```

### 4.6 Fuzz tests (optional)

```bash
# Requires nightly Rust and cargo-fuzz
rustup install nightly
cargo install cargo-fuzz

cargo +nightly fuzz run create_vesting_stream -- -max_total_time=60
cargo +nightly fuzz run claim_vested          -- -max_total_time=60
```

---

## 5. Making Changes

### 5.1 Branch naming

| Type | Pattern | Example |
|------|---------|---------|
| Feature | `feat/<issue-number>-short-description` | `feat/856-fix-compile-errors` |
| Bug fix | `fix/<issue-number>-short-description` | `fix/797-onboarding-guide` |
| Chore / docs | `chore/<topic>` | `chore/update-cargo-lockfile` |

```bash
# Always branch from latest main
git fetch origin
git checkout -b feat/123-my-feature origin/main
```

### 5.2 Commit conventions

This project follows [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <imperative-mood description>

[optional body]

[optional footer: Closes #issue-number]
```

Types: `feat`, `fix`, `docs`, `chore`, `test`, `refactor`, `ci`.

Examples:

```
feat(contract): add pause_stream entry point

Implements pause/resume per ADR-0007.

Closes #571
```

```
fix(events): add missing emit_stream_paused emitter

Resolves undefined symbol error from botched merge.

Closes #856
```

### 5.3 PR template

PRs open with `.github/pull_request_template.md` pre-filled. Fill in:

- **Summary:** What was changed and why.
- **Testing:** How you verified the change (test names, manual steps).
- **Closes:** `Closes #<issue-number>`.

### 5.4 Pre-merge checklist

CI enforces these automatically, but run them locally first to avoid round-trips:

```bash
cargo fmt --all -- --check          # formatting
make lint                           # clippy
make test                           # all contract tests pass
cargo build --target wasm32-unknown-unknown --release  # WASM compiles
```

---

## 6. Testnet Deployment

### 6.1 Generate and fund a test account

```bash
# Generate a keypair named "default"
stellar keys generate default --network testnet

# Read its public address and fund it using the testnet Friendbot
ADDRESS=$(stellar keys address default --network testnet)
curl -sS "https://friendbot.stellar.org/?addr=${ADDRESS}"

# Verify balance (~10,000 XLM on testnet)
stellar balances --network testnet --source default
```

### 6.2 Build, optimize, deploy, and initialize

```bash
SOROBAN_NETWORK=testnet ./scripts/deploy.sh default
```

You should see “Contract deployed and initialized!” and a contract ID beginning
with `C`. Copy that ID to `VESTING_CONTRACT_ID`, `TESTNET_CONTRACT_ID`, and
`frontend/.env.local` as `VITE_CONTRACT_ID`.

## 7. Troubleshooting

| Symptom | Fix |
|---|---|
| `wasm32-unknown-unknown` target missing | Run `rustup target add wasm32-unknown-unknown`, or rerun `make setup`. |
| `stellar` command not found | Add `$HOME/.cargo/bin` to `PATH`, then reopen the terminal. |
| PostgreSQL/Redis port is already in use | Stop the conflicting service or change the host port in `docker-compose.yml`. |
| Docker socket permission denied | Add your user to the Docker group and sign in again, or use Docker Desktop. |
| Backend rejects its environment | Check the required variables in `backend/.env`; use local-only secrets of at least the documented length. |
| Testnet deployment times out | Retry later; public testnet RPC may be rate-limited. Confirm the key is funded with Friendbot. |

## Verification Checklist

- `make setup` completes and `docker compose ps postgres redis` shows both services running.
- `make test` reports no failed contract tests.
- `curl -i http://localhost:3001/health` returns HTTP 200 while the backend runs.
- Vite prints `http://localhost:5173` and the frontend loads in the browser.
- Testnet deployment prints an initialized contract ID, and the same ID is configured in both apps.

## Cold-Read Review

Before merging, have a developer unfamiliar with this repository follow the guide
from a fresh clone and record any missing or ambiguous steps. This guide has not
been independently cold-read-tested yet.

## 8. Architecture Overview

> Estimated reading time: ~5 minutes. Full diagrams are in [`docs/architecture.md`](architecture.md).

The project is a **Soroban smart contract** (Rust → WASM) deployed on Stellar,
paired with an **off-chain indexing backend** (Node.js + PostgreSQL) and a
**React frontend**.

### Smart contract (`src/`)

```
src/
├── contract.rs   Entry points (pub fn) — the public API
├── types.rs      VestingSchedule, DataKey, StreamStatus enums
├── storage.rs    Read/write/TTL helpers (persistent + instance storage)
├── events.rs     Structured event emitters (indexed by topic)
├── error.rs      VestingError enum (u32 codes, 1–29)
└── lib.rs        Crate root and module declarations
```

**Key data flow:**

1. Sponsor calls `create_vesting_stream` → tokens transferred to contract vault →
   `VestingSchedule` stored at `DataKey::Schedule(recipient)`.
2. Time passes (ledgers advance).
3. Recipient calls `claim_vested` → contract computes `(current_ledger - last_claimed_ledger) * rate` →
   transfers tokens → updates stored schedule.
4. At `end_ledger`, the schedule is automatically deleted (storage rent reclaimed).

**Rate scaling:** All rates are stored scaled by `RATE_DECIMALS = 10_000_000` to
support fractional token amounts without floating-point.

### Backend (`backend/`)

An Express + TypeScript service that:
- Polls Horizon for `StreamCreated` / `TokensClaimed` / `StreamCancelled` events.
- Persists event history in PostgreSQL for fast UI queries.
- Exposes a REST API consumed by the frontend.

### Frontend (`frontend/`)

A Vite + React SPA that connects via Freighter wallet, calls Soroban RPC for
real-time state, and the backend API for historical event data.

### Storage layout (contract)

| Key type | Key | Value | Storage tier |
|---|---|---|---|
| Per-recipient fixed-rate stream | `DataKey::Schedule(recipient)` | `VestingSchedule` | Persistent |
| Per-recipient variable-rate stream | `DataKey::VariableSchedule(recipient)` | `VariableRateSchedule` | Persistent |
| Per-sponsor stream index | `DataKey::SponsorStreams(sponsor)` | `Vec<Address>` | Persistent |
| Contract admin | `DataKey::Admin` | `Address` | Instance |
| Protocol fee | `DataKey::FeeBps` | `u32` | Instance |
| Treasury | `DataKey::Treasury` | `Address` | Instance |
| Min deposit | `DataKey::MinDeposit` | `i128` | Instance |
| Reentrancy guard | `DataKey::Lock` | `bool` | Instance |
| Initialisation flag | `DataKey::Initialized` | `bool` | Instance |

---

*Still stuck? Open a [GitHub Discussion](https://github.com/AlienScroll78/vesting-cliff-drip-stream/discussions)
or check the [FAQ](faq.md).*
- Check out the [Contribution Guidelines](../CONTRIBUTING.md) for PR submission and commit guidelines.
- Explore the system design in [Full-Stack Architecture](architecture.md).
- Review the API documentation in [API Reference](api-reference.md).
- Read the [FAQ](faq.md) for common questions about stream lifecycle, claiming, token support, and fees.
- See [Deployment Environments](deployment-environments.md) for the differences between testnet and mainnet configuration.
- Read the [Stellar Wave Program guide](stellar-wave.md) if participating in bounty sprints.
