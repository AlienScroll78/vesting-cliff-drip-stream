#!/usr/bin/env bash
# sync-docs.sh — copies all markdown files from the repo's docs/ directory
# into docs-site/docs/, preserving the directory structure.
#
# This script is called by the Docusaurus build step in CI so that the
# docs-site always reflects the latest content from docs/.
#
# Usage:
#   ./sync-docs.sh                  # run from docs-site/
#   ./docs-site/sync-docs.sh        # run from repo root
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

SRC="${REPO_ROOT}/docs"
DEST="${SCRIPT_DIR}/docs"

echo "🔄  Syncing docs: ${SRC} → ${DEST}"

# Sync all markdown files, preserving subdirectory structure.
# --exclude 'index.md' preserves the custom intro page we ship in docs-site/docs/index.md.
rsync -av --delete \
  --include='*/' \
  --include='*.md' \
  --include='*.mdx' \
  --exclude='*' \
  "${SRC}/" "${DEST}/"

# Preserve the custom intro page (do not overwrite with repo root docs if present)
if [[ -f "${SCRIPT_DIR}/docs/index.md.bak" ]]; then
  mv "${SCRIPT_DIR}/docs/index.md.bak" "${SCRIPT_DIR}/docs/index.md"
fi

echo "✅  Sync complete."
