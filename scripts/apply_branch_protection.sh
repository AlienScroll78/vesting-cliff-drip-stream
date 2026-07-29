#!/usr/bin/env bash
# Applies branch protection rules to main via the GitHub API.
# Usage: GITHUB_TOKEN=<token> REPO=owner/repo ./scripts/apply_branch_protection.sh
set -euo pipefail

REPO="${REPO:-$(gh repo view --json nameWithOwner -q .nameWithOwner)}"

curl -fsSL -X PUT \
  -H "Authorization: Bearer ${GITHUB_TOKEN}" \
  -H "Accept: application/vnd.github+json" \
  -H "X-GitHub-Api-Version: 2022-11-28" \
  "https://api.github.com/repos/${REPO}/branches/main/protection" \
  -d '{
    "required_status_checks": {
      "strict": true,
      "contexts": ["test", "build"]
    },
    "enforce_admins": false,
    "required_pull_request_reviews": {
      "required_approving_review_count": 1,
      "dismiss_stale_reviews": true
    },
    "restrictions": null,
    "allow_force_pushes": false,
    "allow_deletions": false
  }'

echo "Branch protection applied to main in ${REPO}"
