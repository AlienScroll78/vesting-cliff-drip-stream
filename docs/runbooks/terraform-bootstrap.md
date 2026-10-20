# Runbook: Terraform Remote State Bootstrap

**Scope:** `terraform/bootstrap/` (state bucket + lock table) and the `backend "s3"` block in
`terraform/main.tf`.
**Trigger:** First-time setup of remote state, migration away from a previous backend, a state lock
incident, a corrupted state file, or an MFA delete audit.

> This runbook is the canonical procedure for issues #833. The bootstrap stack is intentionally
> **not** applied by CI: the drift-detection role is read-only apart from its lock table, so
> bootstrap is an operator action.

---

## 1. Backend layout

Each environment has its own bucket, its own state key, and its own lock table. There is no shared
bucket, no shared key, and no Terraform workspace indirection.

| Environment | State bucket | State key | Lock table | Backend config |
|-------------|--------------|-----------|------------|----------------|
| staging | `vestingdrips-terraform-state-staging` | `staging/terraform.tfstate` | `vestingdrips-terraform-locks-staging` | `terraform/envs/staging.backend.hcl` |
| production | `vestingdrips-terraform-state-production` | `production/terraform.tfstate` | `vestingdrips-terraform-locks-production` | `terraform/envs/production.backend.hcl` |

Isolation matters: a corrupted or overwritten state file in one environment cannot affect the other,
and a lock held in one environment never blocks a run in the other.

### Controls applied by `terraform/bootstrap/`

| Control | Setting |
|---------|---------|
| Default encryption | SSE-S3 (`AES256`) on the state bucket |
| Public access block | `BlockPublicAcls`, `BlockPublicPolicy`, `IgnorePublicAcls`, `RestrictPublicBuckets` all `true` |
| Ownership controls | `BucketOwnerEnforced` (ACLs disabled) |
| Versioning | Enabled — every state write creates a new version |
| Version retention | Lifecycle rule keeps at least the **30 most recent noncurrent versions** and expires noncurrent versions older than **90 days** |
| Lock table | DynamoDB `PAY_PER_REQUEST`, `LockID` string hash key, server-side encryption, point-in-time recovery |
| MFA delete | Enabled out-of-band (section 6) — never configured in Terraform |

**About the "30 versions" guarantee:** S3 versioning does **not** cap the number of versions it
keeps. Without a lifecycle rule the bucket accumulates every version forever. The lifecycle rule in
`terraform/bootstrap/main.tf` is what bounds growth, and it is deliberately conservative: a noncurrent
version is expired only when it is both older than `state_version_max_age_days` (90) **and** superseded
by at least `state_version_retention` (30) newer versions. The practical result is "at least the
latest 30 versions are always recoverable", never "exactly 30".

---

## 2. Prerequisites

- Terraform >= 1.6 (< 2.0) and AWS CLI v2 on the operator workstation.
- AWS credentials that may create S3 buckets and DynamoDB tables in the target account and region.
  Bootstrap credentials are **not** shared with CI roles.
- A console session authenticated with MFA (root or an MFA-enabled IAM user) for section 6.
- `BOOTSTRAP_MFA_SERIAL` exported only for the MFA delete step:
  `arn:aws:iam::<ACCOUNT_ID>:mfa/<USER_NAME>`.

---

## 3. Initialise an environment

Run once per environment. `init.sh` is safe by default: without `--apply` it only plans.

```bash
cd terraform/bootstrap

# 1. Plan the state bucket and lock table (no changes are made).
./init.sh staging

# 2. Apply exactly the reviewed plan, then verify the bucket and table controls.
./init.sh staging --apply

# 3. Point the application root module at the new backend.
./init.sh staging --backend-only

# 4. Repeat for production.
./init.sh production --apply
./init.sh production --backend-only
```

Each step is also usable directly:

```bash
cd terraform
export TF_DATA_DIR="$PWD/.terraform/staging"
terraform init -input=false -backend-config=envs/staging.backend.hcl
terraform plan -lock-timeout=5m -var-file=envs/staging.tfvars
```

`TF_DATA_DIR` is set per environment by `init.sh` and by the workflows. Two environments cannot share
one `TF_DATA_DIR`: the second `terraform init` would re-point the first environment's backend
configuration, which is the classic "wrong state" incident.

### Bootstrap state is local on purpose

The bootstrap module creates the bucket and lock table that every other run depends on, so it cannot
store its own state remotely. Its state lives at:

```
terraform/bootstrap/.terraform/<environment>/terraform.tfstate
```

Back this file up (encrypted internal storage or a secrets manager) after every bootstrap apply. It
is the only record of the bootstrap resources and is required for section 8. It is git-ignored and
must never be committed.

---

## 4. Migrating existing state

Applies when state currently lives in an older backend (for example the previous shared
`vesting-tf-state` bucket with key `vesting/terraform.tfstate` and table `vesting-tf-locks`), in a
different bucket, or in a local `terraform.tfstate` file.

1. **Back up the current state first.**

   ```bash
   cd terraform
   terraform state pull > "/tmp/state-backup-$(date -u +%Y%m%dT%H%M%SZ).json"
   # Move the backup to encrypted storage, then delete the local copy.
   ```

2. **Confirm the destination key is empty.** Migrating into a non-empty key overwrites it.

   ```bash
   aws s3api list-object-versions \
     --bucket vestingdrips-terraform-state-staging \
     --prefix staging/terraform.tfstate
   ```

3. **Migrate.** `-migrate-state` copies the current state into the new backend exactly once.

   ```bash
   cd terraform/bootstrap
   ./init.sh staging --backend-only --migrate-state
   # equivalent to:
   #   cd ../terraform && terraform init -migrate-state -backend-config=envs/staging.backend.hcl
   ```

4. **Verify before any apply.**

   ```bash
   cd terraform
   export TF_DATA_DIR="$PWD/.terraform/staging"
   terraform state list | wc -l          # must match the backup
   terraform plan -lock-timeout=5m -var-file=envs/staging.tfvars
   ```

   A plan that only shows the expected post-migration normalisation is acceptable. A plan that wants
   to destroy infrastructure is a stop signal: restore the backup and investigate.

5. **Repeat for the second environment** with its own tfvars file and backend config. Never point two
   environments at the same state key.

6. **Retire the old backend last.** Keep the previous bucket and its lock table read-only for one
   release cycle. Delete the old lock table only after every team member has re-initialised, and never
   before a successful `terraform apply` on the new backend — deleting the old table first removes the
   lock protection for anyone still pointed at it.

---

## 5. Stale state locks

**Symptom:** `Error acquiring the state lock ... Lock ID: <lock-id>` and the run stops after the lock
timeout. Plan operations in this repository always pass an explicit `-lock-timeout` (default `5m`), so
a stale lock fails the run instead of hanging forever.

1. **Confirm there is no live writer.** Check the Actions run for the environment, then check the
   operator workstation for a running `terraform apply`. If a writer may still be active, wait for the
   lock timeout instead of forcing.
2. **Inspect the lock holder.**

   ```bash
   aws dynamodb get-item \
     --table-name vestingdrips-terraform-locks-staging \
     --key '{"LockID":{"S":"<env>/terraform.tfstate"}}' \
     --projection-expression 'ID,Operation,Info,Who,Version,Created'
   ```

3. **Release the lock** once you are certain no writer is running:

   ```bash
   cd terraform
   terraform force-unlock -force <lock-id>
   ```

4. **Record the incident** in `#ops` with the lock ID, the `Who` value from the table, and the
   approver. A lock that appears while nobody is running Terraform usually means a runner was
   terminated mid-apply; investigate that run before forcing the unlock.
5. **Last resort:** deleting the DynamoDB item directly only when the table itself is inconsistent
   (for example a lock row for a deleted state key). It removes the safety net for concurrent runs —
   raise it with the Cloud Infrastructure Lead first.

---

## 6. State recovery

State recovery works on versions, never on the live object.

1. **List the versions.**

   ```bash
   aws s3api list-object-versions \
     --bucket vestingdrips-terraform-state-production \
     --prefix production/terraform.tfstate \
     --query 'Versions[].{Id:VersionId,Modified:LastModified,Latest:IsLatest}'
   ```

2. **Download the version you want.** Download first, restore second; never overwrite the live state
   in place.

   ```bash
   aws s3api get-object \
     --bucket vestingdrips-terraform-state-production \
     --key production/terraform.tfstate \
     --version-id <version-id> /tmp/recovered-production.tfstate
   ```

3. **Inspect the recovered state before using it.**

   ```bash
   terraform state list -state=/tmp/recovered-production.tfstate | wc -l
   terraform plan -lock-timeout=5m -refresh=false -var-file=envs/production.tfvars
   ```

   Confirm the resource count and the resource addresses match the point in time you expect. A stale
   state produces a large plan diff; that is expected and safe as long as the resource list is right.

4. **Promote the recovered version** by writing a new version of the state key from a state file that
   has been reviewed:

   ```bash
   cd terraform
   export TF_DATA_DIR="$PWD/.terraform/production"
   terraform state push -force /tmp/recovered-production.tfstate
   ```

   `terraform state push` uploads a new version and leaves every earlier version intact, which keeps
   the recovery path reversible. Take a fresh `terraform state pull` backup immediately afterwards.

5. **Do not delete versions during recovery.** With MFA delete enabled, permanently removing a version
   requires a fresh MFA code (section 7) and destroys the rollback you are relying on.

---

## 7. MFA delete

MFA delete requires AWS to receive a **freshly generated MFA code at the moment of the call**. That is
why it cannot live in Terraform code, in a CI variable, or in this runbook: any stored code would be
expired or leaked by the time it was used, and a code pasted into a document is a shared secret.

**Never store an MFA code, and never pass one to Terraform.**

### Enable (interactive)

```bash
cd terraform/bootstrap
export BOOTSTRAP_MFA_SERIAL='arn:aws:iam::<ACCOUNT_ID>:mfa/<USER_NAME>'
./init.sh production --enable-mfa-delete
./init.sh staging  --enable-mfa-delete
```

`--enable-mfa-delete` prompts with hidden input, submits the request from a `0600` temporary file that
is deleted immediately, then verifies the result with `s3api get-bucket-mfa-delete`. It refuses to run
without a terminal, so it can never be silently driven from a pipeline.

### Verify (any time)

```bash
./init.sh production --verify-mfa-delete
aws s3api get-bucket-mfa-delete --bucket vestingdrips-terraform-state-production
# {"Status": "Enabled"}
```

### Manual equivalent

Only from an MFA-authenticated root or IAM session, and prefer the interactive prompt so the code does
not land in shell history:

```bash
read -rsp 'MFA code: ' MFA && echo
aws s3api put-bucket-mfa-delete \
  --bucket vestingdrips-terraform-state-production \
  --mfa "arn:aws:iam::<ACCOUNT_ID>:mfa/<USER_NAME> $MFA"
unset MFA
```

### Operational consequences

| Operation | Effect of MFA delete |
|-----------|----------------------|
| `terraform plan` / `apply` / `state pull` / `state push` | Unaffected — reads and writes of the live state never require MFA |
| State locking (DynamoDB) | Unaffected |
| `terraform destroy` of the state bucket | Requires a fresh MFA code, and the bucket must be empty first |
| Permanent deletion of a specific state version | Requires a fresh MFA code; prefer recovering by copying instead |

Keep the local bootstrap state backup (section 3) and the periodic `terraform state pull` backups:
they are the recovery path that does not depend on any bucket-level operation.

---

## 8. Teardown (rare, destructive)

Only needed when retiring an environment entirely, and never as part of an incident.

1. Migrate any remaining state out of the bucket and confirm no workflow targets the environment.
2. Review the destroy plan and apply it from the same per-environment directory:

   ```bash
   cd terraform/bootstrap
   TF_DATA_DIR="$PWD/.terraform/production" terraform plan -destroy -var-file=envs/production.tfvars
   TF_DATA_DIR="$PWD/.terraform/production" terraform destroy -var-file=envs/production.tfvars
   ```

   `init.sh` deliberately has no destroy mode: the bucket and the lock table are removed together, and
   that must be a reviewed, manual decision.
3. Remove the matching backend config (`terraform/envs/<env>.backend.hcl`) and tfvars file in a
   follow-up change.
4. Deleting the lock table before the bucket leaves the state key unlocked for any stale runner.

---

## 9. Verification checklist

```bash
# Bucket controls
aws s3api get-bucket-versioning        --bucket vestingdrips-terraform-state-production
aws s3api get-bucket-encryption        --bucket vestingdrips-terraform-state-production
aws s3api get-bucket-ownership-controls --bucket vestingdrips-terraform-state-production
aws s3api get-public-access-block      --bucket vestingdrips-terraform-state-production
aws s3api get-bucket-mfa-delete        --bucket vestingdrips-terraform-state-production
aws s3api get-bucket-lifecycle-configuration --bucket vestingdrips-terraform-state-production

# Lock table
aws dynamodb describe-table --table-name vestingdrips-terraform-locks-production

# Terraform wiring (repeat per environment)
cd terraform
TF_DATA_DIR="$PWD/.terraform/production" terraform init -input=false -backend-config=envs/production.backend.hcl
TF_DATA_DIR="$PWD/.terraform/production" terraform plan -lock-timeout=5m -var-file=envs/production.tfvars
```

`./init.sh <env> --apply` performs the same verification automatically after applying, and skips it
with a warning when the AWS CLI is unavailable.

CI checks the same state daily: see
[Drift Reconciliation](./drift-reconciliation.md) and `.github/workflows/drift-detection.yml`.

---

## 10. Related files

| File | Purpose |
|------|---------|
| `terraform/bootstrap/main.tf` | State bucket and lock table per environment |
| `terraform/bootstrap/init.sh` | Plan/apply, backend initialisation, migration, MFA delete |
| `terraform/bootstrap/envs/*.tfvars` | Per-environment bootstrap variables |
| `terraform/envs/*.backend.hcl` | Per-environment backend configuration consumed by `terraform init` |
| `infra/drift-detection/iam-policy.json` | Read-only plan permissions plus lock-table access for CI |
| `docs/runbooks/drift-reconciliation.md` | Triaging drift once the daily plan reports changes |
