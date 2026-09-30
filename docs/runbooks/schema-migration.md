# Schema Migration Runbook — VestingSchedule Upgrade (Issue #736)

**Applies to:** Soroban vesting contract upgrade from V1 to V2 schema  
**Related issue:** [#736 Add storage migration helper for VestingSchedule schema upgrades](https://github.com/CodedMarvel/vesting-cliff-drip-stream/issues/736)

---

## Background

Soroban XDR deserialization is forward-compatible: when a new field is appended
to a `#[contracttype]` struct, existing stored bytes decode with the new field
defaulting to zero.  The `schema_version` field (added in V2) uses this
property to detect and automatically upgrade old records.

### Schema versions

| Version | Contract release | New fields           |
|---------|------------------|----------------------|
| V1      | ≤ 0.x            | (original schema)    |
| V2      | 1.0 (#736)       | `schema_version: u32`|

---

## How migration works

Migration is **automatic and lazy**:

1. On every `get_schedule` / `get_schedule_readonly` call in `storage.rs`,
   `migration::migrate_schedule` is invoked.
2. If `schema_version == 0` (field absent in old bytes) or `== 1` (explicit
   legacy V1), the function applies V1 → V2 defaults and writes the record back.
3. Records at `CURRENT_SCHEMA_VERSION` are returned immediately (zero-cost
   fast path).

No admin action is required.  Schedules self-migrate on the first transaction
or view call after the upgraded contract is deployed.

---

## Pre-deployment checklist

- [ ] Deploy the new contract WASM: `./scripts/deploy.sh <keypair>`
- [ ] Verify the contract ID in `backend/.env` / `k8s/configmap.yaml` matches.
- [ ] Confirm CI passes on the `feature/schema-migration` branch.
- [ ] Confirm the PR description links to issue #736 and is approved.

---

## Dry-run (optional pre-check)

Use the `migrate-dry-run` Makefile target to estimate how many on-chain
schedules will be touched:

```bash
make migrate-dry-run \
  CONTRACT_ID=<contract-id> \
  SOROBAN_RPC_URL=https://soroban-testnet.stellar.org \
  NETWORK=testnet
```

The script queries the indexer's `stream_events` table to count distinct
recipients that were created before the V2 upgrade.  It cannot read raw
storage (Soroban does not expose an enumeration API), so the count is a
best-effort estimate based on indexed creation events.

---

## Deployment procedure

```bash
# 1. Build and optimise the WASM.
make build
make optimize

# 2. Upload the new WASM to the network.
stellar contract install \
  --source <keypair> \
  --network testnet \
  --wasm target/vesting_cliff_drip_stream.optimized.wasm

# 3. Upgrade the existing contract to the new WASM hash.
stellar contract invoke \
  --source <keypair> \
  --network testnet \
  --id <contract-id> \
  -- upgrade \
  --new_wasm_hash <wasm-hash>
```

See [contract-upgrade.md](./contract-upgrade.md) for the full upgrade runbook.

---

## Verification

After deploying, pick a known recipient and call the read view:

```bash
stellar contract invoke \
  --network testnet \
  --id <contract-id> \
  -- get_schedule \
  --recipient <recipient-address>
```

The returned `VestingSchedule` should include `"schema_version": 2`.

Alternatively, check via the backend API:

```bash
curl https://api.yourdomain.com/api/v1/schedules/<recipient-address> \
  | jq .schema_version
# Expected: 2
```

---

## Rollback

Because migration is lazy and only writes to per-recipient persistent storage,
rolling back the WASM to V1 is safe: the V1 contract ignores the new
`schema_version` field (trailing XDR fields are silently dropped by older
decoders).

1. Re-upload the previous WASM binary.
2. Upgrade the contract back to the V1 WASM hash.
3. All existing records remain valid; V1 simply ignores `schema_version`.

> **Note:** Any records that were migrated to V2 storage layout will still
> decode correctly under V1 because XDR strips unknown trailing fields on
> deserialization.

---

## Defaults applied by version

| From version | To version | Field            | Default value               |
|-------------|-----------|------------------|-----------------------------|
| V1 (0 or 1) | V2        | `schema_version` | `CURRENT_SCHEMA_VERSION` (2)|

---

## Adding a V3 field (future guide)

1. Add the new field to `VestingSchedule` in `src/types.rs`.
2. Bump `CURRENT_SCHEMA_VERSION` to `3` in `src/types.rs`.
3. Add a `migrate_v2_to_v3` function in `src/migration.rs`.
4. Call it from `migrate_schedule` when `stored_version < 3`.
5. Update this table with the new field and its default.
6. Add corresponding tests to `src/tests/test_migration.rs`.
7. Update this runbook.

---

## Related runbooks

- [Contract Upgrade](./contract-upgrade.md)
- [Disaster Recovery](./disaster-recovery.md)
- [Backfill Stream Events](./backfill-stream-events.md)
