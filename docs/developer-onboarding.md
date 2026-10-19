# Developer Onboarding Guide

> **Goal**: Go from a fresh clone to a running local development environment in under 30 minutes.

This guide walks a new developer through setting up the Vesting Cliff Drip Stream project end-to-end: contract build, tests, backend API, and frontend UI.

---

## Contents

1. [Prerequisites](#prerequisites)
2. [Quick Setup (Automated)](#quick-setup-automated)
3. [Manual Setup](#manual-setup)
4. [Environment Variables](#environment-variables)
5. [Testnet Setup](#testnet-setup)
6. [Verification Checklist](#verification-checklist)
7. [Common Setup Errors](#common-setup-errors)

---

## Prerequisites

Install the following tools with the exact versions specified. Using different major versions may cause build failures or runtime mismatches.

| Tool | Required Version | Check Command | Install Link |
|---|---|---|---|
| **Rust** | 1.75.0+ (stable) | `rustc --version` | [rustup.rs](https://rustup.rs/) |
| **wasm32 target** | matches Rust toolchain | `rustup target list --installed` | `rustup target add wasm32-unknown-unknown` |
| **Stellar CLI** | 22.0.0+ | `stellar --version` | [docs](https://developers.stellar.org/docs/tools/developer-tools/cli/install-cli) |
| **Node.js** | 20.x LTS (Iron) | `node --version` | [nodejs.org](https://nodejs.org/) |
| **npm** | 10.x+ | `npm --version` | bundled with Node.js |
| **Docker** | 24.0+ | `docker --version` | [docker.com](https://docs.docker.com/get-docker/) |
| **Docker Compose** | v2.20+ | `docker compose version` | bundled with Docker Desktop |
| **PostgreSQL** | 15.x+ | `psql --version` | [postgresql.org](https://www.postgresql.org/download/) |
| **cargo-llvm-cov** | latest | `cargo llvm-cov --version` | `cargo install cargo-llvm-cov` |
| **Make** | any | `make --version` | pre-installed on macOS/Linux |

### OS-specific notes

- **Linux**: Install Docker Engine + Docker Compose plugin via your package manager. PostgreSQL via `apt install postgresql-15` or equivalent.
- **macOS**: `brew install postgresql@15 node@20 docker`. Docker Desktop includes Compose v2.
- **Windows**: Use WSL2 with Ubuntu. Install Docker Desktop with WSL2 backend. PostgreSQL via `apt` inside WSL.

---

## Quick Setup (Automated)

The `make setup` target automates the most common setup steps: Rust target installation, dependency fetching, and a quick build check.

```bash
git clone https://github.com/AlienScroll78/vesting-cliff-drip-stream.git
cd vesting-cliff-drip-stream
make setup
```

**You should now see:**

```
✓ wasm32-unknown-unknown target installed
✓ cargo dependencies fetched
✓ contract builds successfully
✓ frontend dependencies installed
```

If `make setup` completes without errors, skip to [Run Contract Tests](#run-contract-tests) and continue from there. If it fails, follow the [Manual Setup](#manual-setup) steps below.

---

## Manual Setup

### 1. Clone the repository

```bash
git clone https://github.com/AlienScroll78/vesting-cliff-drip-stream.git
cd vesting-cliff-drip-stream
```

**You should now see** the project root with `Cargo.toml`, `Makefile`, `README.md`, `src/`, and `docs/`.

### 2. Install Rust and the WASM target

```bash
# Install Rust via rustup (skip if already installed)
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source "$HOME/.cargo/env"

# Add the WASM compilation target
rustup target add wasm32-unknown-unknown

# Verify
rustc --version          # should print 1.75.0 or higher
rustup target list --installed   # should include wasm32-unknown-unknown
```

**You should now see** `wasm32-unknown-unknown` in the installed targets list.

### 3. Install the Stellar CLI

```bash
# macOS
brew install stellar-cli

# Linux (via cargo)
cargo install --locked soroban-cli

# Verify
stellar --version        # should print 22.0.0 or higher
```

**You should now see** a version string like `stellar 22.0.0`.

### 4. Install Node.js and frontend dependencies

```bash
# Ensure Node.js 20.x is active (use nvm if needed)
nvm use 20 || nvm install 20
node --version           # should print v20.x.x

# Install frontend dependencies
cd frontend
npm install
cd ..
```

**You should now see** `node_modules/` created in `frontend/` and no npm errors.

### 5. Build the contract

```bash
make build
```

**You should now see** the compiled WASM at `target/wasm32-unknown-unknown/release/vesting_cliff_drip_stream.wasm`.

### 6. Run contract tests

```bash
make test
```

**You should now see** all tests pass with output like:

```
running 120 tests
.............................................................
....................
test result: ok. 120 passed; 0 failed; 0 ignored
```

### 7. Start the backend

The backend is a Node.js/Express API server that indexes on-chain events and serves them to the frontend.

```bash
# Start PostgreSQL (if not running)
# Linux:  sudo systemctl start postgresql
# macOS:  brew services start postgresql@15

# Create the database
createdb vesting_dev

# Run migrations
cd src/server
npm install
npm run migrate
npm run dev
```

**You should now see**:

```
[server] Listening on http://localhost:3001
[server] Database connected: vesting_dev
[server] Horizon indexer polling started
```

### 8. Start the frontend

In a new terminal:

```bash
cd frontend
npm run dev
```

**You should now see**:

```
  VITE v5.x.x  ready in 300 ms

  ➜  Local:   http://localhost:5173/
  ➜  Network: use --host to expose
```

Open `http://localhost:5173/` in your browser. You should see the Vesting Cliff Drip Stream dashboard.

---

## Environment Variables

The backend and frontend read configuration from environment variables. Copy `.env.example` to `.env` and fill in the values below.

| Variable | Required | Description | Example Value |
|---|---|---|---|
| `STELLAR_NETWORK` | Yes | Stellar network to connect to (`testnet`, `mainnet`, `local`) | `testnet` |
| `STELLAR_HORIZON_URL` | Yes | Horizon API base URL | `https://horizon-testnet.stellar.org` |
| `STELLAR_RPC_URL` | Yes | Soroban RPC endpoint | `https://soroban-testnet.stellar.org` |
| `VESTING_CONTRACT` | Yes | Deployed vesting contract ID | `CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM` |
| `SPONSOR_KEY` | Yes | Stellar key alias for the sponsor account | `default` |
| `DATABASE_URL` | Yes | PostgreSQL connection string | `postgresql://localhost:5432/vesting_dev` |
| `PORT` | No | Backend API port (default 3001) | `3001` |
| `LOG_LEVEL` | No | Logging verbosity (`debug`, `info`, `warn`, `error`) | `info` |
| `INDEXER_POLL_INTERVAL_MS` | No | Horizon poll interval in milliseconds (default 5000) | `5000` |
| `MAX_EVENT_BATCH_SIZE` | No | Max events per Horizon fetch (default 200) | `200` |
| `VITE_API_BASE_URL` | No | Frontend → backend API URL (default `http://localhost:3001`) | `http://localhost:3001` |
| `VITE_STELLAR_NETWORK` | No | Frontend network label | `testnet` |

> **Note**: Never commit real secrets (private keys, production database passwords) to `.env`. The `.gitignore` file excludes `.env` by default.

---

## Testnet Setup

### 1. Generate a keypair

```bash
stellar keys generate default --network testnet --fund
```

This generates a new keypair, saves it as `default`, and funds it via Friendbot on testnet.

**You should now see**:

```
✓ Key 'default' generated
✓ Funded via Friendbot
  Public key: GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
```

### 2. Deploy the contract

```bash
./scripts/deploy.sh default
```

**You should now see**:

```
Building contract...
Optimizing WASM...
Deploying to testnet...
✓ Contract deployed at: CYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY
```

Export the contract ID for use in invocations:

```bash
export VESTING_CONTRACT=<contract-id from output above>
```

### 3. Create a test stream

```bash
export SPONSOR=default
export RECIPIENT=<G... recipient address>
export TOKEN=<C... SAC token address>
export RATE=10
export CLIFF_DURATION=17280   # ~1 day at 5s/ledger
export TOTAL_DURATION=172800  # ~10 days

./scripts/invoke_create.sh
```

**You should now see** the transaction hash and a success status.

### 4. Claim vested tokens (after cliff)

```bash
export RECIPIENT=<same recipient>
./scripts/invoke_claim.sh
```

---

## Verification Checklist

Work through this checklist to confirm every component is running correctly.

- [ ] **Rust toolchain**: `rustc --version` prints 1.75.0+
- [ ] **WASM target**: `rustup target list --installed` includes `wasm32-unknown-unknown`
- [ ] **Stellar CLI**: `stellar --version` prints 22.0.0+
- [ ] **Contract builds**: `make build` produces `target/wasm32-unknown-unknown/release/vesting_cliff_drip_stream.wasm`
- [ ] **Contract tests pass**: `make test` shows 0 failures
- [ ] **PostgreSQL running**: `psql -d vesting_dev -c '\q'` succeeds
- [ ] **Backend running**: `curl http://localhost:3001/health` returns 200 OK
- [ ] **Frontend running**: `http://localhost:5173/` loads the dashboard
- [ ] **Testnet keypair**: `stellar keys ls` shows `default`
- [ ] **Contract deployed**: `$VESTING_CONTRACT` is set to a valid `C...` address
- [ ] **Test stream created**: `invoke_create.sh` returns success
- [ ] **Claim works**: (after cliff) `invoke_claim.sh` returns the claimed amount

---

## Common Setup Errors

### `error: linker 'rust-lld' not found` during `make build`

**Cause**: The `wasm32-unknown-unknown` target is not installed.

**Fix**:

```bash
rustup target add wasm32-unknown-unknown
```

### `error: failed to run custom build command for soroban-sdk`

**Cause**: The Rust toolchain is too old or the nightly component is missing for some build scripts.

**Fix**:

```bash
rustup update stable
rustup target add wasm32-unknown-unknown
```

### `stellar: command not found`

**Cause**: The Stellar CLI is not installed or not on your PATH.

**Fix**:

```bash
# Via cargo (all platforms)
cargo install --locked soroban-cli

# Via brew (macOS)
brew install stellar-cli

# Then verify
stellar --version
```

### `error: connection refused` when starting the backend

**Cause**: PostgreSQL is not running, or the `DATABASE_URL` is incorrect.

**Fix**:

```bash
# Check if PostgreSQL is running
pg_isready

# Start it
# Linux:  sudo systemctl start postgresql
# macOS:  brew services start postgresql@15

# Create the database if it doesn't exist
createdb vesting_dev

# Verify connection
psql -d vesting_dev -c '\q'
```

### `Error: Cannot find module 'express'` when running `npm run dev`

**Cause**: Frontend or backend npm dependencies are not installed.

**Fix**:

```bash
cd frontend && npm install && cd ..
cd src/server && npm install && cd ../..
```

### `error: no such container: stellar-quickstart` during E2E tests

**Cause**: The Docker-based Stellar quickstart container is not running.

**Fix**:

```bash
docker compose -f docker-compose.e2e.yml up -d
# Wait for it to be ready
docker compose -f docker-compose.e2e.yml logs -f | grep "Quickstart ready"
```

### `cargo test` fails with `feature testutils is required`

**Cause**: The `testutils` feature must be explicitly enabled for tests.

**Fix**: Always use the Makefile target, which enables the feature:

```bash
make test
```

Or manually:

```bash
cargo test --features testutils
```

### `nvm: command not found`

**Cause**: Node Version Manager is not installed.

**Fix**:

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
source ~/.bashrc   # or ~/.zshrc
nvm install 20
nvm use 20
```

### Frontend shows a blank page at `localhost:5173`

**Cause**: The backend API is not running, so the frontend cannot fetch data.

**Fix**: Ensure the backend is running on port 3001 first:

```bash
curl http://localhost:3001/health
# Should return: {"status":"ok"}
```

Then refresh the frontend page.

---

## Next Steps

Once your environment is set up:

1. Read the [architecture overview](architecture.md) for system-level diagrams and data flow.
2. Review the [contract API reference](api-reference.md) for all entry points and types.
3. Check the [ADR index](adr/README.md) for design decision records.
4. Read the [comparison guide](comparison.md) if you're migrating from standard Drips.
5. Browse the [glossary](glossary.md) for term definitions.

For questions, see the [FAQ](faq.md) or open an issue on GitHub.
