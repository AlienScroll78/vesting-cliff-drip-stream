# Developer Onboarding Guide

> ⏱ **Estimated setup time:** 15–20 minutes to running `make test`
>
> This guide walks a new contributor from zero through a verified local build,
> test run, and first contribution on **Ubuntu 24.04 LTS** and **macOS 14+**.
> All commands are verified on both platforms.
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
| Rust (stable) | 1.75+ | `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \| sh` |
| WASM target | — | `rustup target add wasm32-unknown-unknown` |
| Stellar CLI | 21.x+ | `cargo install --locked stellar-cli --features opt` |
| Node.js | 20 LTS | see below |
| Docker + Compose v2 | 25+ / 2.24+ | see below |

### 1.1 Rust & WASM target

```bash
# Install Rust (if not already installed)
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
source "$HOME/.cargo/env"

# Add the WASM compile target required for Soroban
rustup target add wasm32-unknown-unknown

# Verify
rustc --version     # rustc 1.75.x (stable)
cargo --version
```

### 1.2 Stellar CLI

```bash
cargo install --locked stellar-cli --features opt

# Add $HOME/.cargo/bin to PATH if not already present
echo 'export PATH="$HOME/.cargo/bin:$PATH"' >> ~/.bashrc  # bash
echo 'export PATH="$HOME/.cargo/bin:$PATH"' >> ~/.zshrc   # zsh
source ~/.bashrc  # or ~/.zshrc

stellar --version   # stellar 21.x.x
```

### 1.3 Node.js 20 LTS

**Ubuntu / Debian:**

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node --version   # v20.x.x
npm --version    # 10.x.x
```

**macOS:**

```bash
# via Homebrew
brew install node@20
echo 'export PATH="/opt/homebrew/opt/node@20/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc
node --version
```

### 1.4 Docker & Docker Compose v2

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

### 2.2 Root environment

```bash
cp .env.example .env
```

The defaults in `.env.example` point to Stellar testnet and local Docker services.
For smart-contract-only work you can leave `.env` as-is.

Key variables you may need to change:

| Variable | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | `postgres://vesting:vesting@localhost:5432/vesting` | PostgreSQL for the backend indexer |
| `REDIS_URL` | `redis://localhost:6379` | Redis for caching/rate-limiting |
| `VESTING_CONTRACT_ID` | placeholder `CAAA…` | The deployed Soroban contract address |
| `SOROBAN_RPC_URL` | testnet RPC | Soroban JSON-RPC endpoint |

### 2.3 Frontend environment

```bash
cat > frontend/.env << 'EOF'
VITE_API_URL=http://localhost:3001
VITE_NETWORK=testnet
VITE_CONTRACT_ID=CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
VITE_HORIZON_URL=https://horizon-testnet.stellar.org
EOF
```

### 2.4 Verify build

```bash
# Compile the smart contract (native target — fast, no WASM needed for this step)
cargo check --lib

# Build the production WASM
make build

# Install all Node dependencies (root workspace + backend + frontend)
npm install
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
docker compose ps
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
npm test               # vitest run
npm run test:watch     # interactive watch mode
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
# Generate a new keypair named "default" and fund it via testnet Friendbot
stellar keys generate default --network testnet --fund

# Verify balance (~10,000 XLM on testnet)
stellar balances --network testnet --source default
```

### 6.2 Build the optimised WASM

```bash
make build

stellar contract optimize \
  --wasm target/wasm32-unknown-unknown/release/vesting_cliff_drip_stream.wasm \
  --wasm-out target/vesting_cliff_drip_stream.optimized.wasm
```

### 6.3 Deploy

```bash
export IDENTITY=default   # stellar keys name

CONTRACT_ID=$(stellar contract deploy \
  --wasm target/vesting_cliff_drip_stream.optimized.wasm \
  --source "$IDENTITY" \
  --network testnet)

echo "Deployed: $CONTRACT_ID"
export VESTING_CONTRACT="$CONTRACT_ID"
```

### 6.4 Initialize

```bash
ADMIN=$(stellar keys address "$IDENTITY")

stellar contract invoke \
  --id "$VESTING_CONTRACT" \
  --source "$IDENTITY" \
  --network testnet \
  -- initialize \
  --admin "$ADMIN" \
  --fee_bps 0 \
  --treasury "$ADMIN"
```

### 6.5 Create a test stream

```bash
export SPONSOR="$IDENTITY"
export RECIPIENT=<G-address-of-recipient>
export TOKEN=<C-address-of-SAC-token>
export RATE=10               # tokens/ledger (whole, not scaled)
export CLIFF_DURATION=17280  # ~1 day
export TOTAL_DURATION=172800 # ~10 days

./scripts/invoke_create.sh
```

### 6.6 Claim vested tokens

```bash
./scripts/invoke_claim.sh
```

---

## 7. Troubleshooting

### 1. `wasm32-unknown-unknown` target missing

**Symptom:**
```
error[E0463]: can't find crate for 'std'
 --> src/lib.rs:1:1
  |
  = note: the `wasm32-unknown-unknown` target may not be installed
```

**Fix:**
```bash
rustup target add wasm32-unknown-unknown
```

### 2. `stellar: command not found`

**Symptom:** Command not found after installing Stellar CLI.

**Fix:**
```bash
echo 'export PATH="$HOME/.cargo/bin:$PATH"' >> ~/.bashrc
source ~/.bashrc
```

### 3. PostgreSQL port 5432 already in use

**Symptom:**
```
Error starting userland proxy: listen tcp4 0.0.0.0:5432: bind: address already in use
```

**Fix:**
```bash
# Stop the system PostgreSQL service
sudo systemctl stop postgresql      # Ubuntu / Debian
brew services stop postgresql       # macOS

# Or map to a different host port in docker-compose.yml
```

### 4. JWT secret too short

**Symptom:**
```
JWT_SECRET: String must contain at least 32 character(s)
```

**Fix:** Generate a random 32+ character secret:
```bash
openssl rand -base64 32
# Paste the output into .env as JWT_SECRET
```

### 5. Docker `permission denied` on socket

**Symptom:**
```
permission denied while trying to connect to the Docker daemon socket at unix:///var/run/docker.sock
```

**Fix:**
```bash
sudo usermod -aG docker "$USER"
newgrp docker       # activate group membership without logging out
```

### 6. Soroban RPC timeout during testnet deploy

**Symptom:** `stellar contract deploy` hangs or returns a timeout error.

**Fix:** The public testnet RPC can be rate-limited or slow during high traffic.

```bash
# Retry with a longer timeout
stellar contract deploy \
  --wasm target/vesting_cliff_drip_stream.optimized.wasm \
  --source default \
  --network testnet \
  --fee 10000000   # increase fee to prioritise transaction
```

Alternatively, run a local Stellar Quickstart node:

```bash
docker run --rm -p 8000:8000 \
  stellar/quickstart:testing \
  --local --enable-soroban-rpc
```

Then set `SOROBAN_RPC_URL=http://localhost:8000/soroban/rpc` and
`NETWORK_PASSPHRASE="Standalone Network ; February 2017"`.

---

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
