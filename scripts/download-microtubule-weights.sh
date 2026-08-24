#!/usr/bin/env bash
# Stages the microtubule v5H (nnU-Net ResEnc-M + curvature-bounded instancer)
# checkpoint into the ML service weights directory.
#
# The checkpoint (~535 MB) is .gitignore'd via the global ``*.pth`` rule, so it
# must be staged out-of-band on each fresh checkout.  By default we copy from
# the local ``mt-instance-seg-v5H/weights/dino_seg_v5H.pth`` deployment package.
#
# Unlike the v7 checkpoint this replaces, it is a COMPLETE state_dict: there is
# no frozen backbone to fetch, so nothing here needs HF_TOKEN or network access
# at run time.
#
# Override with ``MICROTUBULE_CKPT_URL`` to fetch from a remote source instead
# (signed URL on kajman, S3, or HuggingFace LFS).
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST_DIR="${REPO_ROOT}/backend/segmentation/weights"
DEST_FILE="${DEST_DIR}/microtubule_v5h.pth"

DEFAULT_SRC="${REPO_ROOT}/mt-instance-seg-v5H/weights/dino_seg_v5H.pth"
REMOTE_URL="${MICROTUBULE_CKPT_URL:-}"

mkdir -p "${DEST_DIR}"

if [[ -f "${DEST_FILE}" ]]; then
  echo "✅ ${DEST_FILE} already present ($(du -h "${DEST_FILE}" | cut -f1))"
  exit 0
fi

if [[ -n "${REMOTE_URL}" ]]; then
  echo "📥 Downloading microtubule v5H from ${REMOTE_URL}"
  curl -fSL --progress-bar -o "${DEST_FILE}" "${REMOTE_URL}"
elif [[ -f "${DEFAULT_SRC}" ]]; then
  echo "📦 Copying microtubule v5H from ${DEFAULT_SRC}"
  cp "${DEFAULT_SRC}" "${DEST_FILE}"
else
  echo "❌ Cannot stage microtubule v5H weights." >&2
  echo "   Expected source: ${DEFAULT_SRC}" >&2
  echo "   Or set MICROTUBULE_CKPT_URL=<remote url> and re-run." >&2
  exit 1
fi

ACTUAL_SIZE_MB=$(du -m "${DEST_FILE}" | cut -f1)
echo "✅ Staged ${DEST_FILE} (${ACTUAL_SIZE_MB} MB)"
if [[ "${ACTUAL_SIZE_MB}" -lt 450 ]]; then
  echo "⚠️  Warning: expected ~535 MB; got ${ACTUAL_SIZE_MB} MB.  File may be truncated." >&2
fi
