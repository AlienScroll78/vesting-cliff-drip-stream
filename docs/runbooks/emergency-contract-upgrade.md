# Runbook: Emergency Contract Upgrade Procedure

**Trigger:** A critical security vulnerability, consensus-breaking bug, or data-loss regression
has been identified in the deployed contract and must be patched under time pressure.

> **See also:** For a planned (non-emergency) contract upgrade, use the standard
> [Contract Upgrade Runbook](./contract-upgrade.md), which includes additional validation
> steps and longer approval windows.

---

## Overview

This runbook documents the accelerated path for upgrading the Soroban contract during an active
incident. The same two-stage mechanic applies:

1. **Install** — upload the new WASM binary to the Stellar network (produces a new WASM hash).
2. **Upgrade** — invoke `stellar contract upgrade` on the live contract, pointing it at the new
   WASM hash.

**There is no on-chain rollback.** Once the upgrade transaction lands, the bytecode is replaced.
The rollback procedure (section 6) describes application-layer mitigations only.

---

## Pre-conditions

| # | Condition | Notes |
|---|-----------|-------|
| 1 | An active incident has been declared in `#incidents` | Incident Commander (IC) must be assigned |
| 2 | The root cause is confirmed and a fix is merged or ready | Do not upgrade without a reviewed patch |
| 3 | Engineering Lead **and** Incident Commander have approved in `#incidents` | Slack messages serve as the approval record |
| 4 | Deployer key is available and holds sufficient XLM for fees | Run `stellar balance` to verify |
| 5 | Testnet is available for smoke-testing | At minimum, RPC connectivity must be confirmed |

### Who is authorised to execute this runbook

| Role | Action allowed |
|------|---------------|
| Engineering Lead | Approve the upgrade; execute if IC is unavailable |
| Incident Commander | Approve the upgrade |
| On-call engineer | Execute the upgrade **only** after both approvals are logged |

Post the following approval message in `#incidents` **before** executing any command:

```
:rotating_light: EMERGENCY CONTRACT UPGRADE
Incident: <incident-link>
Vulnerability / bug: <one-line description>
Fix branch / commit: <git-ref>
Testnet smoke test: <passed | pending>
Approved by IC: @<ic-handle> at HH:MM UTC
Approved by Eng Lead: @<eng-lead-handle> at HH:MM UTC
Executing: @<your-handle>
```

---

## Step 1 — Record the Current On-chain State

Before touching anything, capture the pre-upgrade state for audit purposes.

```bash
# Set your environment variables
export NETWORK=mainnet
export MAINNET_RPC_URL=https://soroban-rpc.mainnet.stellar.org
export VESTING_CONTRACT=<mainnet-contract-id>

# Record current WASM hash (your rollback reference)
stellar contract info \
  --id "$VESTING_CONTRACT" \
  --network "$NETWORK" \
  --rpc-url "$MAINNET_RPC_URL"
# Copy the wasmHash field — save it in your incident thread
```

Paste the current WASM hash into the `#incidents` thread as a reply to the approval message.

---

## Step 2 — Build and Verify the Emergency WASM Binary

```bash
# 1. Check out the emergency fix commit
git fetch origin
git checkout <fix-branch-or-commit>

# 2. Build the optimised WASM
make optimize
# Output: target/vesting_cliff_drip_stream.optimized.wasm

# 3. Record the SHA-256 hash of the binary (canonical artifact hash)
sha256sum target/vesting_cliff_drip_stream.optimized.wasm
# Paste this value into the #incidents thread

# 4. Run the full test suite — must exit 0
make test

# 5. Run lints — must exit 0
make lint
```

> If `make test` or `make lint` cannot complete due to environment constraints,
> document the reason in `#incidents` and get explicit IC approval before skipping.

---

## Step 3 — Simulate the Upgrade on Testnet First

Even in an emergency, always verify on testnet before touching mainnet.

### 3a. Install the WASM on testnet

```bash
export TESTNET_SOURCE_ACCOUNT=default   # or your testnet key identity name

NEW_WASM_HASH=$(stellar contract install \
  --wasm target/vesting_cliff_drip_stream.optimized.wasm \
  --source "$TESTNET_SOURCE_ACCOUNT" \
  --network testnet)

echo "Testnet new WASM hash: $NEW_WASM_HASH"
```

### 3b. Upgrade the testnet contract

```bash
export TESTNET_CONTRACT=<testnet-contract-id>

stellar contract upgrade \
  --id "$TESTNET_CONTRACT" \
  --wasm-hash "$NEW_WASM_HASH" \
  --source "$TESTNET_SOURCE_ACCOUNT" \
  --network testnet
```

### 3c. Confirm the upgrade applied on testnet

```bash
stellar contract info \
  --id "$TESTNET_CONTRACT" \
  --network testnet
# wasmHash must equal $NEW_WASM_HASH
```

---

## Step 4 — Run Smoke Tests Against the Testnet Upgrade

```bash
export VESTING_CONTRACT="$TESTNET_CONTRACT"

# Built-in smoke test
./scripts/smoke_test.sh

# Verify claimable_amount view function responds
stellar contract invoke \
  --id "$TESTNET_CONTRACT" \
  --network testnet \
  -- claimable_amount \
  --recipient GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN

# Confirm UpgradeApplied event was emitted
curl -s "https://horizon-testnet.stellar.org/contracts/$TESTNET_CONTRACT/events?limit=10&order=desc" \
  | jq '.._embedded.records[] | select(.type == "contract") | .value'
```

Both the smoke test exit code and the event check must succeed before proceeding.
Post the testnet smoke test result in `#incidents`.

---

## Step 5 — Execute the Upgrade on Mainnet

> **Final gate.** Confirm both approvals are logged in `#incidents` (step 0) and the testnet
> smoke test passed (step 4) before running any mainnet command.

### 5a. Install the WASM on mainnet

```bash
export MAINNET_SOURCE_ACCOUNT=<mainnet-deployer-identity>

NEW_MAINNET_WASM_HASH=$(stellar contract install \
  --wasm target/vesting_cliff_drip_stream.optimized.wasm \
  --source "$MAINNET_SOURCE_ACCOUNT" \
  --network "$NETWORK" \
  --rpc-url "$MAINNET_RPC_URL")

echo "Mainnet new WASM hash: $NEW_MAINNET_WASM_HASH"
# Paste this into the #incidents thread immediately
```

### 5b. Upgrade the mainnet contract

```bash
stellar contract upgrade \
  --id "$VESTING_CONTRACT" \
  --wasm-hash "$NEW_MAINNET_WASM_HASH" \
  --source "$MAINNET_SOURCE_ACCOUNT" \
  --network "$NETWORK" \
  --rpc-url "$MAINNET_RPC_URL"
```

---

## Step 6 — Post-Upgrade Validation

Run all checks immediately after the transaction lands.

```bash
# 1. Confirm the new WASM hash is live
stellar contract info \
  --id "$VESTING_CONTRACT" \
  --network "$NETWORK" \
  --rpc-url "$MAINNET_RPC_URL"
# wasmHash must equal $NEW_MAINNET_WASM_HASH

# 2. Smoke test against mainnet
VESTING_CONTRACT="$VESTING_CONTRACT" \
  NETWORK="$NETWORK" \
  RPC_URL="$MAINNET_RPC_URL" \
  ./scripts/smoke_test.sh

# 3. Verify claimable_amount returns without error
stellar contract invoke \
  --id "$VESTING_CONTRACT" \
  --network "$NETWORK" \
  --rpc-url "$MAINNET_RPC_URL" \
  -- claimable_amount \
  --recipient GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN

# 4. Confirm UpgradeApplied event on Horizon mainnet
curl -s "https://horizon.stellar.org/contracts/$VESTING_CONTRACT/events?limit=10&order=desc" \
  | jq '.._embedded.records[] | select(.type == "contract") | .value'

# 5. Confirm the indexer is processing new ledgers (no errors)
aws logs tail /ecs/vesting-indexer --since 5m --follow
```

Expected outcomes:

| Check | Expected result |
|-------|----------------|
| `stellar contract info` wasmHash | Equals `$NEW_MAINNET_WASM_HASH` |
| Smoke test exit code | `0` |
| `claimable_amount` invocation | Returns without error |
| `UpgradeApplied` event | Present in Horizon events |
| Indexer ECS logs | No errors; new ledgers ingested |

Post a confirmation in `#incidents` **and** `#ops`:

```
:white_check_mark: EMERGENCY UPGRADE COMPLETE
Contract: <contract-id>
Old WASM hash: <old-hash>
New WASM hash: <new-hash>
Smoke test: passed
UpgradeApplied event: confirmed
Incident: <incident-link>
```

---

## Step 7 — Rollback Procedure

> **On-chain rollback is not possible.** Once `stellar contract upgrade` lands, the bytecode
> is replaced. The old WASM hash may still be on-chain but cannot be re-applied via a simple
> CLI command if the entry point for upgrade has itself been broken.

If the emergency upgrade introduced a new regression:

1. **Keep the incident open** — do not resolve until the new regression is addressed.
2. **Disable affected API endpoints** in the backend to stop users hitting the broken path:
   ```bash
   # Example: disable claim endpoint via feature flag in the backend config
   # Adjust to your deployment mechanism (ECS env var, K8s ConfigMap, etc.)
   aws ecs update-service \
     --cluster vesting-prod \
     --service vesting-backend \
     --force-new-deployment \
     --environment "name=FEATURE_CLAIM_ENABLED,value=false"
   ```
3. **Pause the indexer** if on-chain events are malformed and would corrupt the database:
   ```bash
   aws ecs update-service \
     --cluster vesting-prod \
     --service vesting-indexer \
     --desired-count 0
   ```
4. **Prepare a second hotfix** — follow this entire runbook again for the corrective patch.
5. **Do not attempt** to re-apply the previous WASM hash without confirming it is still
   available on-chain (it may have been garbage-collected if the TTL expired).

| Condition | Action |
|-----------|--------|
| New regression affects all users | Keep incident open, disable API, prepare second hotfix |
| New regression affects a subset of streams | Document affected recipients, schedule hotfix |
| Upgrade transaction failed (never landed) | Re-attempt from step 5a — no state was changed |
| Deployer key has insufficient XLM | Fund key (`stellar fund`), re-attempt from step 5a |
| RPC node unresponsive | Switch `$MAINNET_RPC_URL` to a backup RPC, re-attempt from step 5a |

---

## Step 8 — Post-Incident Documentation

Complete all of the following within 24 hours of resolving the incident:

| Artefact | Location | Owner |
|----------|----------|-------|
| Incident post-mortem | `#incidents` thread + Notion/Confluence | IC |
| SHA-256 hash of the emergency WASM | `#incidents` thread and GitHub release notes | Engineer who built |
| `CHANGELOG.md` entry | Repo root, under the release version | PR author |
| `docs/api-changelog.md` entry (if API changed) | Repo `docs/` | PR author |
| GitHub release tag | GitHub Releases | Engineering Lead |
| SBOM update (`sbom.spdx.json`) | Attached to the GitHub release (CI auto-generates) | CI |
| Horizon `UpgradeApplied` event link | Pinned in `#ops` | On-call engineer |

---

## Quick Reference Card

| Step | Command summary |
|------|----------------|
| Record current state | `stellar contract info --id $VESTING_CONTRACT --network mainnet` |
| Build WASM | `make optimize` |
| Run tests | `make test && make lint` |
| Install (testnet) | `stellar contract install --wasm <wasm> --source <key> --network testnet` |
| Upgrade (testnet) | `stellar contract upgrade --id <id> --wasm-hash <hash> --source <key> --network testnet` |
| Smoke test | `./scripts/smoke_test.sh` |
| Install (mainnet) | `stellar contract install --wasm <wasm> --source <key> --network mainnet --rpc-url <url>` |
| Upgrade (mainnet) | `stellar contract upgrade --id <id> --wasm-hash <hash> --source <key> --network mainnet --rpc-url <url>` |
| Verify live hash | `stellar contract info --id $VESTING_CONTRACT --network mainnet` |
| Check indexer logs | `aws logs tail /ecs/vesting-indexer --since 5m --follow` |
