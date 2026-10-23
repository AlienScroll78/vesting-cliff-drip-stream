# Deployment Environments — Testnet vs. Mainnet

Single reference for every configuration value that differs between the Stellar **testnet** and **mainnet** (public) deployments of this contract and its backend.

> ⚠️ **Read this before deploying.** Testnet and mainnet are separate ledgers with no shared state and no value transfer between them. Copying a testnet contract ID into a mainnet config will not fail loudly at startup — it will submit transactions to a contract that does not exist on the network you are targeting. Verify `NETWORK_PASSPHRASE` and the contract ID together, never one without the other.

For the full variable list and validation rules see [config.md](./config.md). For the on-chain upgrade procedure see [runbooks/contract-upgrade.md](./runbooks/contract-upgrade.md).

---

## Table of Contents

1. [Network Parameters](#1-network-parameters)
2. [Contract IDs](#2-contract-ids)
3. [Account Management](#3-account-management)
4. [Fee Strategy](#4-fee-strategy)
5. [Infrastructure](#5-infrastructure)
6. [Environment Variables](#6-environment-variables)
7. [Switching Environments](#7-switching-environments)

---

## 1. Network Parameters

| Parameter | Testnet | Mainnet |
|---|---|---|
| Network passphrase | `Test SDF Network ; September 2015` | `Public Global Stellar Network ; September 2015` |
| Horizon URL | `https://horizon-testnet.stellar.org` | `https://horizon.stellar.org` |
| Soroban RPC URL | `https://soroban-testnet.stellar.org` | `https://soroban.stellar.org` |
| `SOROBAN_NETWORK` / `--network` flag | `testnet` | `public` |
| Ledger close target | ~5 s | ~5 s |
| Resets | Periodically wiped by the SDF (roughly quarterly) | Never |

**Local standalone** (used by CI and E2E, not a hosted network):

| Parameter | Value |
|---|---|
| Network passphrase | `Standalone Network ; February 2017` |
| Horizon URL | `http://localhost:8000` |
| Soroban RPC URL | `http://localhost:8000/soroban/rpc` |
| `SOROBAN_NETWORK` | `local` or `standalone` |

> The passphrase must match the network **exactly**, including the trailing space before the semicolon. A near-miss passphrase is the single most common cause of transactions that simulate locally but fail to submit.

---

## 2. Contract IDs

Every release is deployed as a **new contract instance** with a **new contract ID**. There is one ID per network per release, and the backend must be pointed at the ID matching the network it is configured for.

| Network | Contract ID | Set by |
|---|---|---|
| Testnet | See the `VESTING_CONTRACT` GitHub Actions variable | `staging.yml` after `scripts/deploy.sh` runs |
| Mainnet | Set manually — no automated mainnet deploy pipeline exists | Operator, via Helm values / secrets |
| Local (E2E) | Ephemeral, created per CI run | `.github/workflows/e2e.yml` |

**Retrieving the current IDs**

```bash
# From the Actions variable used by the deploy pipeline
gh variable get VESTING_CONTRACT

# Read a contract's current WASM hash directly from the network
stellar contract info --id <CONTRACT_ID> --network testnet
stellar contract info --id <CONTRACT_ID> --network public
```

**Updating IDs on each release** — the ID is a release artifact, so it changes whenever the contract is redeployed:

1. `staging.yml` deploys the new WASM to testnet, scrapes the contract ID from the deploy output, and writes it to the `VESTING_CONTRACT` repository variable. This step is automatic.
2. Deploy the same commit's WASM to mainnet manually and record the new ID in the deployment notes or release PR.
3. Roll the backend Helm release with the new `config.contractId` — see [Switching Environments](#7-switching-environments).

> Historical IDs are **not** tracked in this file on purpose. This table is the canonical place, and it is updated as part of the release checklist. Record superseded IDs in the release notes so in-flight streams can still be located.

---

## 3. Account Management

### Testnet

Accounts are funded by **Friendbot**, which creates and funds a testnet account on first use and tops it up on repeat calls.

```bash
# Fund a single account (creates it if it does not exist)
curl "https://friendbot.stellar.org?addr=GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"

# Fund a batch, rate-limited to 5 req/s to avoid throttling
node scripts/fund_keypairs.js tests/load/keypairs.json
```

`scripts/fund_keypairs.js` is the supported path for bulk funding — it throttles to 5 requests/second and reports how many accounts were funded. Friendbot is **testnet-only**: it has no mainnet equivalent and no way to create a funded mainnet account.

### Mainnet

There is no faucet. Every mainnet account must be funded manually:

1. Create the keypair locally: `stellar keys create deployer`
2. Transfer XLM from an existing funded account, an exchange, or an on-ramp to the new account's public key.
3. Confirm the balance: `stellar account <PUBLIC_KEY> --network public`

Keep a funded "hot" deployer account for fees, and store the cold key for the admin address passed to `initialize` separately and offline. The admin key can upgrade the contract WASM — see [the upgrade FAQ entry](faq.md#can-the-contract-be-upgraded-after-deployment).

> ⚠️ Never reuse a testnet secret key on mainnet. Testnet keys frequently end up in CI logs, `.env` files, and chat — assume any testnet key is public.

---

## 4. Fee Strategy

| | Testnet | Mainnet |
|---|---|---|
| Base fee | 100 stroops (fixed) | Dynamic — read from `getLatestLedger` |
| Priority fee | Not required | Recommended, to land in the next ledger |
| Strategy | Hardcode 100 stroops | Read the latest base fee, add a priority tip, cap the total |
| Fee bumping | Rarely needed | Use fee-bump transactions for stuck claims |

100 stroops = 0.00001 XLM. On testnet the base fee is constant, so a fixed value keeps test runs deterministic. On mainnet the fee is set by network congestion, so a hardcoded value either wastes money on a busy network or fails to be included on a congested one.

**Reading the current mainnet base fee**

```bash
curl -s https://soroban.stellar.org/get_latest_ledger \
  | jq '.result.header.base_fee_in_stroops'
```

**Fee bumping a stuck transaction** — when a claim is not included, resubmit against the same transaction envelope with a higher fee rather than building a new one, so the sequence number is not consumed:

```bash
stellar contract invoke \
  --id "$VESTING_CONTRACT" \
  --source "$RECIPIENT" \
  --network public \
  --fee-bump \
  -- -- claim_vested --recipient "$RECIPIENT"
```

The backend reads the base fee for its read-only view calls; see `backend/src/sorobanViews.js`. Protocol fees (`fee_bps`, max 500 bps) are a separate concern: they are charged in the streamed token rather than XLM, and are configured on-chain by the admin. See [Who receives protocol fees?](faq.md#who-receives-protocol-fees).

---

## 5. Infrastructure

Testnet and mainnet are backed by **different Terraform environments**. Both run in `us-east-1`.

| | Staging (testnet) | Production (mainnet) |
|---|---|---|
| Terraform environment | `staging` (`terraform/envs/staging.tfvars`) | `production` (`terraform/envs/production.tfvars`) |
| Domain | `staging.vesting.example.com` | `vesting.example.com` |
| Monthly budget alert | $250 | $1500 |
| Terraform state | S3 `vesting-tf-state`, key `vesting/terraform.tfstate` | same |
| Secrets source | External Secrets Operator → Secrets Manager | ESO → Secrets Manager |
| Contract ID source | `VESTING_CONTRACT` Actions variable (auto-updated) | Set manually in Helm values |

```bash
# Select an environment before any terraform command
terraform workspace select staging      # testnet
terraform workspace select production   # mainnet
terraform plan -var-file=envs/staging.tfvars
```

Apply the workspace and the var-file together. Running a `staging` plan against the `production` workspace is the infrastructure-side equivalent of pointing mainnet at a testnet contract — the drift-detection run in CI will catch it, but not before the change lands.

Per-network infrastructure changes belong in their own workspace. Never promote a Terraform change from staging to production without re-planning against production values; the domain, budget, and contract ID all differ.

---

## 6. Environment Variables

Two committed templates, mirroring the two networks:

| Template | Purpose |
|---|---|
| [`backend/.env.testnet.example`](../backend/.env.testnet.example) | Local development against public testnet |
| [`backend/.env.mainnet.example`](../backend/.env.mainnet.example) | Reference for production mainnet values |

The authoritative variable reference — every variable, its type, and its validation rules — is [config.md](./config.md). Copy a template and fill in the blanks:

```bash
cp backend/.env.testnet.example backend/.env      # local dev
```

### Variables that must change between networks

| Variable | Testnet | Mainnet |
|---|---|---|
| `NETWORK_PASSPHRASE` | `Test SDF Network ; September 2015` | `Public Global Stellar Network ; September 2015` |
| `HORIZON_URL` | `https://horizon-testnet.stellar.org` | `https://horizon.stellar.org` |
| `SOROBAN_RPC_URL` | `https://soroban-testnet.stellar.org` | `https://soroban.stellar.org` |
| `STELLAR_NETWORK` | `testnet` | `public` |
| `VESTING_CONTRACT_ID` | testnet contract ID | mainnet contract ID |
| `NODE_ENV` | `development` | `production` |
| `CORS_ALL_ORIGINS` | `true` (local only) | `false` |

### Variables that are identical

| Variable | Value in both |
|---|---|
| `PORT` | `3001` locally; set per-environment in the chart |
| `LOG_LEVEL` | `debug` locally, `info` in production |
| `DB_POOL_MAX` | `10` |
| `REDIS_TTL_SECONDS` | `300` |
| `RATE_LIMIT_KEY_MAX` / `RATE_LIMIT_WINDOW_SEC` | `1000` / `60` |

> 🔒 `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`, `WEBHOOK_SECRET`, `ADMIN_API_KEY`, and `SPONSOR_SECRET_KEY` are injected by External Secrets Operator in staging and production. Never commit them to a template file — the templates carry placeholders only. Local development is the only case where these live in a `.env` on disk.

The backend validates `NETWORK_PASSPHRASE`, `HORIZON_URL`, `SOROBAN_RPC_URL`, and `VESTING_CONTRACT_ID` at startup and exits with a Zod validation error if any are missing — see [Startup Validation](./config.md#startup-validation).

---

## 7. Switching Environments

### Backend (local)

Point the `.env` at the other network, then restart:

```bash
cp backend/.env.testnet.example backend/.env   # or .env.mainnet.example
cd backend && npm run dev
```

Frontend build-time variables in `frontend/.env` must change to match, or the UI will target one network while the API targets another:

| Variable | Testnet | Mainnet |
|---|---|---|
| `VITE_API_URL` | `http://localhost:3001` | `https://api.vesting.example.com` |
| `VITE_NETWORK` | `testnet` | `public` |
| `VITE_CONTRACT_ID` | testnet contract ID | mainnet contract ID |
| `VITE_HORIZON_URL` | `https://horizon-testnet.stellar.org` | `https://horizon.stellar.org` |

Vite inlines `VITE_*` at build time, so changing them requires a rebuild, not just a reload.

### CLI scripts

Every script takes the network from `SOROBAN_NETWORK`, defaulting to `testnet`:

```bash
SOROBAN_NETWORK=testnet ./scripts/deploy.sh deployer
SOROBAN_NETWORK=public  ./scripts/deploy.sh deployer
```

`scripts/deploy.sh` also reads the source account's network identity from the Stellar CLI profile, so the deployer key must be configured for the network you are deploying to. Passing `SOROBAN_NETWORK=public` with a testnet key fails at submission, not at configuration time.

The other scripts follow the same convention — `invoke_create.sh`, `invoke_claim.sh`, and `migrate_from_drips.sh` all read `SOROBAN_NETWORK`.

### Kubernetes / Helm

The deployed backend reads its network settings from the Helm release rather than from a `.env` on the pod:

```bash
# Testnet → staging cluster
helm upgrade --install vesting-backend ./helm/vesting-backend \
  --namespace vesting-staging \
  --set config.contractId=<TESTNET_CONTRACT_ID> \
  --set config.network=testnet

# Mainnet → production cluster
helm upgrade --install vesting-backend ./helm/vesting-backend \
  --namespace vesting-prod \
  --set config.contractId=<MAINNET_CONTRACT_ID> \
  --set config.network=public
```

Use `--atomic` so a failed upgrade rolls itself back. The staging workflow does this automatically (see `.github/workflows/staging.yml`); a mainnet promotion is a manual `helm upgrade` and should be reviewed by a second operator.

### Pre-flight checklist

Before any mainnet deploy or config change:

- [ ] `NETWORK_PASSPHRASE` reads `Public Global Stellar Network ; September 2015`
- [ ] `HORIZON_URL` and `SOROBAN_RPC_URL` are the non-`testnet` hosts
- [ ] The contract ID was read off mainnet, not copied from a testnet deploy log
- [ ] Terraform workspace is `production`
- [ ] `config.contractId` in the Helm release matches the mainnet ID
- [ ] Frontend `VITE_*` values match the backend, and the frontend was rebuilt
- [ ] The deployer account has an XLM balance for fees

---

*Last updated: 2026-09-28. Contract IDs are updated per release — see [Contract IDs](#2-contract-ids).*
