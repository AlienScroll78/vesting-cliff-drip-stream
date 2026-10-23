#!/usr/bin/env bash
# detect_drift.sh — Run terraform plan and report infrastructure drift.
#
# Usage: detect_drift.sh [--environment staging|production] [--lock-timeout 5m]
#
# Expected working directory: terraform/
#
# Exit codes:
#   0  — Clean: plan shows no changes
#   1  — Error: invalid input, missing per-environment tfvars, uninitialised
#        backend, or a terraform failure that is not a normal plan diff
#   2  — Drift: plan exited 2 with pending changes
#
# Environment:
#   DRIFT_ENVIRONMENT   Target environment (default: production)
#   DRIFT_LOCK_TIMEOUT  State lock acquisition timeout (default: 5m)
#   TERRAFORM_BIN       Terraform binary (default: terraform)
#
# Outputs (written to GITHUB_OUTPUT when available):
#   drift_status     — "clean" | "drift" | "error"
#   drift_detected   — "true" | "false"
#   drift_summary    — Single-line plan summary, safe for JSON payloads
#
# Artifacts:
#   drift-plan.txt  — Full plan output retained by the calling workflow

set -euo pipefail

###############################################################################
# Helpers
###############################################################################

log()  { echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] $*"; }
info() { log "INFO  $*"; }
warn() { log "WARN  $*"; }
err()  { log "ERROR $*" >&2; }

usage() {
  cat <<'USAGE'
Usage: detect_drift.sh [options]

Options:
  -e, --environment <staging|production>  Target environment
                                          (default: $DRIFT_ENVIRONMENT or production)
  -t, --lock-timeout <duration>            State lock timeout
                                          (default: $DRIFT_LOCK_TIMEOUT or 5m)
  -h, --help                               Show this help

Exit codes: 0 clean, 1 error, 2 drift.
USAGE
}

sanitize() {
  printf '%s' "${1:-}" | tr '\n\r\t' '   ' | tr -cd '[:alnum:] ,.:;()_+#=/-'
}

set_output() {
  local key="$1" value="$2"
  if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
    echo "${key}=${value}" >> "$GITHUB_OUTPUT"
  fi
  info "output: ${key}=${value}"
}

is_valid_environment() {
  [[ " ${VALID_ENVIRONMENTS} " == *" $1 "* ]]
}

emit_error() {
  err "$1"
  set_output drift_status   "error"
  set_output drift_detected "false"
  set_output drift_summary  "$(sanitize "${1}")"
  exit 1
}

###############################################################################
# Configuration
###############################################################################

PLAN_FILE="drift-plan.txt"
TERRAFORM_BIN="${TERRAFORM_BIN:-terraform}"
LOCK_TIMEOUT="${DRIFT_LOCK_TIMEOUT:-5m}"
ENVIRONMENT="${DRIFT_ENVIRONMENT:-production}"
VALID_ENVIRONMENTS="staging production"
TFVARS_FILE=""
STATE_DIR="${TF_DATA_DIR:-.terraform}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    -e|--environment)
      [[ $# -ge 2 ]] || emit_error "Missing value for $1"
      ENVIRONMENT="$2"
      shift
      ;;
    -t|--lock-timeout)
      [[ $# -ge 2 ]] || emit_error "Missing value for $1"
      LOCK_TIMEOUT="$2"
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      emit_error "Unknown argument: $1"
      ;;
  esac
  shift
done

is_valid_environment "${ENVIRONMENT}" \
  || emit_error "Invalid environment '${ENVIRONMENT}'. Expected one of: ${VALID_ENVIRONMENTS}."

[[ "${LOCK_TIMEOUT}" =~ ^[0-9]+(ms|s|m|h)$ ]] \
  || emit_error "Invalid lock timeout '${LOCK_TIMEOUT}'. Expected a duration such as 30s, 5m or 1h."

TFVARS_FILE="envs/${ENVIRONMENT}.tfvars"

###############################################################################
# Preconditions
###############################################################################

[[ -f "${TFVARS_FILE}" ]] \
  || emit_error "Variable file terraform/${TFVARS_FILE} not found for environment '${ENVIRONMENT}'. Refusing to fall back to another environment."

[[ -f "${STATE_DIR}/terraform.tfstate" ]] \
  || emit_error "Backend not initialised for environment '${ENVIRONMENT}': ${STATE_DIR}/terraform.tfstate is missing. Run: terraform init -backend-config=envs/${ENVIRONMENT}.backend.hcl"

TF_VERSION="$("${TERRAFORM_BIN}" version 2>/dev/null | head -n 1 || true)"
info "Starting drift detection for ${ENVIRONMENT} — $(date -u)"
info "Terraform version: ${TF_VERSION:-unknown}"
info "Using var file: ${TFVARS_FILE}"
info "Lock timeout: ${LOCK_TIMEOUT}"

rm -f "${PLAN_FILE}"

###############################################################################
# Run terraform plan
###############################################################################

PLAN_EXIT=0
set +e
"${TERRAFORM_BIN}" plan \
  -detailed-exitcode \
  -refresh=true \
  -input=false \
  -no-color \
  -lock-timeout="${LOCK_TIMEOUT}" \
  -var-file="${TFVARS_FILE}" 2>&1 | tee "${PLAN_FILE}"
PLAN_EXIT="${PIPESTATUS[0]}"
set -e

info "terraform plan exited with code ${PLAN_EXIT}"

###############################################################################
# Classify the result
###############################################################################

SUMMARY_LINE="$(grep -E '^Plan: ' "${PLAN_FILE}" | head -n 1 || true)"
CHANGED_RESOURCES="$(grep -E '^[[:space:]]*#[[:space:]]+.* (will be|has been)' "${PLAN_FILE}" | head -n 40 || true)"

case "${PLAN_EXIT}" in

  0)
    info "No drift detected for ${ENVIRONMENT}. Infrastructure matches Terraform configuration."
    set_output drift_status   "clean"
    set_output drift_detected "false"
    set_output drift_summary  "No changes"
    exit 0
    ;;

  2)
    warn "Drift detected in ${ENVIRONMENT} — plan shows pending changes."

    if [[ -z "${SUMMARY_LINE}" ]]; then
      SUMMARY_LINE="Plan contains pending changes (no summary line emitted)"
    fi

    echo ""
    echo "══════════════════════════════════════════════════════════════════"
    echo "  TERRAFORM DRIFT REPORT — ${ENVIRONMENT} — $(date -u '+%Y-%m-%d %H:%M UTC')"
    echo "══════════════════════════════════════════════════════════════════"
    echo ""
    echo "  Summary : ${SUMMARY_LINE}"
    echo "  Var file: ${TFVARS_FILE}"
    echo "  Plan log: ${PLAN_FILE}"
    echo ""
    echo "── Changed resources ──────────────────────────────────────────────"
    if [[ -n "${CHANGED_RESOURCES}" ]]; then
      printf '%s\n' "${CHANGED_RESOURCES}"
    else
      echo "(no per-resource change lines matched; see the plan artifact)"
    fi
    echo ""
    echo "── Full plan output is in ${PLAN_FILE} and uploaded as a CI artifact ──"
    echo ""

    set_output drift_status   "drift"
    set_output drift_detected "true"
    set_output drift_summary  "$(sanitize "${SUMMARY_LINE}")"
    exit 2
    ;;

  1)
    emit_error "terraform plan failed for ${ENVIRONMENT} (exit 1). This is an error, not drift. Review ${PLAN_FILE} and the workflow logs."
    ;;

  *)
    emit_error "Unexpected exit code ${PLAN_EXIT} from terraform plan for ${ENVIRONMENT}."
    ;;
esac
