#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
TERRAFORM_DIR="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
TERRAFORM_BIN="${TERRAFORM_BIN:-terraform}"
AWS_BIN="${AWS_BIN:-aws}"
VALID_ENVIRONMENTS="staging production"

MODE="plan"
MIGRATE_STATE=0
ENVIRONMENT=""
STATE_BUCKET=""
LOCK_TABLE=""
BACKEND_CONFIG=""
TF_DATA_DIR=""
MFA_INPUT_FILE=""

log()  { printf '[%s] %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$*"; }
info() { log "INFO  $*"; }
warn() { log "WARN  $*" >&2; }
err()  { log "ERROR $*" >&2; }
die()  { err "$*"; exit 1; }

usage() {
  cat <<'USAGE'
Usage: init.sh <staging|production> [action] [options]

Actions (choose exactly one, default: plan):
  (none)                 Show the bootstrap plan for the state bucket and lock table.
  --apply                Plan, then apply only the reviewed plan.
  --backend-only         Initialise the application remote backend for this
                         environment (no bootstrap resources are created).
  --enable-mfa-delete    Interactively enable S3 MFA delete on the state bucket
                         and verify it. Prompts for a fresh MFA code, which is
                         never stored, logged, or passed on the command line.
  --verify-mfa-delete    Report and verify the current MFA delete status.

Options:
  --migrate-state        With --backend-only, copy existing state into the new
                         backend (`terraform init -migrate-state`) instead of
                         re-initialising the configured backend.
  -h, --help             Show this help.

Environment:
  BOOTSTRAP_MFA_SERIAL   MFA device ARN (arn:aws:iam::<ACCOUNT_ID>:mfa/<USER_NAME>)
                         required by --enable-mfa-delete.
  TERRAFORM_BIN          Terraform binary (default: terraform)
  AWS_BIN                AWS CLI binary (default: aws)

The bootstrap root module keeps local state on purpose: it creates the very
bucket and lock table that every other Terraform run depends on. Keep the local
bootstrap state file backed up (see docs/runbooks/terraform-bootstrap.md).
USAGE
}

cleanup() {
  if [[ -n "${MFA_INPUT_FILE}" ]]; then
    rm -f "${MFA_INPUT_FILE}"
  fi
}
trap cleanup EXIT

json_escape() {
  local value="$1"
  value="${value//\\/\\\\}"
  value="${value//\"/\\\"}"
  printf '%s' "${value}"
}

is_valid_environment() {
  [[ " ${VALID_ENVIRONMENTS} " == *" $1 "* ]]
}

verify_mfa_delete() {
  local bucket="$1" status=""
  if ! command -v "${AWS_BIN}" >/dev/null 2>&1; then
    err "AWS CLI (${AWS_BIN}) not found: cannot verify MFA delete for ${bucket}."
    return 1
  fi
  if ! status="$("${AWS_BIN}" s3api get-bucket-mfa-delete --bucket "${bucket}" --query Status --output text 2>&1)"; then
    err "Unable to read MFA delete status for ${bucket}: ${status}"
    return 1
  fi
  if [[ "${status}" != "Enabled" ]]; then
    err "MFA delete is not enabled for ${bucket} (status: ${status:-unknown})."
    return 1
  fi
  info "MFA delete verified as Enabled for ${bucket}."
}

enable_mfa_delete() {
  local bucket="$1" serial="${BOOTSTRAP_MFA_SERIAL:-}" code=""
  [[ -n "${serial}" ]] || die "BOOTSTRAP_MFA_SERIAL must be set to the MFA device ARN (arn:aws:iam::<ACCOUNT_ID>:mfa/<USER_NAME>)."
  [[ -t 0 ]] || die "--enable-mfa-delete requires an interactive terminal; MFA delete cannot be enabled non-interactively."
  command -v "${AWS_BIN}" >/dev/null 2>&1 || die "AWS CLI (${AWS_BIN}) not found."
  printf 'Enter the current MFA code for %s (never stored or logged): ' "${serial}" >&2
  IFS= read -r -s code
  printf '\n' >&2
  [[ -n "${code}" ]] || die "No MFA code entered; MFA delete not changed."
  MFA_INPUT_FILE="$(mktemp "${TMPDIR:-/tmp}/tf-bootstrap-mfa.XXXXXX")"
  chmod 600 "${MFA_INPUT_FILE}"
  printf '{"Mfa":"%s"}\n' "$(json_escape "${serial} ${code}")" > "${MFA_INPUT_FILE}"
  unset code
  if ! "${AWS_BIN}" s3api put-bucket-mfa-delete --bucket "${bucket}" --cli-input-json "file://${MFA_INPUT_FILE}"; then
    die "Failed to enable MFA delete on ${bucket}. Enable it manually and re-run with --verify-mfa-delete."
  fi
  rm -f "${MFA_INPUT_FILE}"
  MFA_INPUT_FILE=""
  info "MFA delete enable request accepted for ${bucket}."
  verify_mfa_delete "${bucket}" || die "MFA delete could not be confirmed on ${bucket}."
}

verify_backend_controls() {
  local bucket="$1" table="$2" value=""
  if ! command -v "${AWS_BIN}" >/dev/null 2>&1; then
    warn "AWS CLI (${AWS_BIN}) not found: skipping bucket and lock table verification."
    return 0
  fi
  if ! "${AWS_BIN}" sts get-caller-identity >/dev/null 2>&1; then
    warn "No AWS credentials available: skipping bucket and lock table verification."
    return 0
  fi

  value="$("${AWS_BIN}" s3api get-bucket-versioning --bucket "${bucket}" --query Status --output text 2>/dev/null || true)"
  [[ "${value}" == "Enabled" ]] || die "Versioning is not Enabled on ${bucket} (got: ${value:-unknown})."
  info "Versioning: Enabled"

  value="$("${AWS_BIN}" s3api get-bucket-encryption --bucket "${bucket}" --query 'ServerSideEncryptionConfiguration.Rules[0].ApplyServerSideEncryptionByDefault.SSEAlgorithm' --output text 2>/dev/null || true)"
  [[ "${value}" == "AES256" ]] || die "Default encryption on ${bucket} is ${value:-unknown}, expected AES256."
  info "Default encryption: AES256"

  value="$("${AWS_BIN}" s3api get-bucket-ownership-controls --bucket "${bucket}" --query 'OwnershipControls.Rules[0].ObjectOwnership' --output text 2>/dev/null || true)"
  [[ "${value}" == "BucketOwnerEnforced" ]] || die "Object ownership on ${bucket} is ${value:-unknown}, expected BucketOwnerEnforced."
  info "Object ownership: BucketOwnerEnforced"

  value="$("${AWS_BIN}" s3api get-public-access-block --bucket "${bucket}" --query 'PublicAccessBlockConfiguration' --output json 2>/dev/null || true)"
  local field
  for field in BlockPublicAcls BlockPublicPolicy IgnorePublicAcls RestrictPublicBuckets; do
    if ! printf '%s' "${value}" | grep -q "\"${field}\"[[:space:]]*:[[:space:]]*true"; then
      die "Public access block ${field} is not true on ${bucket}."
    fi
  done
  info "Public access block: all settings true"

  value="$("${AWS_BIN}" dynamodb describe-table --table-name "${table}" --query 'Table.TableStatus' --output text 2>/dev/null || true)"
  [[ "${value}" == "ACTIVE" ]] || die "Lock table ${table} is ${value:-unknown}, expected ACTIVE."
  info "Lock table: ACTIVE"
}

run_bootstrap() {
  local plan_file="${SCRIPT_DIR}/bootstrap.tfplan"
  info "Environment    : ${ENVIRONMENT}"
  info "State bucket   : ${STATE_BUCKET}"
  info "State key      : ${ENVIRONMENT}/terraform.tfstate"
  info "Lock table     : ${LOCK_TABLE}"
  info "TF_DATA_DIR    : ${TF_DATA_DIR}"
  info "Bootstrap state: ${TF_DATA_DIR}/terraform.tfstate (local, intentionally)"

  "${TERRAFORM_BIN}" -chdir="${SCRIPT_DIR}" init -input=false
  "${TERRAFORM_BIN}" -chdir="${SCRIPT_DIR}" plan \
    -input=false \
    -var-file="envs/${ENVIRONMENT}.tfvars" \
    -out="${plan_file}"

  if [[ "${MODE}" != "apply" ]]; then
    rm -f "${plan_file}"
    info "Plan only: no changes were made."
    info "Re-run with './init.sh ${ENVIRONMENT} --apply' to create the state bucket and lock table."
    return 0
  fi

  "${TERRAFORM_BIN}" -chdir="${SCRIPT_DIR}" apply -input=false "${plan_file}"
  rm -f "${plan_file}"
  "${TERRAFORM_BIN}" -chdir="${SCRIPT_DIR}" output
  verify_backend_controls "${STATE_BUCKET}" "${LOCK_TABLE}"
  info "Bootstrap complete. Wire the application backend with './init.sh ${ENVIRONMENT} --backend-only'."
}

init_backend() {
  local migration_flag="-reconfigure"
  [[ "${MIGRATE_STATE}" -eq 1 ]] && migration_flag="-migrate-state"
  info "Environment : ${ENVIRONMENT}"
  info "Backend file: terraform/${BACKEND_CONFIG}"
  info "TF_DATA_DIR : ${TF_DATA_DIR}"
  if [[ "${MIGRATE_STATE}" -eq 1 ]]; then
    warn "Migrating state into ${BACKEND_CONFIG}; back up the previous state with 'terraform state pull' first."
  fi
  TF_DATA_DIR="${TF_DATA_DIR}" "${TERRAFORM_BIN}" -chdir="${TERRAFORM_DIR}" init \
    -input=false \
    "${migration_flag}" \
    -backend-config="${BACKEND_CONFIG}"
  info "Backend initialised for ${ENVIRONMENT}. Plan with: terraform -chdir=terraform plan -lock-timeout=5m -var-file=envs/${ENVIRONMENT}.tfvars"
}

main() {
  [[ $# -ge 1 ]] || { usage; exit 2; }
  ENVIRONMENT="$1"
  shift
  if [[ "${ENVIRONMENT}" == "-h" || "${ENVIRONMENT}" == "--help" ]]; then
    usage
    exit 0
  fi
  is_valid_environment "${ENVIRONMENT}" || die "Unknown environment '${ENVIRONMENT}'. Expected one of: ${VALID_ENVIRONMENTS}."

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --apply)
        [[ "${MODE}" == "plan" ]] || die "--apply cannot be combined with another action."
        MODE="apply"
        ;;
      --backend-only)
        [[ "${MODE}" == "plan" ]] || die "--backend-only cannot be combined with another action."
        MODE="backend"
        ;;
      --enable-mfa-delete)
        [[ "${MODE}" == "plan" ]] || die "--enable-mfa-delete cannot be combined with another action."
        MODE="mfa-enable"
        ;;
      --verify-mfa-delete)
        [[ "${MODE}" == "plan" ]] || die "--verify-mfa-delete cannot be combined with another action."
        MODE="mfa-verify"
        ;;
      --migrate-state)
        MIGRATE_STATE=1
        ;;
      -h|--help)
        usage
        exit 0
        ;;
      *)
        die "Unknown option: $1"
        ;;
    esac
    shift
  done

  [[ "${MIGRATE_STATE}" -eq 0 || "${MODE}" == "backend" ]] || die "--migrate-state is only valid together with --backend-only."

  STATE_BUCKET="vestingdrips-terraform-state-${ENVIRONMENT}"
  LOCK_TABLE="vestingdrips-terraform-locks-${ENVIRONMENT}"
  BACKEND_CONFIG="envs/${ENVIRONMENT}.backend.hcl"

  [[ -f "${TERRAFORM_DIR}/${BACKEND_CONFIG}" ]] || die "Missing backend config: terraform/${BACKEND_CONFIG}"
  if [[ "${MODE}" == "plan" || "${MODE}" == "apply" ]]; then
    [[ -f "${SCRIPT_DIR}/envs/${ENVIRONMENT}.tfvars" ]] || die "Missing bootstrap variables: terraform/bootstrap/envs/${ENVIRONMENT}.tfvars"
    export TF_DATA_DIR="${SCRIPT_DIR}/.terraform/${ENVIRONMENT}"
  else
    export TF_DATA_DIR="${TERRAFORM_DIR}/.terraform/${ENVIRONMENT}"
  fi

  case "${MODE}" in
    backend) init_backend ;;
    mfa-enable) enable_mfa_delete "${STATE_BUCKET}" ;;
    mfa-verify) verify_mfa_delete "${STATE_BUCKET}" || die "MFA delete is not confirmed on ${STATE_BUCKET}." ;;
    plan|apply) run_bootstrap ;;
  esac
}

main "$@"
