#!/usr/bin/env bash
# Stages the microtubule v7 (DINOv3-L + DPT + PySOAX) checkpoint into the
# ML service weights directory.
#
# The checkpoint (~1.2 GB) is .gitignore'd via the global ``*.pt`` rule, so it
# must be staged out-of-band on each fresh checkout.  By default we copy from
# the local ``microtubules_v7_pysoax/weights/ckpt_ep09.pt`` source folder
# (the inference package extracted from BIOCEV on 2026-05-11).
#
# Override with ``MICROTUBULE_CKPT_URL`` to fetch from a remote source instead
# (signed URL on kajman, S3, or HuggingFace LFS).
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST_DIR="${REPO_ROOT}/backend/segmentation/weights"
DEST_FILE="${DEST_DIR}/microtubule_v7.pt"

DEFAULT_SRC="${REPO_ROOT}/microtubules_v7_pysoax/weights/ckpt_ep09.pt"
REMOTE_URL="${MICROTUBULE_CKPT_URL:-}"

mkdir -p "${DEST_DIR}"

if [[ -f "${DEST_FILE}" ]]; then
  echo "✅ ${DEST_FILE} already present ($(du -h "${DEST_FILE}" | cut -f1))"
  exit 0
fi

if [[ -n "${REMOTE_URL}" ]]; then
  echo "📥 Downloading microtubule v7 from ${REMOTE_URL}"
  curl -fSL --progress-bar -o "${DEST_FILE}" "${REMOTE_URL}"
elif [[ -f "${DEFAULT_SRC}" ]]; then
  echo "📦 Copying microtubule v7 from ${DEFAULT_SRC}"
  cp "${DEFAULT_SRC}" "${DEST_FILE}"
else
  echo "❌ Cannot stage microtubule v7 weights." >&2
  echo "   Expected source: ${DEFAULT_SRC}" >&2
  echo "   Or set MICROTUBULE_CKPT_URL=<remote url> and re-run." >&2
  exit 1
fi

ACTUAL_SIZE_MB=$(du -m "${DEST_FILE}" | cut -f1)
echo "✅ Staged ${DEST_FILE} (${ACTUAL_SIZE_MB} MB)"
if [[ "${ACTUAL_SIZE_MB}" -lt 1000 ]]; then
  echo "⚠️  Warning: expected ~1200 MB; got ${ACTUAL_SIZE_MB} MB.  File may be truncated." >&2
fi
