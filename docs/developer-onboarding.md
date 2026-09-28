# Developer Onboarding Guide

> ⏱ **Estimated setup time:** ~15–20 minutes
>
> This guide walks new contributors through setting up a complete local development environment from scratch on **Ubuntu 24.04 LTS** (or compatible Linux environments).
> For the contribution workflow, PR rules, and branch policies, see [CONTRIBUTING.md](../CONTRIBUTING.md).

---

## Table of Contents

1. [Prerequisites & Toolchain Setup](#1-prerequisites--toolchain-setup)
2. [Clone and Initial Setup](#2-clone-and-initial-setup)
3. [Running Smart Contract Tests](#3-running-smart-contract-tests)
4. [Running the Backend Locally](#4-running-the-backend-locally)
5. [Running the Frontend Dev Server](#5-running-the-frontend-dev-server)
6. [Running the Full E2E Suite](#6-running-the-full-e2e-suite)
7. [Common Troubleshooting Issues](#7-common-troubleshooting-issues)
8. [Next Steps](#8-next-steps)

---

## 1. Prerequisites & Toolchain Setup

The project requires **Rust** (with WASM target), **Node.js** (v20+), **Stellar CLI**, and **Docker** with Compose v2.

### Step 1.1: System Packages

Update your package index and install basic build utilities:

```bash
sudo apt update && sudo apt install -y \
  build-essential \
  pkg-config \
  libssl-dev \
  curl \
  git \
  jq \
  bc \
  ca-certificates \
  gnupg
```

### Step 1.2: Rust & WASM Target

Install the latest stable Rust toolchain via `rustup`:

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
source "$HOME/.cargo/env"

# Add the wasm32-unknown-unknown target required for Soroban smart contracts
rustup target add wasm32-unknown-unknown
```

### Step 1.3: Node.js (v20 LTS or newer)

Install Node.js 20 LTS via the official NodeSource repository or `nvm`:

```bash
# Option A: NodeSource (recommended for Ubuntu 24.04)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Verify Node.js and npm
node --version   # v20.x.x or higher
npm --version    # 10.x.x or higher
```

### Step 1.4: Stellar CLI

Install the official Stellar CLI (minimum version 21.x):

```bash
cargo install --locked stellar-cli --features opt

# Add cargo bin to PATH if not already present
export PATH="$HOME/.cargo/bin:$PATH"
stellar --version   # stellar 21.x.x or higher
```

### Step 1.5: Docker & Docker Compose

Install Docker Engine and Docker Compose v2:

```bash
# Add Docker's official GPG key and repo
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc

echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# Allow current user to run docker commands without sudo
sudo usermod -aG docker "$USER"
newgrp docker   # or log out and log back in
```

### Step 1.6: Verify All Prerequisites

Run the following verification commands to ensure your environment is ready:

```bash
rustc --version
cargo --version
rustup target list --installed | grep wasm32-unknown-unknown
node --version
npm --version
stellar --version
docker --version
docker compose version
```

---

## 2. Clone and Initial Setup

### Step 2.1: Clone the Repository

```bash
git clone https://github.com/AlienScroll78/vesting-cliff-drip-stream.git
cd vesting-cliff-drip-stream
```

### Step 2.2: Configure Root Environment

Copy the example environment configuration:

```bash
cp .env.example .env
```

The default values in `.env.example` point to Stellar testnet and local development services:

```dotenv
# .env
PORT=3001
NODE_ENV=development
DATABASE_URL=postgres://vesting:vesting@localhost:5432/vesting
REDIS_URL=redis://localhost:6379
JWT_SECRET=dev-only-secret-at-least-32-characters-long
WEBHOOK_SECRET=dev-only-webhook-secret-16chars
HORIZON_URL=https://horizon-testnet.stellar.org
SOROBAN_RPC_URL=https://soroban-testnet.stellar.org
NETWORK_PASSPHRASE=Test SDF Network ; September 2015
STELLAR_NETWORK=testnet
VESTING_CONTRACT_ID=CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
```

### Step 2.3: Configure Frontend Environment

Create `frontend/.env` with local dev settings:

```bash
cat > frontend/.env << 'EOF'
VITE_API_URL=http://localhost:3001
VITE_NETWORK=testnet
VITE_CONTRACT_ID=CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
VITE_HORIZON_URL=https://horizon-testnet.stellar.org
EOF
```

---

## 3. Running Smart Contract Tests

All smart contract logic is written in Rust for Soroban and located in `src/`.

### Run Unit and Integration Tests

```bash
# Run all unit tests (native target — fast)
make test
# Equivalent to: cargo test --features testutils

# Run tests validating the WASM contract spec against the schema
make spec-test

# Check code formatting
cargo fmt --all -- --check

# Run Clippy lints (zero-warning policy enforced)
make lint
# Equivalent to: cargo clippy --all-targets --all-features -- -D warnings

# Build the WASM contract binary
make build

# Optimize WASM binary (requires stellar CLI)
make optimize
```

---

## 4. Running the Backend Locally

The backend is an Express/TypeScript server with PostgreSQL for event indexing and Redis for caching/rate-limiting.

### Step 4.1: Start Local Services

Start PostgreSQL using Docker Compose:

```bash
# Start PostgreSQL service in background
docker compose up -d postgres

# Verify the container is running and healthy
docker compose ps
```

### Step 4.2: Install Backend Dependencies

```bash
cd backend
npm install
```

### Step 4.3: Run Database Migrations

Run database migrations to initialize the PostgreSQL schema:

```bash
DATABASE_URL=postgres://vesting:vesting@localhost:5432/vesting \
  npx node-pg-migrate up --migrations-dir migrations --migration-file-language ts
```

### Step 4.4: Start Backend Dev Server

```bash
# Starts the server with ts-node-dev for hot reloading on port 3001
npm run dev
```

### Step 4.5: Verify Backend Health

In a new terminal window:

```bash
curl -s http://localhost:3001/health | jq
# Expected response: {"status":"ok","uptime":...}
```

---

## 5. Running the Frontend Dev Server

The frontend is a Vite + React application located in `frontend/`.

### Step 5.1: Install Dependencies

From the repository root:

```bash
cd frontend
npm install
```

### Step 5.2: Start Vite Server

```bash
npm run dev
```

Open your browser to `http://localhost:5173` to view the application.

### Step 5.3: Run Frontend Tests

```bash
# Run unit tests with Vitest
npx vitest run

# Run TypeScript type check
npm run typecheck
```

---

## 6. Running the Full E2E Suite

End-to-End (E2E) tests spin up a local Stellar Quickstart node, build the contract, run the backend indexer pipeline, and execute Playwright browser tests.

### Step 6.1: Run Local Contract & Indexer E2E

```bash
# Starts local Stellar quickstart node, deploys contract, and runs tests
make test-e2e

# Run indexer event integration tests
make test-integration
```

### Step 6.2: Run Playwright Browser E2E Tests

```bash
# Install Playwright Chromium browser and OS dependencies
cd frontend
npx playwright install chromium --with-deps

# Run Playwright UI tests
cd ..
make test-e2e-ui
```

### Step 6.3: Tear Down E2E Environment

```bash
docker compose -f docker-compose.e2e.yml down -v
```

---

## 7. Common Troubleshooting Issues

### 1. PostgreSQL Port Conflict (`5432: address already in use`)
**Cause:** A local PostgreSQL service is already running on port 5432.  
**Fix:**
```bash
# Stop system PostgreSQL
sudo systemctl stop postgresql

# Or check what process is using port 5432
sudo lsof -i :5432
```

### 2. Missing WASM Target Error
**Symptom:** `error[E0463]: can't find crate for 'std' (target wasm32-unknown-unknown)`  
**Fix:**
```bash
rustup target add wasm32-unknown-unknown
```

### 3. Stellar CLI Missing / Command Not Found
**Symptom:** `stellar: command not found`  
**Fix:**
Ensure `$HOME/.cargo/bin` is in your `PATH`:
```bash
echo 'export PATH="$HOME/.cargo/bin:$PATH"' >> ~/.bashrc
source ~/.bashrc
```

### 4. JWT Secret Validation Error
**Symptom:** `JWT_SECRET: String must contain at least 32 character(s)`  
**Fix:**
Generate a 32-character random string and update `.env`:
```bash
openssl rand -base64 32
```

### 5. Docker Permission Denied
**Symptom:** `permission denied while trying to connect to the Docker daemon socket`  
**Fix:**
```bash
sudo usermod -aG docker "$USER"
newgrp docker
```

### 6. Frontend Build / Placeholder Contract ID
**Symptom:** `VITE_CONTRACT_ID not set`  
**Fix:**
Set a dummy Soroban contract ID in `frontend/.env` for local UI development before deployment:
```dotenv
VITE_CONTRACT_ID=CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
```

---

## 8. Next Steps

- Check out the [Contribution Guidelines](../CONTRIBUTING.md) for PR submission and commit guidelines.
- Explore the system design in [Full-Stack Architecture](architecture.md).
- Review the API documentation in [API Reference](api-reference.md).
- Read the [Stellar Wave Program guide](stellar-wave.md) if participating in bounty sprints.
