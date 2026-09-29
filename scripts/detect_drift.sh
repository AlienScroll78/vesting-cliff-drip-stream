#!/usr/bin/env bash
# detect_drift.sh — Run terraform plan and report infrastructure drift.
#
# Expected working directory: terraform/
#
# Exit codes:
#   0  — No drift detected (plan shows no changes)
#   1  — Script error (terraform init/plan itself failed unexpectedly)
#   2  — Drift detected (terraform plan -detailed-exitcode exited 2)
#
# Outputs (written to GITHUB_OUTPUT when available):
#   drift_detected  — "true" | "false"
#   drift_summary   — Human-readable one-line summary of change counts
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

set_output() {
  local key="$1" value="$2"
  if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
    echo "${key}=${value}" >> "$GITHUB_OUTPUT"
  fi
  info "output: ${key}=${value}"
}

###############################################################################
# Configuration
###############################################################################

PLAN_FILE="drift-plan.txt"
TFVARS_FILE="envs/production.tfvars"
TERRAFORM="${TERRAFORM_BIN:-terraform}"

# Fall back to staging vars if production vars don't exist yet.
if [[ ! -f "$TFVARS_FILE" ]]; then
  warn "Production tfvars not found at ${TFVARS_FILE}; falling back to staging."
  TFVARS_FILE="envs/staging.tfvars"
fi

###############################################################################
# Run terraform plan
###############################################################################

info "Starting drift detection — $(date -u)"
info "Terraform version: $($TERRAFORM version -json | python3 -c 'import sys,json; print(json.load(sys.stdin)["terraform_version"])' 2>/dev/null || $TERRAFORM version | head -1)"
info "Using var file: ${TFVARS_FILE}"

# Clear any stale plan output from previous runs.
rm -f "$PLAN_FILE"

# Run plan with -detailed-exitcode:
#   exit 0 → succeeded, no diff
#   exit 1 → error
#   exit 2 → succeeded, non-empty diff (drift)
PLAN_EXIT=0
$TERRAFORM plan \
  -detailed-exitcode \
  -refresh=true \
  -var-file="$TFVARS_FILE" \
  -input=false \
  -no-color \
  -out=drift.tfplan \
  2>&1 | tee "$PLAN_FILE" || PLAN_EXIT=$?

info "terraform plan exited with code ${PLAN_EXIT}"

###############################################################################
# Parse and report results
###############################################################################

case "$PLAN_EXIT" in

  0)
    info "No drift detected. Infrastructure matches Terraform configuration."
    set_output drift_detected "false"
    set_output drift_summary  "No changes"
    exit 0
    ;;

  2)
    warn "Drift detected — plan shows pending changes."

    # ── Count resource changes ────────────────────────────────────────────────
    ADDS=$(grep -c '^\s*+' "$PLAN_FILE" || true)
    CHANGES=$(grep -c '^\s*~' "$PLAN_FILE" || true)
    DESTROYS=$(grep -c '^\s*-' "$PLAN_FILE" || true)

    # Use the canonical summary line terraform prints at the bottom.
    SUMMARY_LINE=$(grep -E 'Plan: [0-9]+ to add' "$PLAN_FILE" || true)

    if [[ -z "$SUMMARY_LINE" ]]; then
      SUMMARY_LINE="${ADDS} to add, ${CHANGES} to change, ${DESTROYS} to destroy"
    fi

    warn "Change summary: ${SUMMARY_LINE}"

    # ── Print a structured diff report ───────────────────────────────────────
    echo ""
    echo "╔══════════════════════════════════════════════════════════════════╗"
    echo "║            TERRAFORM DRIFT REPORT — $(date -u '+%Y-%m-%d %H:%M UTC')            ║"
    echo "╚══════════════════════════════════════════════════════════════════╝"
    echo ""
    echo "  Summary : ${SUMMARY_LINE}"
    echo "  Var file: ${TFVARS_FILE}"
    echo "  Plan log: ${PLAN_FILE}"
    echo ""
    echo "── Changed resources ──────────────────────────────────────────────"
    grep -E '^\s*(#|[~+\-] )' "$PLAN_FILE" | head -80 || true
    echo ""
    echo "── Full plan output is in ${PLAN_FILE} and uploaded as a CI artifact ──"
    echo ""

    set_output drift_detected "true"
    set_output drift_summary  "$SUMMARY_LINE"

    # Exit 2 signals "drift" to the caller (workflow uses continue-on-error).
    exit 2
    ;;

  1)
    err "terraform plan failed (exit 1). This is a script/provider error, not drift."
    err "Review the plan output in ${PLAN_FILE} and the workflow logs."
    set_output drift_detected "false"
    set_output drift_summary  "terraform plan error"
    exit 1
    ;;

  *)
    err "Unexpected exit code from terraform plan: ${PLAN_EXIT}"
    set_output drift_detected "false"
    set_output drift_summary  "Unknown error (exit ${PLAN_EXIT})"
    exit 1
    ;;
esac
