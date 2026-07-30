#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# scripts/pin-image-digest.sh
#
# Pins a container image digest in Kubernetes and Helm manifests after a
# successful build, sign, and push from the container-registry workflow.
#
# Usage:
#   pin-image-digest.sh <full-image-ref> <version-tag> <digest>
#
# Arguments:
#   full-image-ref  Full image reference with digest,
#                   e.g. ghcr.io/org/vesting-cliff-drip-stream@sha256:abc123
#   version-tag     Semantic version tag, e.g. v1.2.3
#   digest          sha256:abc123 (the manifest digest from docker build)
#
# Files modified:
#   • k8s/deployment.yaml                    — image field + annotation
#   • helm/vesting-backend/values.yaml       — image.tag and image.digest
#
# The script is idempotent: running it twice with the same digest is safe.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

IMAGE_REF="${1:?Usage: $0 <full-image-ref> <version-tag> <digest>}"
VERSION_TAG="${2:?Usage: $0 <full-image-ref> <version-tag> <digest>}"
DIGEST="${3:?Usage: $0 <full-image-ref> <version-tag> <digest>}"

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || dirname "$(dirname "$(realpath "$0")")")"
K8S_DEPLOY="${REPO_ROOT}/k8s/deployment.yaml"
HELM_VALUES="${REPO_ROOT}/helm/vesting-backend/values.yaml"

# Validate digest format
if [[ ! "${DIGEST}" =~ ^sha256:[a-f0-9]{64}$ ]]; then
  echo "ERROR: digest must be in the form sha256:<64-hex-chars>; got: ${DIGEST}" >&2
  exit 1
fi

echo "── Pinning image digest ─────────────────────────────────────────────────"
echo "  Image ref : ${IMAGE_REF}"
echo "  Version   : ${VERSION_TAG}"
echo "  Digest    : ${DIGEST}"
echo ""

# ── 1. k8s/deployment.yaml ───────────────────────────────────────────────────
# Replace any existing image: ghcr.io/... line (with tag or digest) with the
# digest-pinned reference.
if [ ! -f "${K8S_DEPLOY}" ]; then
  echo "WARNING: ${K8S_DEPLOY} not found — skipping k8s manifest update." >&2
else
  # Update image field (handles both :tag and @sha256: variants)
  sed -i -E \
    "s|image: ghcr\.io/[^ ]+|image: ${IMAGE_REF}|g" \
    "${K8S_DEPLOY}"

  # Update the annotation
  sed -i -E \
    "s|app\.kubernetes\.io/image-digest: \"[^\"]*\"|app.kubernetes.io/image-digest: \"${DIGEST}\"|g" \
    "${K8S_DEPLOY}"

  echo "✅ Updated: ${K8S_DEPLOY}"
fi

# ── 2. helm/vesting-backend/values.yaml ──────────────────────────────────────
# The Helm chart image block looks like:
#   image:
#     repository: ghcr.io/your-org/vesting-backend
#     tag: "1.0.0"
#
# We update `tag` to the version tag and add/update `digest` for digest pinning.
# Helm templates should prefer digest when set:
#   image: "{{ .Values.image.repository }}@{{ .Values.image.digest }}"
if [ ! -f "${HELM_VALUES}" ]; then
  echo "WARNING: ${HELM_VALUES} not found — skipping Helm values update." >&2
else
  # Strip the leading 'v' from the version tag (Helm convention uses bare semver)
  BARE_VERSION="${VERSION_TAG#v}"

  # Update tag
  sed -i -E \
    "s|^(  tag: )\"[^\"]*\"|\1\"${BARE_VERSION}\"|" \
    "${HELM_VALUES}"

  # Add or update digest field beneath the tag line
  if grep -q "^  digest:" "${HELM_VALUES}"; then
    sed -i -E \
      "s|^(  digest: )\"[^\"]*\"|\1\"${DIGEST}\"|" \
      "${HELM_VALUES}"
  else
    # Insert digest line after the `tag:` line
    sed -i -E \
      "/^  tag:/{n;s|^|  digest: \"${DIGEST}\"\n|}" \
      "${HELM_VALUES}"
  fi

  echo "✅ Updated: ${HELM_VALUES}"
fi

# ── 3. Print summary ─────────────────────────────────────────────────────────
echo ""
echo "── Summary ──────────────────────────────────────────────────────────────"
echo "Files modified:"
echo "  ${K8S_DEPLOY}"
echo "  ${HELM_VALUES}"
echo ""
echo "Commit these changes and open a PR to record the pinned digest."
echo "The container-registry.yml workflow creates the PR automatically."
