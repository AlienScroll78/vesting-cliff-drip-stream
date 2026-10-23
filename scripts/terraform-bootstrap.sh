#!/usr/bin/env bash
set -euo pipefail

# ─────────────────────────────────────────────────────────────────────────────
# scripts/terraform-bootstrap.sh
#
# Automates first-time setup of remote Terraform state with S3 backend and
# DynamoDB state locking for staging and production environments.
# ─────────────────────────────────────────────────────────────────────────────

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
BOOTSTRAP_DIR="${REPO_ROOT}/terraform/bootstrap"
TERRAFORM_DIR="${REPO_ROOT}/terraform"

TERRAFORM_BIN="${TERRAFORM_BIN:-terraform}"
AWS_BIN="${AWS_BIN:-aws}"
VALID_ENVIRONMENTS="staging production"

log()  { printf '[%s] %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$*"; }
info() { log "INFO  $*"; }
warn() { log "WARN  $*" >&2; }
err()  { log "ERROR $*" >&2; }
die()  { err "$*"; exit 1; }

usage() {
  cat <<'USAGE'
Usage: ./scripts/terraform-bootstrap.sh <staging|production|all> [options]

Automates first-time setup of remote Terraform state (S3 bucket + DynamoDB locking).

Arguments:
  staging|production|all   Target environment to bootstrap.

Options:
  --plan-only              Plan bootstrap resources without applying.
  --auto-approve           Apply bootstrap changes without manual confirmation.
  --init-backend           Initialize remote backend in terraform/ after bootstrap.
  --enable-mfa-delete      Prompt and enable S3 MFA delete on state bucket.
  --verify-only            Verify existing S3 bucket and DynamoDB lock resources.
  -h, --help               Show this help message.

Environment Variables:
  AWS_REGION               AWS region (default: us-east-1)
  BOOTSTRAP_MFA_SERIAL     MFA device ARN for MFA delete configuration
  TERRAFORM_BIN            Path to terraform binary (default: terraform)
  AWS_BIN                  Path to aws CLI binary (default: aws)

Examples:
  ./scripts/terraform-bootstrap.sh staging --init-backend
  ./scripts/terraform-bootstrap.sh all --auto-approve --init-backend
  ./scripts/terraform-bootstrap.sh production --enable-mfa-delete
USAGE
}

MODE="apply"
AUTO_APPROVE=0
INIT_BACKEND=0
ENABLE_MFA=0
VERIFY_ONLY=0
TARGET_ENV=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    staging|production|all)
      TARGET_ENV="$1"
      shift
      ;;
    --plan-only)
      MODE="plan"
      shift
      ;;
    --auto-approve)
      AUTO_APPROVE=1
      shift
      ;;
    --init-backend)
      INIT_BACKEND=1
      shift
      ;;
    --enable-mfa-delete)
      ENABLE_MFA=1
      shift
      ;;
    --verify-only)
      VERIFY_ONLY=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      die "Unknown option: $1 (see --help)"
      ;;
  esac
done

[[ -n "${TARGET_ENV}" ]] || { usage; die "Target environment (staging, production, or all) is required."; }

# Verify required tools
command -v "${TERRAFORM_BIN}" >/dev/null 2>&1 || die "Terraform CLI (${TERRAFORM_BIN}) is required but not found in PATH."
command -v "${AWS_BIN}" >/dev/null 2>&1 || warn "AWS CLI (${AWS_BIN}) not found; post-provisioning verification will be skipped."

bootstrap_environment() {
  local env="$1"
  local bucket="vestingdrips-terraform-state-${env}"
  local table="vestingdrips-terraform-locks-${env}"
  local backend_hcl="${TERRAFORM_DIR}/envs/${env}.backend.hcl"

  info "============================================================"
  info "Bootstrapping remote state for environment: ${env}"
  info "Bucket: ${bucket} | Lock Table: ${table}"
  info "============================================================"

  if [[ ${VERIFY_ONLY} -eq 1 ]]; then
    verify_bootstrap "${env}" "${bucket}" "${table}"
    return 0
  fi

  # Call terraform/bootstrap/init.sh
  pushd "${BOOTSTRAP_DIR}" >/dev/null
  if [[ "${MODE}" == "plan" ]]; then
    info "Executing bootstrap plan for ${env}..."
    ./init.sh "${env}"
  else
    info "Applying bootstrap infrastructure for ${env}..."
    ./init.sh "${env}" --apply

    if [[ ${ENABLE_MFA} -eq 1 ]]; then
      info "Enabling MFA delete on S3 state bucket: ${bucket}..."
      ./init.sh "${env}" --enable-mfa-delete
    fi
  fi
  popd >/dev/null

  # Verify provisioned resources
  if [[ "${MODE}" != "plan" && -x "$(command -v "${AWS_BIN}")" ]]; then
    verify_bootstrap "${env}" "${bucket}" "${table}"
  fi

  # Initialize remote backend for the root terraform directory if requested
  if [[ ${INIT_BACKEND} -eq 1 && "${MODE}" != "plan" ]]; then
    info "Initializing root Terraform remote backend for ${env}..."
    pushd "${TERRAFORM_DIR}" >/dev/null
    export TF_DATA_DIR="${TERRAFORM_DIR}/.terraform/${env}"
    "${TERRAFORM_BIN}" init -input=false -backend-config="envs/${env}.backend.hcl" -reconfigure
    info "Root Terraform backend successfully configured for ${env}."
    popd >/dev/null
  fi

  info "Completed bootstrap for ${env}."
}

verify_bootstrap() {
  local env="$1"
  local bucket="$2"
  local table="$3"

  info "Verifying S3 bucket and DynamoDB locking controls for ${env}..."

  # 1. Bucket versioning
  local versioning
  versioning="$("${AWS_BIN}" s3api get-bucket-versioning --bucket "${bucket}" --query Status --output text 2>/dev/null || echo "Unknown")"
  if [[ "${versioning}" == "Enabled" ]]; then
    info "  [PASS] S3 Versioning is Enabled."
  else
    warn "  [FAIL] S3 Versioning status is ${versioning} (expected Enabled)."
  fi

  # 2. Bucket encryption
  local sse
  sse="$("${AWS_BIN}" s3api get-bucket-encryption --bucket "${bucket}" --query 'ServerSideEncryptionConfiguration.Rules[0].ApplyServerSideEncryptionByDefault.SSEAlgorithm' --output text 2>/dev/null || echo "Unknown")"
  if [[ "${sse}" == "AES256" || "${sse}" == "aws:kms" ]]; then
    info "  [PASS] S3 Server-Side Encryption is ${sse}."
  else
    warn "  [FAIL] S3 Server-Side Encryption status is ${sse} (expected AES256)."
  fi

  # 3. Public access block
  local public_block
  public_block="$("${AWS_BIN}" s3api get-public-access-block --bucket "${bucket}" --query 'PublicAccessBlockConfiguration.BlockPublicAcls' --output text 2>/dev/null || echo "false")"
  if [[ "${public_block}" == "true" ]]; then
    info "  [PASS] S3 Public Access Block is Active."
  else
    warn "  [FAIL] S3 Public Access Block is not fully enabled."
  fi

  # 4. DynamoDB lock table
  local table_status
  table_status="$("${AWS_BIN}" dynamodb describe-table --table-name "${table}" --query 'Table.TableStatus' --output text 2>/dev/null || echo "Unknown")"
  if [[ "${table_status}" == "ACTIVE" ]]; then
    info "  [PASS] DynamoDB lock table is ACTIVE."
  else
    warn "  [FAIL] DynamoDB lock table status is ${table_status}."
  fi

  # 5. MFA delete
  local mfa_status
  mfa_status="$("${AWS_BIN}" s3api get-bucket-mfa-delete --bucket "${bucket}" --query Status --output text 2>/dev/null || echo "Disabled")"
  info "  [INFO] S3 MFA Delete status: ${mfa_status}"
}

if [[ "${TARGET_ENV}" == "all" ]]; then
  for env in ${VALID_ENVIRONMENTS}; do
    bootstrap_environment "${env}"
  done
else
  bootstrap_environment "${TARGET_ENV}"
fi

info "Bootstrap automation script finished successfully."
