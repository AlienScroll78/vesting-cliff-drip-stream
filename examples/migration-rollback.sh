#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
# migration-rollback.sh
#
# Rolls back a vesting-cliff-drip-stream migration by cancelling every stream
# that was (or should have been) created during migrate_from_drips.sh.
#
# Cancelling before the cliff returns 100% of the deposit to the sponsor.
# Cancelling after the cliff returns only the unearned remainder to the
# sponsor — the recipient keeps tokens accrued up to that point.
#
# Usage:
#   ./examples/migration-rollback.sh <streams-json>
#
# Arguments:
#   streams-json   The same JSON snapshot file that was passed to
#                  migrate_from_drips.sh. Used to identify which recipients
#                  need to be rolled back.
#
# Required env vars:
#   VESTING_CONTRACT   Deployed contract ID (C...)
#   SPONSOR            Stellar key name that created the streams.
#   NETWORK            Stellar network (testnet | mainnet). Defaults to testnet.
#
# Optional env vars:
#   DRY_RUN            Set to "1" to print commands without executing them.
#   FORCE              Set to "1" to attempt cancel even after the cliff has
#                      passed. Default: "0" (skips post-cliff streams with a
#                      warning so you can decide deliberately).
#
# Output:
#   Writes a rollback log to rollback_log_<timestamp>.txt in the current dir.
#
# ── What gets rolled back ───────────────────────────────────────────────────
#
# For each recipient in the JSON file, this script:
#   1. Calls get_schedule to check whether a stream actually exists.
#   2. If no schedule: marks as SKIP (nothing to cancel).
#   3. If a schedule exists AND cliff has NOT passed:
#        Calls cancel_stream → 100% of deposit returned to sponsor.
#   4. If a schedule exists AND cliff HAS passed:
#        If FORCE=1: Calls cancel_stream → sponsor recovers uneaned remainder;
#          recipient keeps cliff catch-up and any accrued tokens.
#        If FORCE=0 (default): Prints a WARNING and skips. You must decide
#          whether recovering the partial remainder is worth it.
#   5. Logs result: CANCELLED | SKIP | WARNING | ERROR
#
# ── Limitations ────────────────────────────────────────────────────────────
#
# - Tokens already transferred to recipients via claim_vested CANNOT be
#   recovered. This script only cancels active streams.
# - If the original Drips streams were cancelled before migration, they
#   cannot be un-cancelled. This script does not touch Drips at all.
# - After cancel, the on-chain VestingSchedule entry is removed. Re-creating
#   the stream for the same recipient after rollback is possible.
#
# See also:
#   docs/comparison.md#rollback-plan  -- rollback decision checklist
#   scripts/migrate_from_drips.sh     -- the migration script this reverses
# ──────────────────────────────────────────────────────────────────────────────
set -euo pipefail

# ── Argument / env validation ─────────────────────────────────────────────────

STREAMS_FILE="${1:-}"
if [[ -z "$STREAMS_FILE" ]]; then
  echo "Usage: $0 <streams-json>" >&2
  exit 1
fi
if [[ ! -f "$STREAMS_FILE" ]]; then
  echo "ERROR: streams file not found: $STREAMS_FILE" >&2
  exit 1
fi

: "${VESTING_CONTRACT:?ERROR: VESTING_CONTRACT must be set}"
: "${SPONSOR:?ERROR: SPONSOR must be set}"
NETWORK="${NETWORK:-testnet}"
DRY_RUN="${DRY_RUN:-0}"
FORCE="${FORCE:-0}"

# ── Dependency check ──────────────────────────────────────────────────────────

for cmd in stellar jq; do
  if ! command -v "$cmd" &>/dev/null; then
    echo "ERROR: required command not found: $cmd" >&2
    exit 1
  fi
done

# ── Log setup ─────────────────────────────────────────────────────────────────

TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
LOG_FILE="rollback_log_${TIMESTAMP}.txt"
exec > >(tee -a "$LOG_FILE") 2>&1

log()         { echo "[$(date -u +%H:%M:%SZ)] $*"; }
log_cancel()  { echo "[$(date -u +%H:%M:%SZ)] CANCELLED | $*"; }
log_skip()    { echo "[$(date -u +%H:%M:%SZ)] SKIP      | $*"; }
log_warn()    { echo "[$(date -u +%H:%M:%SZ)] WARNING   | $*"; }
log_error()   { echo "[$(date -u +%H:%M:%SZ)] ERROR     | $*"; }

# ── Summary counters ──────────────────────────────────────────────────────────

TOTAL=0
CANCELLED=0
SKIPPED=0
WARNED=0
FAILED=0

# ── Helper: run a stellar contract invoke ────────────────────────────────────

invoke_contract() {
  local func="$1"; shift
  local cmd=(
    stellar contract invoke
    --id "$VESTING_CONTRACT"
    --source "$SPONSOR"
    --network "$NETWORK"
    --
    "$func"
    "$@"
  )
  if [[ "$DRY_RUN" == "1" ]]; then
    echo "DRY_RUN: ${cmd[*]}"
    return 0
  fi
  "${cmd[@]}"
}

# ── Helper: get raw schedule JSON for a recipient ─────────────────────────────

get_schedule_raw() {
  local recipient="$1"
  stellar contract invoke \
    --id "$VESTING_CONTRACT" \
    --source "$SPONSOR" \
    --network "$NETWORK" \
    -- \
    get_schedule \
    --recipient "$recipient" 2>/dev/null || echo "null"
}

# ── Helper: check cliff status ────────────────────────────────────────────────

is_cliff_passed() {
  local recipient="$1"
  local result
  result=$(stellar contract invoke \
    --id "$VESTING_CONTRACT" \
    --source "$SPONSOR" \
    --network "$NETWORK" \
    -- \
    is_cliff_passed \
    --recipient "$recipient" 2>/dev/null || echo "false")

  if [[ "$result" == "true" ]]; then
    return 0  # cliff has passed
  fi
  return 1    # cliff not yet passed
}

# ── Main rollback loop ────────────────────────────────────────────────────────

log "=========================================="
log "vesting-cliff-drip-stream migration rollback"
log "Contract  : $VESTING_CONTRACT"
log "Sponsor   : $SPONSOR"
log "Network   : $NETWORK"
log "Dry run   : $DRY_RUN"
log "Force     : $FORCE (cancel post-cliff streams)"
log "Streams   : $STREAMS_FILE"
log "Log file  : $LOG_FILE"
log "=========================================="

STREAM_COUNT=$(jq 'length' "$STREAMS_FILE")
log "Processing $STREAM_COUNT stream(s)..."
echo ""

for i in $(seq 0 $((STREAM_COUNT - 1))); do
  TOTAL=$((TOTAL + 1))
  ENTRY=$(jq -c ".[$i]" "$STREAMS_FILE")

  RECIPIENT=$(echo "$ENTRY" | jq -r '.recipient')
  COMMENT=$(echo "$ENTRY"   | jq -r '.comment // "no comment"')

  log "─── Stream $((i + 1))/$STREAM_COUNT: $RECIPIENT ($COMMENT)"

  # ── Check if a schedule exists ────────────────────────────────────────────
  SCHEDULE=$(get_schedule_raw "$RECIPIENT")
  if [[ "$SCHEDULE" == "null" ]] || ! echo "$SCHEDULE" | grep -q '"version"'; then
    log_skip "$RECIPIENT | no active schedule found — nothing to cancel"
    SKIPPED=$((SKIPPED + 1))
    echo ""
    continue
  fi

  # ── Check cliff status ────────────────────────────────────────────────────
  CLIFF_HAS_PASSED=false
  if is_cliff_passed "$RECIPIENT"; then
    CLIFF_HAS_PASSED=true
  fi

  if [[ "$CLIFF_HAS_PASSED" == "true" && "$FORCE" != "1" ]]; then
    log_warn "$RECIPIENT | cliff HAS passed — skipping to prevent partial loss"
    log_warn "$RECIPIENT | set FORCE=1 to cancel anyway (sponsor recovers uneaned remainder only)"
    log_warn "$RECIPIENT | schedule data: $(echo "$SCHEDULE" | jq -c '{cliff_ledger,end_ledger,rate_per_ledger}')"
    WARNED=$((WARNED + 1))
    SKIPPED=$((SKIPPED + 1))
    echo ""
    continue
  fi

  if [[ "$CLIFF_HAS_PASSED" == "true" ]]; then
    log "  Cliff has passed. FORCE=1 set — proceeding with partial cancel."
    log "  Sponsor will recover uneaned tokens only; recipient keeps accrued amount."
  else
    log "  Cliff not yet reached — cancel will return 100% of deposit to sponsor."
  fi

  # ── Cancel the stream ─────────────────────────────────────────────────────
  if CANCEL_OUTPUT=$(invoke_contract cancel_stream \
      --sponsor "$SPONSOR" \
      --recipient "$RECIPIENT" 2>&1); then
    if [[ "$CLIFF_HAS_PASSED" == "true" ]]; then
      log_cancel "$RECIPIENT | partial rollback (post-cliff) — sponsor recovered remainder"
    else
      log_cancel "$RECIPIENT | full rollback (pre-cliff) — 100% of deposit returned to sponsor"
    fi
    CANCELLED=$((CANCELLED + 1))
  else
    log_error "$RECIPIENT | cancel_stream failed: $CANCEL_OUTPUT"
    FAILED=$((FAILED + 1))
  fi

  echo ""
done

# ── Summary ───────────────────────────────────────────────────────────────────

echo ""
log "=========================================="
log "Rollback complete"
log "  Total     : $TOTAL"
log "  Cancelled : $CANCELLED"
log "  Skipped   : $SKIPPED"
log "  Warned    : $WARNED (post-cliff; run with FORCE=1 to cancel)"
log "  Failed    : $FAILED"
log "Log saved   : $LOG_FILE"
log "=========================================="

if [[ $WARNED -gt 0 ]]; then
  echo ""
  echo "NOTE: $WARNED stream(s) were skipped because the cliff has already passed."
  echo "To cancel these and recover uneaned tokens, re-run with:"
  echo "  FORCE=1 ./examples/migration-rollback.sh $STREAMS_FILE"
fi

if [[ $FAILED -gt 0 ]]; then
  echo ""
  echo "WARNING: $FAILED stream(s) failed to cancel."
  echo "Review $LOG_FILE for details."
  exit 1
fi

if [[ $CANCELLED -eq 0 && $WARNED -eq 0 ]]; then
  echo ""
  echo "No streams were cancelled (all were already absent or skipped)."
fi
