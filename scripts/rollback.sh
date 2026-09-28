#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
# rollback.sh – Roll back a failed staging deployment
#
# What it does:
#   1. Rolls back the backend Helm release to the previous revision.
#   2. Rolls back the frontend Helm release to the previous revision (if used).
#   3. Restores the previous VESTING_CONTRACT ID in the GitHub Actions variable
#      (if PREV_CONTRACT_ID and GH_TOKEN are provided).
#
# Required env vars:
#   KUBE_CONTEXT          – kubectl context for the staging cluster
#   HELM_NAMESPACE        – Kubernetes namespace (e.g. staging)
#   BACKEND_RELEASE       – Helm release name for the backend (e.g. vesting-backend-staging)
#
# Optional env vars:
#   FRONTEND_RELEASE      – Helm release name for the frontend (omit to skip)
#   PREV_CONTRACT_ID      – Previous contract ID to restore as GH Actions variable
#   GH_TOKEN              – GitHub token with Actions-variable write permission
#   GH_REPO               – GitHub repository (owner/repo) for gh variable set
# ──────────────────────────────────────────────────────────────────────────────
set -euo pipefail

: "${KUBE_CONTEXT:?KUBE_CONTEXT env var required}"
: "${HELM_NAMESPACE:?HELM_NAMESPACE env var required}"
: "${BACKEND_RELEASE:?BACKEND_RELEASE env var required}"

green() { printf '\033[0;32m%s\033[0m\n' "$*"; }
red()   { printf '\033[0;31m%s\033[0m\n' "$*"; }
info()  { printf '\033[0;34mℹ  %s\033[0m\n' "$*"; }

echo ""
echo "════════════════════════════════════════════════════════════════════════"
echo "  Staging rollback"
echo "  Context   : $KUBE_CONTEXT"
echo "  Namespace : $HELM_NAMESPACE"
echo "════════════════════════════════════════════════════════════════════════"
echo ""

# ── 1. Roll back backend ──────────────────────────────────────────────────────

info "Rolling back Helm release: ${BACKEND_RELEASE}"
if helm rollback "$BACKEND_RELEASE" 0 \
     --namespace "$HELM_NAMESPACE" \
     --kube-context "$KUBE_CONTEXT" \
     --wait \
     --timeout 120s; then
  green "Backend rolled back successfully."
else
  red "Backend rollback FAILED."
  exit 1
fi

# ── 2. Roll back frontend (optional) ─────────────────────────────────────────

if [[ -n "${FRONTEND_RELEASE:-}" ]]; then
  info "Rolling back frontend Helm release: ${FRONTEND_RELEASE}"
  if helm rollback "$FRONTEND_RELEASE" 0 \
       --namespace "$HELM_NAMESPACE" \
       --kube-context "$KUBE_CONTEXT" \
       --wait \
       --timeout 120s; then
    green "Frontend rolled back successfully."
  else
    red "Frontend rollback FAILED."
    exit 1
  fi
else
  info "FRONTEND_RELEASE not set – skipping frontend rollback."
fi

# ── 3. Restore previous contract ID variable (optional) ──────────────────────

if [[ -n "${PREV_CONTRACT_ID:-}" && -n "${GH_TOKEN:-}" ]]; then
  : "${GH_REPO:?GH_REPO must be set when restoring contract ID (e.g. owner/repo)}"
  info "Restoring VESTING_CONTRACT variable to: ${PREV_CONTRACT_ID}"
  if gh variable set VESTING_CONTRACT \
       --body "$PREV_CONTRACT_ID" \
       --repo "$GH_REPO"; then
    green "VESTING_CONTRACT variable restored."
  else
    red "Failed to restore VESTING_CONTRACT variable."
    exit 1
  fi
else
  info "PREV_CONTRACT_ID or GH_TOKEN not set – skipping contract ID restore."
fi

echo ""
green "Rollback complete."
