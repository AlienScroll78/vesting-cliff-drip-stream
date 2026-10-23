#!/usr/bin/env bash
# scripts/check-storage-layout.sh
#
# Verifies that docs/storage-layout.md is in sync with the DataKey enum
# defined in src/types.rs.
#
# Usage:
#   bash scripts/check-storage-layout.sh          # check only (CI mode)
#   bash scripts/check-storage-layout.sh --update # regenerate fingerprint in-place
#
# Exit codes:
#   0 – fingerprints match (or --update succeeded)
#   1 – fingerprints differ (docs need updating)

set -euo pipefail

TYPES_FILE="src/types.rs"
DOCS_FILE="docs/storage-layout.md"
MARKER="DATAKEY_FINGERPRINT:"

# ---------------------------------------------------------------------------
# Extract a canonical fingerprint from the DataKey enum in src/types.rs.
# Strategy: capture everything between "pub enum DataKey {" and the closing
# "}" at the same indentation level, then extract variant names only.
# ---------------------------------------------------------------------------
extract_fingerprint() {
  # Pull out lines that look like variant declarations inside DataKey.
  # Handles both unit variants (e.g. "MinDeposit,") and tuple variants
  # (e.g. "Schedule(Address),").
  awk '
    /pub enum DataKey/      { inside=1; depth=0; next }
    inside && /\{/          { depth++ }
    inside && /\}/          { depth--; if (depth < 0) { exit } }
    inside && depth >= 0 && /^[[:space:]]+[A-Z][A-Za-z]/ {
      # Strip leading whitespace, trailing comma/braces, and any tuple args.
      gsub(/^[[:space:]]+/, "")
      gsub(/[,(].*$/, "")
      gsub(/[[:space:]]+$/, "")
      print
    }
  ' "$TYPES_FILE" | sort | paste -sd ","
}

# ---------------------------------------------------------------------------
# Read the fingerprint already embedded in the docs file.
# ---------------------------------------------------------------------------
read_docs_fingerprint() {
  grep "$MARKER" "$DOCS_FILE" \
    | sed "s/.*${MARKER}[[:space:]]*//" \
    | sed 's/[[:space:]]*-->$//' \
    | tr -d ' '
}

# ---------------------------------------------------------------------------
# Write an updated fingerprint line back into the docs file.
# ---------------------------------------------------------------------------
update_docs_fingerprint() {
  local new_fp="$1"
  # Replace the entire DATAKEY_FINGERPRINT comment line.
  sed -i "s|<!-- ${MARKER}.*-->|<!-- ${MARKER} ${new_fp} -->|" "$DOCS_FILE"
  echo "Updated DATAKEY_FINGERPRINT in $DOCS_FILE to: $new_fp"
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
ACTUAL_FP="$(extract_fingerprint)"

if [[ "${1:-}" == "--update" ]]; then
  update_docs_fingerprint "$ACTUAL_FP"
  exit 0
fi

DOCS_FP="$(read_docs_fingerprint)"

if [[ "$ACTUAL_FP" == "$DOCS_FP" ]]; then
  echo "✓ DataKey fingerprint matches docs/storage-layout.md"
  exit 0
else
  echo "✗ DataKey fingerprint mismatch!"
  echo ""
  echo "  src/types.rs DataKey variants : $ACTUAL_FP"
  echo "  docs/storage-layout.md marker : $DOCS_FP"
  echo ""
  echo "The DataKey enum in src/types.rs has changed."
  echo "Please update docs/storage-layout.md to reflect the change, then run:"
  echo ""
  echo "  bash scripts/check-storage-layout.sh --update"
  echo ""
  exit 1
fi
