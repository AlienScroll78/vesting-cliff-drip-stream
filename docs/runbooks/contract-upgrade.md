# Runbook: Contract Upgrade Procedure

**Trigger:** A new contract version is ready to ship and the existing on-chain deployment must be
upgraded to the new WASM binary.

---

## Overview

Soroban smart contracts are upgraded in two stages:

1. **Install** – upload the new WASM binary to the network; this produces a new WASM hash but does
   not affect any running contract.
2. **Upgrade** – call `stellar contract upgrade` against the existing contract ID, pointing it at
   the new WASM hash.

There is **no built-in rollback on-chain** once an upgrade is applied. The rollback procedure
(section 7) is an escalation path only.

This runbook covers testnet validation first, then mainnet execution.

---

## Required Approvals

| Condition | Required approver |
|-----------|------------------|
| Any mainnet upgrade | Engineering Lead + one additional senior reviewer |
| Upgrade touching storage layout or error codes | Engineering Lead + Contract Lead |
| Emergency hotfix upgrade | Incident Commander + Engineering Lead |

Log approval with a Slack message in `#ops` **before** executing the mainnet steps:

```
:rocket: Contract upgrade requested by @<your-handle>
Version: <old-hash> → <new-hash>
Changes: <brief description>
Testnet smoke test: passed (link to run)
Approved by: @<approver-handle> at HH:MM UTC
```

---

## Step 1 — Pre-Upgrade Checklist

Complete every item before touching testnet or mainnet.

| # | Check | Done |
|---|-------|------|
| 1 | Confirm the target branch is merged to `main` and CI is green | ☐ |
| 2 | Confirm no active streams are mid-cliff on mainnet (query Horizon or the indexer) | ☐ |
| 3 | Notify recipients via the Slack `#ops` channel and any external comms if the upgrade affects claim behaviour | ☐ |
| 4 | Record the current mainnet contract ID and WASM hash | ☐ |
| 5 | Confirm the deployer key has sufficient XLM for fees (`stellar balance`) | ☐ |
| 6 | Confirm you have the deployer key identity name or secret key available | ☐ |

Record the current mainnet state before proceeding:

```bash
# Retrieve the current WASM hash of the deployed contract
stellar contract info \
  --id "$VESTING_CONTRACT" \
  --network mainnet \
  --rpc-url "$MAINNET_RPC_URL"
# Note the wasmHash field — this is your rollback reference
```

---

## Step 2 — Build and Verify the New WASM Binary

```bash
# 1. Check out the release commit
git checkout main
git pull --ff-only

# 2. Build and optimize
make optimize
# Produces: target/vesting_cliff_drip_stream.optimized.wasm

# 3. Run full test suite
make test
make spec-test

# 4. Run lints
make lint

# 5. Record the WASM file hash for audit
sha256sum target/vesting_cliff_drip_stream.optimized.wasm
# Save this value — it becomes the canonical artifact hash for this release
```

All four commands must exit 0 before continuing.

---

## Step 3 — Install and Upgrade on Testnet

### 3a. Install the new WASM

```bash
export NETWORK=testnet
export SOURCE_ACCOUNT=default   # or your key identity name

NEW_WASM_HASH=$(stellar contract install \
  --wasm target/vesting_cliff_drip_stream.optimized.wasm \
  --source "$SOURCE_ACCOUNT" \
  --network "$NETWORK")

echo "New WASM hash: $NEW_WASM_HASH"
```

### 3b. Upgrade the testnet contract

```bash
export VESTING_CONTRACT=<testnet-contract-id>

stellar contract upgrade \
  --id "$VESTING_CONTRACT" \
  --wasm-hash "$NEW_WASM_HASH" \
  --source "$SOURCE_ACCOUNT" \
  --network "$NETWORK"
```

### 3c. Verify the upgrade applied

```bash
# Confirm the contract now reports the new WASM hash
stellar contract info \
  --id "$VESTING_CONTRACT" \
  --network "$NETWORK"
# wasmHash field must equal $NEW_WASM_HASH
```

---

## Step 4 — Run Smoke Tests on Testnet

```bash
export VESTING_CONTRACT=<testnet-contract-id>

# Built-in smoke test (calls claimable_amount)
./scripts/smoke_test.sh

# Optionally create a short-lived test stream to exercise the full path
export SPONSOR=default
export RECIPIENT=<testnet-recipient-G...>
export TOKEN=<testnet-token-C...>
export RATE=1
export CLIFF_DURATION=5
export TOTAL_DURATION=20
./scripts/invoke_create.sh

# Wait a few ledgers, then check claimable amount
stellar contract invoke \
  --id "$VESTING_CONTRACT" \
  --network testnet \
  -- claimable_amount \
  --recipient "$RECIPIENT"

# Confirm the UpgradeApplied event was emitted (check Stellar Explorer or Horizon)
curl -s "https://horizon-testnet.stellar.org/contracts/$VESTING_CONTRACT/events?limit=10" \
  | jq '.._embedded.records[] | select(.type == "contract") | .value'
```

Both the smoke test and the event check must pass before proceeding to mainnet.

---

## Step 5 — Execute Upgrade on Mainnet

> **Stop here.** Confirm approvals are logged in `#ops` (see Required Approvals above)
> before running any mainnet command.

### 5a. Install the WASM on mainnet

```bash
export NETWORK=mainnet
export MAINNET_RPC_URL=https://soroban-rpc.mainnet.stellar.org   # adjust if using a different RPC
export SOURCE_ACCOUNT=<mainnet-deployer-identity>

NEW_WASM_HASH=$(stellar contract install \
  --wasm target/vesting_cliff_drip_stream.optimized.wasm \
  --source "$SOURCE_ACCOUNT" \
  --network "$NETWORK" \
  --rpc-url "$MAINNET_RPC_URL")

echo "Mainnet new WASM hash: $NEW_WASM_HASH"
```

### 5b. Upgrade the mainnet contract

```bash
export VESTING_CONTRACT=<mainnet-contract-id>

stellar contract upgrade \
  --id "$VESTING_CONTRACT" \
  --wasm-hash "$NEW_WASM_HASH" \
  --source "$SOURCE_ACCOUNT" \
  --network "$NETWORK" \
  --rpc-url "$MAINNET_RPC_URL"
```

---

## Step 6 — Post-Upgrade Verification

Run all checks immediately after the mainnet upgrade.

```bash
# 1. Confirm the new WASM hash is live
stellar contract info \
  --id "$VESTING_CONTRACT" \
  --network "$NETWORK" \
  --rpc-url "$MAINNET_RPC_URL"
# wasmHash must equal $NEW_WASM_HASH

# 2. Smoke test against mainnet
VESTING_CONTRACT="$VESTING_CONTRACT" \
  stellar contract invoke \
  --id "$VESTING_CONTRACT" \
  --network "$NETWORK" \
  --rpc-url "$MAINNET_RPC_URL" \
  -- claimable_amount \
  --recipient GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN

# 3. Check for the UpgradeApplied contract event on Horizon mainnet
curl -s "https://horizon.stellar.org/contracts/$VESTING_CONTRACT/events?limit=10&order=desc" \
  | jq '.._embedded.records[] | select(.type == "contract") | .value'

# 4. Confirm indexer is processing new events (check ECS logs)
aws logs tail /ecs/vesting-indexer --since 5m --follow
```

Expected outcomes:

| Check | Expected result |
|-------|----------------|
| `stellar contract info` wasmHash | Matches `$NEW_WASM_HASH` |
| `claimable_amount` invocation | Returns without error |
| `UpgradeApplied` event | Present in Horizon events |
| Indexer logs | No errors; new ledgers being ingested |

Post a confirmation in `#ops`:

```
:white_check_mark: Contract upgraded on mainnet.
Contract: <contract-id>
Old hash: <old-wasm-hash>
New hash: <new-wasm-hash>
Smoke test: passed
Event confirmed: yes
```

---

## Step 7 — Rollback Procedure

> **On-chain rollback is not possible.** Once `stellar contract upgrade` is executed, the contract
> bytecode is replaced and cannot be reverted by a CLI command.

If the upgrade introduced a critical regression, escalate immediately:

1. **Declare an incident** in `#incidents` and assign an Incident Commander.
2. **Assess impact** — determine which operations are broken and whether active streams are
   affected.
3. **Mitigate at the application layer** — options depending on the regression:
   - Disable claim/cancel API endpoints in the backend to prevent users hitting the broken path.
   - Update the indexer to pause processing if events are malformed.
4. **Prepare a hotfix** — develop and test a corrected WASM that restores expected behaviour.
   Run the full cycle (steps 2–6) for the hotfix as an emergency upgrade.
5. **Do not attempt** to replay `stellar contract upgrade` with the old WASM hash unless the old
   hash is still available on-chain (it may have been garbage-collected if the TTL expired).

| Condition | Action |
|-----------|--------|
| Critical regression affecting all users | Declare incident, disable API, prepare hotfix |
| Minor regression affecting a subset of streams | Declare incident, document affected streams, schedule hotfix in next release cycle |
| Upgrade transaction failed (never landed) | Re-attempt from step 5a; no on-chain state was changed |
| Deployer key insufficient XLM | Fund key, then re-attempt from step 5a |

Escalate to PagerDuty if no Incident Commander response within 15 minutes of incident declaration.

---

## Accountability and Audit Trail

Every mainnet upgrade is expected to produce:

| Artefact | Location | Deadline |
|----------|----------|---------|
| Slack approval message | `#ops` thread | Before step 5 |
| SHA-256 hash of the WASM binary | Noted in PR or release notes | Before step 5 |
| Horizon event confirmation | Linked in `#ops` post-upgrade message | Within 1 hour of upgrade |
| Release tag | GitHub Releases | Within 24 hours |
| CHANGELOG.md entry | Repo root | Within 24 hours |
| SBOM update | `sbom.spdx.json` attached to the release | Automatic via CI release workflow |
