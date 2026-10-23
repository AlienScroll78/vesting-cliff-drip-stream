#!/usr/bin/env bash
# =============================================================================
# test-network-policies.sh
#
# CI script that verifies Kubernetes NetworkPolicy enforcement using
# kubectl exec + netcat (nc) probes.
#
# WHAT IT TESTS
# ─────────────
# Allowed paths (must succeed — nc exits 0 within the timeout):
#   ✓ frontend           → backend-api:3000
#   ✓ backend-api        → postgresql:5432
#   ✓ backend-api        → redis:6379
#   ✓ event-worker       → 1.1.1.1:443  (public HTTPS, simulates Horizon)
#   ✓ prometheus         → backend-api:9090
#   ✓ ingress-nginx      → frontend:3000
#   ✓ ingress-nginx      → backend-api:3000
#
# Blocked paths (must fail — nc times out / exits non-zero):
#   ✗ frontend           → postgresql:5432  (must be blocked)
#   ✗ frontend           → redis:6379       (must be blocked)
#   ✗ event-worker       → postgresql:5432  (must be blocked)
#   ✗ event-worker       → redis:6379       (must be blocked)
#   ✗ postgresql         → redis:6379       (lateral movement blocked)
#   ✗ redis              → postgresql:5432  (lateral movement blocked)
#
# REQUIREMENTS
# ─────────────
#   - kubectl configured with access to the target cluster
#   - Namespace "vesting" exists and pods are Running
#   - A debug/netcat image is available (default: busybox:1.36.1)
#     The image must have `nc` (netcat) available.
#   - NetworkPolicies already applied:  kubectl apply -k k8s/network-policies/
#
# USAGE
#   # Run against the current kubectl context:
#   ./scripts/test-network-policies.sh
#
#   # Override namespace or image:
#   NAMESPACE=staging DEBUG_IMAGE=nicolaka/netshoot:v0.13 \
#     ./scripts/test-network-policies.sh
#
# EXIT CODES
#   0  All assertions passed
#   1  One or more assertions failed (see summary at end)
# =============================================================================
set -euo pipefail

# ── Configuration ─────────────────────────────────────────────────────────────
NAMESPACE="${NAMESPACE:-vesting}"
DEBUG_IMAGE="${DEBUG_IMAGE:-busybox:1.36.1}"
# Seconds to wait for a TCP connection before declaring it blocked
PROBE_TIMEOUT="${PROBE_TIMEOUT:-5}"
# kubectl exec timeout (slightly longer to account for pod startup overhead)
EXEC_TIMEOUT="${EXEC_TIMEOUT:-10}"

# Colours (disabled when not a TTY)
if [ -t 1 ]; then
  RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
  BOLD='\033[1m'; RESET='\033[0m'
else
  RED=''; GREEN=''; YELLOW=''; BOLD=''; RESET=''
fi

# ── State tracking ─────────────────────────────────────────────────────────────
PASS=0
FAIL=0
SKIP=0
declare -a FAILURES=()

# ── Helpers ────────────────────────────────────────────────────────────────────

# get_pod_name <label-selector>
# Returns the first Running pod matching the label selector in $NAMESPACE.
get_pod_name() {
  local selector="$1"
  kubectl get pod -n "$NAMESPACE" \
    -l "$selector" \
    --field-selector=status.phase=Running \
    -o jsonpath='{.items[0].metadata.name}' 2>/dev/null
}

# probe_tcp <from-pod> <target-host> <target-port>
# Returns 0 if connection succeeds within PROBE_TIMEOUT, non-zero otherwise.
probe_tcp() {
  local pod="$1" host="$2" port="$3"
  kubectl exec -n "$NAMESPACE" "$pod" \
    --request-timeout="${EXEC_TIMEOUT}s" \
    -- sh -c "nc -z -w ${PROBE_TIMEOUT} '${host}' '${port}' 2>/dev/null" \
    2>/dev/null
}

# assert_allowed <description> <from-selector> <target-host> <target-port>
assert_allowed() {
  local desc="$1" selector="$2" host="$3" port="$4"
  local pod
  pod=$(get_pod_name "$selector")

  if [ -z "$pod" ]; then
    echo -e "  ${YELLOW}SKIP${RESET}  $desc  (no running pod for selector: $selector)"
    ((SKIP++)) || true
    return
  fi

  if probe_tcp "$pod" "$host" "$port"; then
    echo -e "  ${GREEN}PASS${RESET}  $desc"
    ((PASS++)) || true
  else
    echo -e "  ${RED}FAIL${RESET}  $desc  — expected ALLOWED but connection was blocked"
    FAILURES+=("FAIL [allowed expected]:  $desc")
    ((FAIL++)) || true
  fi
}

# assert_blocked <description> <from-selector> <target-host> <target-port>
assert_blocked() {
  local desc="$1" selector="$2" host="$3" port="$4"
  local pod
  pod=$(get_pod_name "$selector")

  if [ -z "$pod" ]; then
    echo -e "  ${YELLOW}SKIP${RESET}  $desc  (no running pod for selector: $selector)"
    ((SKIP++)) || true
    return
  fi

  if probe_tcp "$pod" "$host" "$port"; then
    echo -e "  ${RED}FAIL${RESET}  $desc  — expected BLOCKED but connection succeeded"
    FAILURES+=("FAIL [blocked expected]:  $desc")
    ((FAIL++)) || true
  else
    echo -e "  ${GREEN}PASS${RESET}  $desc"
    ((PASS++)) || true
  fi
}

# ── Pre-flight checks ──────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}Network Policy Test Suite${RESET}"
echo -e "Namespace : ${NAMESPACE}"
echo -e "Image     : ${DEBUG_IMAGE}"
echo -e "Timeout   : ${PROBE_TIMEOUT}s per probe"
echo "──────────────────────────────────────────────────────────────────────────"

# Verify kubectl connectivity
if ! kubectl get namespace "$NAMESPACE" &>/dev/null; then
  echo -e "${RED}ERROR${RESET}: namespace '$NAMESPACE' not found or kubectl not configured."
  exit 1
fi

# ── Service host resolution ────────────────────────────────────────────────────
# Service DNS names follow the pattern: <service-name>.<namespace>.svc.cluster.local
# For readability we use short names (works within the same namespace).
FRONTEND_SVC="frontend"
BACKEND_SVC="vesting-backend"
POSTGRES_SVC="postgresql"
REDIS_SVC="redis"

# ── ALLOWED PATHS ──────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}Allowed paths (should succeed)${RESET}"

assert_allowed \
  "frontend → backend-api:3000" \
  "app.kubernetes.io/name=frontend" \
  "$BACKEND_SVC" 3000

assert_allowed \
  "backend-api → postgresql:5432" \
  "app.kubernetes.io/name=vesting-backend" \
  "$POSTGRES_SVC" 5432

assert_allowed \
  "backend-api → redis:6379" \
  "app.kubernetes.io/name=vesting-backend" \
  "$REDIS_SVC" 6379

assert_allowed \
  "event-worker → Horizon (1.1.1.1:443, public HTTPS)" \
  "app.kubernetes.io/name=event-worker" \
  "1.1.1.1" 443

assert_allowed \
  "prometheus → backend-api:9090 (metrics scrape)" \
  "app.kubernetes.io/name=prometheus" \
  "$BACKEND_SVC" 9090

# ingress-nginx runs in its own namespace; exec from within the ingress pod
# requires re-targeting to the ingress-nginx namespace.
INGRESS_POD=$(kubectl get pod -n ingress-nginx \
  -l "app.kubernetes.io/name=ingress-nginx" \
  --field-selector=status.phase=Running \
  -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || true)

if [ -n "$INGRESS_POD" ]; then
  if kubectl exec -n ingress-nginx "$INGRESS_POD" \
       --request-timeout="${EXEC_TIMEOUT}s" \
       -- sh -c "nc -z -w ${PROBE_TIMEOUT} ${FRONTEND_SVC}.${NAMESPACE}.svc.cluster.local 3000 2>/dev/null" \
       2>/dev/null; then
    echo -e "  ${GREEN}PASS${RESET}  ingress-nginx → frontend:3000"
    ((PASS++)) || true
  else
    echo -e "  ${RED}FAIL${RESET}  ingress-nginx → frontend:3000  — expected ALLOWED but blocked"
    FAILURES+=("FAIL [allowed expected]:  ingress-nginx → frontend:3000")
    ((FAIL++)) || true
  fi

  if kubectl exec -n ingress-nginx "$INGRESS_POD" \
       --request-timeout="${EXEC_TIMEOUT}s" \
       -- sh -c "nc -z -w ${PROBE_TIMEOUT} ${BACKEND_SVC}.${NAMESPACE}.svc.cluster.local 3000 2>/dev/null" \
       2>/dev/null; then
    echo -e "  ${GREEN}PASS${RESET}  ingress-nginx → backend-api:3000"
    ((PASS++)) || true
  else
    echo -e "  ${RED}FAIL${RESET}  ingress-nginx → backend-api:3000  — expected ALLOWED but blocked"
    FAILURES+=("FAIL [allowed expected]:  ingress-nginx → backend-api:3000")
    ((FAIL++)) || true
  fi
else
  echo -e "  ${YELLOW}SKIP${RESET}  ingress-nginx → frontend:3000  (no running ingress-nginx pod found)"
  echo -e "  ${YELLOW}SKIP${RESET}  ingress-nginx → backend-api:3000  (no running ingress-nginx pod found)"
  ((SKIP+=2)) || true
fi

# ── BLOCKED PATHS ──────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}Blocked paths (should be rejected by NetworkPolicy)${RESET}"

assert_blocked \
  "frontend → postgresql:5432  (must be blocked)" \
  "app.kubernetes.io/name=frontend" \
  "$POSTGRES_SVC" 5432

assert_blocked \
  "frontend → redis:6379  (must be blocked)" \
  "app.kubernetes.io/name=frontend" \
  "$REDIS_SVC" 6379

assert_blocked \
  "event-worker → postgresql:5432  (must be blocked)" \
  "app.kubernetes.io/name=event-worker" \
  "$POSTGRES_SVC" 5432

assert_blocked \
  "event-worker → redis:6379  (must be blocked)" \
  "app.kubernetes.io/name=event-worker" \
  "$REDIS_SVC" 6379

assert_blocked \
  "postgresql → redis:6379  (lateral movement blocked)" \
  "app.kubernetes.io/name=postgresql" \
  "$REDIS_SVC" 6379

assert_blocked \
  "redis → postgresql:5432  (lateral movement blocked)" \
  "app.kubernetes.io/name=redis" \
  "$POSTGRES_SVC" 5432

# ── Summary ────────────────────────────────────────────────────────────────────
echo ""
echo "──────────────────────────────────────────────────────────────────────────"
echo -e "${BOLD}Results: ${GREEN}${PASS} passed${RESET}  ${RED}${FAIL} failed${RESET}  ${YELLOW}${SKIP} skipped${RESET}"

if [ "${#FAILURES[@]}" -gt 0 ]; then
  echo ""
  echo -e "${RED}${BOLD}Failed assertions:${RESET}"
  for f in "${FAILURES[@]}"; do
    echo "  • $f"
  done
  echo ""
  echo -e "${RED}${BOLD}NETWORK POLICY TESTS FAILED${RESET}"
  exit 1
fi

echo ""
echo -e "${GREEN}${BOLD}All network policy tests passed.${RESET}"
exit 0
