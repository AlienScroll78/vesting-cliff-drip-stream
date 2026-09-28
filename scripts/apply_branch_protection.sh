#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
# apply_branch_protection.sh
#
# Applies branch protection rules to `main` via the GitHub API.
#
# Requirements addressed (issue #399):
#   ✅ Require PR – no direct push to main
#   ✅ Required status checks: lint, contract-test, build, typecheck
#   ✅ Strict mode (branch must be up to date before merging)
#   ✅ Minimum 1 approving review
#   ✅ Dismiss stale reviews on new pushes
#   ✅ Require review from CODEOWNERS
#   ✅ enforce_admins (admins must also follow the rules)
#   ✅ Disable force-push and branch deletion
#
# Usage:
#   GITHUB_TOKEN=<token> REPO=owner/repo ./scripts/apply_branch_protection.sh
#
# If REPO is not set it is auto-detected via the GitHub CLI (gh).
# If GITHUB_TOKEN is not set the script falls back to the token that
# `gh auth token` returns (i.e. whatever account is logged in via `gh auth login`).
# ──────────────────────────────────────────────────────────────────────────────
set -euo pipefail

# ── Resolve repository ────────────────────────────────────────────────────────
REPO="${REPO:-$(gh repo view --json nameWithOwner -q .nameWithOwner 2>/dev/null)}"
if [[ -z "$REPO" ]]; then
  echo "ERROR: REPO is not set and could not be auto-detected via gh." >&2
  echo "       Set it explicitly: REPO=owner/repo $0" >&2
  exit 1
fi

# ── Resolve token ─────────────────────────────────────────────────────────────
TOKEN="${GITHUB_TOKEN:-$(gh auth token 2>/dev/null || true)}"
if [[ -z "$TOKEN" ]]; then
  echo "ERROR: No GitHub token found." >&2
  echo "       Set GITHUB_TOKEN or run: gh auth login" >&2
  exit 1
fi

BRANCH="main"
API="https://api.github.com/repos/${REPO}/branches/${BRANCH}/protection"

echo "▶  Applying branch protection to '${BRANCH}' in '${REPO}'…"
echo ""

# ── Required status checks ────────────────────────────────────────────────────
# These must exactly match the 'name:' field (or job key) of each workflow job
# that runs on pull_request events:
#
#   lint          → CI workflow, job: lint    (cargo fmt + clippy)
#   contract-test → CI workflow, job: contract-test  (cargo test --features testutils)
#   build         → CI workflow, job: build   (wasm32 build)
#   typecheck     → CI workflow, job: typecheck (frontend tsc)

curl -fsSL -X PUT \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Accept: application/vnd.github+json" \
  -H "X-GitHub-Api-Version: 2022-11-28" \
  "$API" \
  -d '{
    "required_status_checks": {
      "strict": true,
      "contexts": [
        "lint",
        "contract-test",
        "build",
        "typecheck"
      ]
    },
    "enforce_admins": true,
    "required_pull_request_reviews": {
      "dismiss_stale_reviews": true,
      "require_code_owner_reviews": true,
      "required_approving_review_count": 1,
      "require_last_push_approval": false
    },
    "restrictions": null,
    "allow_force_pushes": false,
    "allow_deletions": false,
    "block_creations": false,
    "required_conversation_resolution": true,
    "lock_branch": false
  }'

echo ""
echo "✅  Branch protection applied to '${BRANCH}' in '${REPO}'"
echo ""
echo "   Rules active:"
echo "   • Pull request required before merging (no direct push)"
echo "   • Required status checks: lint, contract-test, build, typecheck"
echo "   • Strict mode: branch must be up-to-date before merge"
echo "   • Minimum 1 approving review"
echo "   • Stale reviews dismissed on new pushes"
echo "   • CODEOWNERS review required"
echo "   • enforce_admins: true (admins must comply)"
echo "   • Force-push disabled"
echo "   • Branch deletion disabled"
echo "   • Conversation resolution required"
