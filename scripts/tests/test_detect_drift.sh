#!/usr/bin/env bash
# test_detect_drift.sh — Mocked, dependency-free tests for scripts/detect_drift.sh.
#
# Runs detect_drift.sh against a stub terraform binary and asserts exit-code
# classification, environment validation, lock-timeout handling, GITHUB_OUTPUT
# values, and that no environment fallback or secret leakage occurs.
#
# Usage: bash scripts/tests/test_detect_drift.sh

set -uo pipefail

TESTS_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
DRIFT_SCRIPT="${TESTS_DIR}/../detect_drift.sh"
WORK_DIR=""
MOCK_BIN=""
ARGS_FILE=""
OUT_FILE=""
RUN_LOG=""
RUN_STATUS=0
RUN_LOG_TEXT=""
RUN_OUTPUTS=""
RUN_ARGS=""

TEST_ENV="production"
TEST_LOCK_TIMEOUT="5m"
TEST_PLAN_EXIT="0"
TEST_SECRET=""

PASS=0
FAIL=0
declare -a FAILURES=()

pass() { PASS=$((PASS + 1)); printf '  PASS  %s\n' "$1"; }
fail() { FAIL=$((FAIL + 1)); FAILURES+=("$1"); printf '  FAIL  %s\n' "$1"; }

assert_eq() {
  if [[ "$2" == "$3" ]]; then pass "$1"; else fail "$1 — expected '${3}', got '${2}'"; fi
}

assert_contains() {
  if [[ "$2" == *"$3"* ]]; then pass "$1"; else fail "$1 — missing '${3}' in: ${2}"; fi
}

assert_not_contains() {
  if [[ "$2" != *"$3"* ]]; then pass "$1"; else fail "$1 — unexpectedly contains '${3}'"; fi
}

assert_file_contains() {
  local file="$1" needle="$2" name="$3" contents=""
  contents="$(cat "${file}" 2>/dev/null || true)"
  if [[ "${contents}" == *"${needle}"* ]]; then pass "${name}"; else fail "${name} — '${needle}' missing from ${file}"; fi
}

teardown() {
  [[ -n "${WORK_DIR}" && -d "${WORK_DIR}" ]] && rm -rf "${WORK_DIR}"
  return 0
}
trap teardown EXIT

setup() {
  WORK_DIR="$(mktemp -d)"
  ARGS_FILE="${WORK_DIR}/terraform-args.log"
  OUT_FILE="${WORK_DIR}/github-output.log"
  RUN_LOG="${WORK_DIR}/run.log"
  MOCK_BIN="${WORK_DIR}/mock-bin"
  mkdir -p "${WORK_DIR}/envs" "${WORK_DIR}/.terraform" "${MOCK_BIN}"
  : > "${WORK_DIR}/envs/staging.tfvars"
  : > "${WORK_DIR}/envs/production.tfvars"
  : > "${WORK_DIR}/.terraform/terraform.tfstate"
  rm -f "${ARGS_FILE}"

  cat > "${MOCK_BIN}/terraform" <<'MOCK'
#!/usr/bin/env bash
set -uo pipefail
printf '%s\n' "$*" >> "${MOCK_ARGS_FILE}"
case "${1:-}" in
  version)
    echo "Terraform v1.9.0 (mock)"
    exit 0
    ;;
  plan)
    cat <<'PLAN'
Terraform used the selected providers to generate the following execution plan.

  # aws_ecs_service.backend will be updated in-place
 ~ resource "aws_ecs_service" "backend" {
        + desired_count = 3 -> 1
    }

Plan: 1 to add, 2 to change, 0 to destroy.
PLAN
    exit "${MOCK_PLAN_EXIT:-0}"
    ;;
esac
exit 0
MOCK
  chmod +x "${MOCK_BIN}/terraform"
}

run_drift() {
  local -a script_args=("$@")
  RUN_STATUS=0
  rm -f "${ARGS_FILE}" "${OUT_FILE}" "${RUN_LOG}"
  (
    cd "${WORK_DIR}" || exit 1
    env \
      DRIFT_ENVIRONMENT="${TEST_ENV}" \
      DRIFT_LOCK_TIMEOUT="${TEST_LOCK_TIMEOUT}" \
      MOCK_ARGS_FILE="${ARGS_FILE}" \
      MOCK_PLAN_EXIT="${TEST_PLAN_EXIT}" \
      TERRAFORM_BIN="${MOCK_BIN}/terraform" \
      TF_DATA_DIR="${WORK_DIR}/.terraform" \
      TF_VAR_db_password="${TEST_SECRET}" \
      GITHUB_OUTPUT="${OUT_FILE}" \
      bash "${DRIFT_SCRIPT}" "${script_args[@]}"
  ) > "${RUN_LOG}" 2>&1 || RUN_STATUS=$?
  RUN_LOG_TEXT="$(cat "${RUN_LOG}" 2>/dev/null || true)"
  RUN_OUTPUTS="$(cat "${OUT_FILE}" 2>/dev/null || true)"
  RUN_ARGS="$(cat "${ARGS_FILE}" 2>/dev/null || true)"
}

reset_case() {
  TEST_ENV="production"
  TEST_LOCK_TIMEOUT="5m"
  TEST_PLAN_EXIT="0"
  TEST_SECRET=""
  printf 'environment = "%s"\n' "${TEST_ENV}" > "${WORK_DIR}/envs/${TEST_ENV}.tfvars"
  : > "${WORK_DIR}/.terraform/terraform.tfstate"
}

section() { printf '\n%s\n' "$1"; }

main() {
  printf 'detect_drift.sh mocked tests\n'

  [[ -f "${DRIFT_SCRIPT}" ]] || { printf 'missing script: %s\n' "${DRIFT_SCRIPT}" >&2; exit 1; }
  setup

  section 'Clean plan (terraform exit 0)'
  reset_case
  TEST_PLAN_EXIT="0"
  run_drift
  assert_eq "exits 0" "${RUN_STATUS}" "0"
  assert_contains "reports clean status" "${RUN_OUTPUTS}" "drift_status=clean"
  assert_contains "reports drift_detected=false" "${RUN_OUTPUTS}" "drift_detected=false"
  assert_contains "reports No changes summary" "${RUN_OUTPUTS}" "drift_summary=No changes"

  section 'Drift detected (terraform exit 2)'
  reset_case
  TEST_PLAN_EXIT="2"
  run_drift
  assert_eq "exits 2" "${RUN_STATUS}" "2"
  assert_contains "reports drift status" "${RUN_OUTPUTS}" "drift_status=drift"
  assert_contains "reports drift_detected=true" "${RUN_OUTPUTS}" "drift_detected=true"
  assert_contains "summary carries plan counts" "${RUN_OUTPUTS}" "1 to add, 2 to change, 0 to destroy"
  assert_file_contains "${WORK_DIR}/drift-plan.txt" "Plan: 1 to add" "plan artifact captures the summary"
  assert_contains "plan uses the production tfvars" "${RUN_ARGS}" "-var-file=envs/production.tfvars"

  section 'Plan error (terraform exit 1)'
  reset_case
  TEST_PLAN_EXIT="1"
  run_drift
  assert_eq "exits 1" "${RUN_STATUS}" "1"
  assert_contains "reports error status" "${RUN_OUTPUTS}" "drift_status=error"
  assert_contains "reports drift_detected=false" "${RUN_OUTPUTS}" "drift_detected=false"

  section 'Unexpected terraform exit code'
  reset_case
  TEST_PLAN_EXIT="7"
  run_drift
  assert_eq "exits 1" "${RUN_STATUS}" "1"
  assert_contains "reports error status" "${RUN_OUTPUTS}" "drift_status=error"

  section 'Lock timeout argument'
  reset_case
  TEST_PLAN_EXIT="0"
  run_drift
  assert_contains "uses default 5m lock timeout" "${RUN_ARGS}" "-lock-timeout=5m"
  TEST_LOCK_TIMEOUT="10m"
  run_drift
  assert_contains "honours DRIFT_LOCK_TIMEOUT" "${RUN_ARGS}" "-lock-timeout=10m"
  reset_case
  run_drift --lock-timeout 90s
  assert_contains "honours --lock-timeout flag" "${RUN_ARGS}" "-lock-timeout=90s"
  TEST_LOCK_TIMEOUT="forever"
  run_drift
  assert_eq "rejects invalid lock timeout" "${RUN_STATUS}" "1"
  assert_contains "invalid lock timeout reports error" "${RUN_OUTPUTS}" "drift_status=error"
  assert_eq "invalid lock timeout never runs plan" "${RUN_ARGS}" ""

  section 'Environment selection and validation'
  reset_case
  TEST_ENV="staging"
  printf 'environment = "staging"\n' > "${WORK_DIR}/envs/staging.tfvars"
  run_drift
  assert_eq "staging plan exits 0" "${RUN_STATUS}" "0"
  assert_contains "uses the staging tfvars" "${RUN_ARGS}" "-var-file=envs/staging.tfvars"
  run_drift --environment staging
  assert_contains "--environment flag selects staging" "${RUN_ARGS}" "-var-file=envs/staging.tfvars"
  TEST_ENV="production"
  run_drift --environment prod
  assert_eq "rejects unknown environment" "${RUN_STATUS}" "1"
  assert_contains "unknown environment reports error" "${RUN_OUTPUTS}" "drift_status=error"
  assert_contains "unknown environment lists valid values" "${RUN_LOG_TEXT}" "staging production"
  assert_eq "unknown environment never runs plan" "${RUN_ARGS}" ""

  section 'No production to staging fallback'
  reset_case
  TEST_ENV="production"
  rm -f "${WORK_DIR}/envs/production.tfvars"
  run_drift
  assert_eq "missing production tfvars fails" "${RUN_STATUS}" "1"
  assert_contains "missing tfvars reports error" "${RUN_OUTPUTS}" "drift_status=error"
  assert_contains "missing tfvars names the environment" "${RUN_LOG_TEXT}" "production"
  assert_eq "missing tfvars never runs plan" "${RUN_ARGS}" ""

  section 'Uninitialised backend'
  reset_case
  rm -f "${WORK_DIR}/.terraform/terraform.tfstate"
  run_drift
  assert_eq "fails without backend state" "${RUN_STATUS}" "1"
  assert_contains "uninitialised backend reports error" "${RUN_OUTPUTS}" "drift_status=error"
  assert_contains "uninitialised backend explains the fix" "${RUN_LOG_TEXT}" "terraform init"

  section 'Secret handling'
  reset_case
  TEST_PLAN_EXIT="2"
  TEST_SECRET="sup3rs3cr3t-drift-password"
  run_drift
  assert_eq "drift run still exits 2" "${RUN_STATUS}" "2"
  assert_not_contains "does not echo TF_VAR values" "${RUN_LOG_TEXT}" "${TEST_SECRET}"
  assert_not_contains "does not echo TF_VAR values into outputs" "${RUN_OUTPUTS}" "${TEST_SECRET}"
  reset_case

  section 'Help output'
  reset_case
  run_drift --help
  assert_eq "help exits 0" "${RUN_STATUS}" "0"
  assert_contains "help documents exit codes" "${RUN_LOG_TEXT}" "0 clean, 1 error, 2 drift"

  printf '\n%s\n' "----------------------------------------"
  printf 'passed: %d, failed: %d\n' "${PASS}" "${FAIL}"
  if [[ "${FAIL}" -gt 0 ]]; then
    printf 'failures:\n'
    for failure in "${FAILURES[@]}"; do printf '  - %s\n' "${failure}"; done
    exit 1
  fi
  printf 'all tests passed\n'
}

main "$@"
