#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
# migrate_from_drips.sh
#
# Migrates active streams from a standard Drips deployment to the
# vesting-cliff-drip-stream Soroban contract.
#
# Usage:
#   ./scripts/migrate_from_drips.sh <streams-json>
#
# Arguments:
#   streams-json   Path to a JSON file describing streams to create.
#                  See docs/comparison.md#phase-2 for the expected schema.
#
# Required env vars:
#   VESTING_CONTRACT   Deployed contract ID (C...)
#   SPONSOR            Stellar key name (from `stellar keys ls`) that will
#                      sign creation transactions and own all new streams.
#   TOKEN              SAC token contract address (C...)
#   NETWORK            Stellar network (testnet | mainnet). Defaults to testnet.
#
# Optional env vars:
#   DRY_RUN            Set to "1" to print commands without executing them.
#   RATE_OVERRIDE      If set, overrides the "rate" field for every stream.
#   CLIFF_OVERRIDE     If set, overrides the "cliff_duration" field for every stream.
#
# Stream JSON schema (array of objects):
#   [
#     {
#       "recipient":      "G...",       -- required
#       "rate":           10,           -- tokens/ledger; required unless RATE_OVERRIDE set
#       "remaining_balance": 45000,     -- used to derive total_duration (= balance / rate)
#       "cliff_duration": 17280,        -- required unless CLIFF_OVERRIDE set
#       "comment":        "Alice grant" -- optional; printed to log only
#     },
#     ...
#   ]
#
#   total_duration is computed as ceil(remaining_balance / rate).
#   If you want to set total_duration explicitly, add it as a field and the
#   script will use it directly (skips the balance / rate calculation).
#
# Output:
#   Writes a migration log to migrate_log_<timestamp>.txt in the current dir.
#   Each line records: recipient | status (OK / SKIP / ERROR) | tx hash or reason
#
# See also:
#   docs/comparison.md        -- full migration guide
#   examples/migration-rollback.sh -- how to undo this migration
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
: "${TOKEN:?ERROR: TOKEN must be set}"
NETWORK="${NETWORK:-testnet}"
DRY_RUN="${DRY_RUN:-0}"

# ── Dependency check ──────────────────────────────────────────────────────────

for cmd in stellar jq bc; do
  if ! command -v "$cmd" &>/dev/null; then
    echo "ERROR: required command not found: $cmd" >&2
    exit 1
  fi
done

# ── Log setup ─────────────────────────────────────────────────────────────────

TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
LOG_FILE="migrate_log_${TIMESTAMP}.txt"
exec > >(tee -a "$LOG_FILE") 2>&1

log() { echo "[$(date -u +%H:%M:%SZ)] $*"; }
log_ok()    { echo "[$(date -u +%H:%M:%SZ)] OK    | $*"; }
log_skip()  { echo "[$(date -u +%H:%M:%SZ)] SKIP  | $*"; }
log_error() { echo "[$(date -u +%H:%M:%SZ)] ERROR | $*"; }

# ── Summary counters ──────────────────────────────────────────────────────────

TOTAL=0
CREATED=0
SKIPPED=0
FAILED=0

# ── Helper: invoke a stellar contract command ─────────────────────────────────

invoke_contract() {
  # Usage: invoke_contract <function> [--arg value ...]
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

# ── Helper: check if a schedule already exists for a recipient ────────────────

schedule_exists() {
  local recipient="$1"
  local result
  # get_schedule returns null (None) if no schedule exists
  result=$(stellar contract invoke \
    --id "$VESTING_CONTRACT" \
    --source "$SPONSOR" \
    --network "$NETWORK" \
    -- \
    get_schedule \
    --recipient "$recipient" 2>&1) || true

  if echo "$result" | grep -q '"version"'; then
    return 0  # schedule exists
  fi
  return 1    # no schedule
}

# ── Helper: ceil division ─────────────────────────────────────────────────────

ceil_div() {
  local numerator="$1"
  local denominator="$2"
  echo $(( (numerator + denominator - 1) / denominator ))
}

# ── Main migration loop ───────────────────────────────────────────────────────

log "=========================================="
log "vesting-cliff-drip-stream migration"
log "Contract  : $VESTING_CONTRACT"
log "Sponsor   : $SPONSOR"
log "Token     : $TOKEN"
log "Network   : $NETWORK"
log "Streams   : $STREAMS_FILE"
log "Dry run   : $DRY_RUN"
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

  # ── Resolve rate ────────────────────────────────────────────────────────────
  if [[ -n "${RATE_OVERRIDE:-}" ]]; then
    RATE="$RATE_OVERRIDE"
  else
    RATE=$(echo "$ENTRY" | jq -r '.rate')
    if [[ "$RATE" == "null" || -z "$RATE" ]]; then
      log_error "$RECIPIENT | missing 'rate' field and RATE_OVERRIDE not set"
      FAILED=$((FAILED + 1))
      continue
    fi
  fi

  # ── Resolve cliff_duration ──────────────────────────────────────────────────
  if [[ -n "${CLIFF_OVERRIDE:-}" ]]; then
    CLIFF_DURATION="$CLIFF_OVERRIDE"
  else
    CLIFF_DURATION=$(echo "$ENTRY" | jq -r '.cliff_duration')
    if [[ "$CLIFF_DURATION" == "null" || -z "$CLIFF_DURATION" ]]; then
      log_error "$RECIPIENT | missing 'cliff_duration' field and CLIFF_OVERRIDE not set"
      FAILED=$((FAILED + 1))
      continue
    fi
  fi

  # ── Resolve total_duration ──────────────────────────────────────────────────
  TOTAL_DURATION=$(echo "$ENTRY" | jq -r '.total_duration // empty')
  if [[ -z "$TOTAL_DURATION" ]]; then
    REMAINING=$(echo "$ENTRY" | jq -r '.remaining_balance')
    if [[ "$REMAINING" == "null" || -z "$REMAINING" ]]; then
      log_error "$RECIPIENT | need either 'total_duration' or 'remaining_balance'"
      FAILED=$((FAILED + 1))
      continue
    fi
    TOTAL_DURATION=$(ceil_div "$REMAINING" "$RATE")
    log "  Derived total_duration=$TOTAL_DURATION (ceil($REMAINING / $RATE))"
  fi

  # ── Validate total_duration > cliff_duration ────────────────────────────────
  if (( TOTAL_DURATION <= CLIFF_DURATION )); then
    log_error "$RECIPIENT | total_duration ($TOTAL_DURATION) must be > cliff_duration ($CLIFF_DURATION)"
    FAILED=$((FAILED + 1))
    continue
  fi

  DEPOSIT=$(( RATE * TOTAL_DURATION ))
  log "  rate=$RATE cliff=$CLIFF_DURATION total_duration=$TOTAL_DURATION deposit=$DEPOSIT"

  # ── Check for existing schedule ─────────────────────────────────────────────
  if schedule_exists "$RECIPIENT"; then
    log_skip "$RECIPIENT | schedule already exists — skipping (cancel first to replace)"
    SKIPPED=$((SKIPPED + 1))
    continue
  fi

  # ── Create the stream ────────────────────────────────────────────────────────
  if CREATE_OUTPUT=$(invoke_contract create_vesting_stream \
      --sponsor "$SPONSOR" \
      --recipient "$RECIPIENT" \
      --token "$TOKEN" \
      --rate "$RATE" \
      --cliff_duration "$CLIFF_DURATION" \
      --total_duration "$TOTAL_DURATION" 2>&1); then
    log_ok "$RECIPIENT | created | deposit=$DEPOSIT"
    CREATED=$((CREATED + 1))
  else
    log_error "$RECIPIENT | create_vesting_stream failed: $CREATE_OUTPUT"
    FAILED=$((FAILED + 1))
  fi

  echo ""
done

# ── Summary ───────────────────────────────────────────────────────────────────

echo ""
log "=========================================="
log "Migration complete"
log "  Total    : $TOTAL"
log "  Created  : $CREATED"
log "  Skipped  : $SKIPPED"
log "  Failed   : $FAILED"
log "Log saved  : $LOG_FILE"
log "=========================================="

if [[ $FAILED -gt 0 ]]; then
  echo ""
  echo "WARNING: $FAILED stream(s) failed to migrate."
  echo "Review $LOG_FILE for details."
  echo "To rollback successfully created streams, run:"
  echo "  ./examples/migration-rollback.sh $STREAMS_FILE"
  exit 1
fi
