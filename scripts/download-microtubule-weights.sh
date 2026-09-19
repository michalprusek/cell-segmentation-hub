#!/usr/bin/env bash
# Stages the microtubule SPARSE35 ep040 (nnU-Net ResEnc-M + curvature-bounded
# instancer) checkpoint into the ML service weights directory and verifies it.
#
# The checkpoint (~535 MB) is .gitignore'd via the global ``*.pth`` rule, so it
# must be staged out-of-band on each fresh checkout. Sources, in order:
#
#   MICROTUBULE_CKPT_URL   a remote URL (curl)
#   MICROTUBULE_CKPT_SRC   a local file
#   ./mt-model-src/<name>  the default local staging directory (gitignored)
#
# Provenance: tulen:/disk2/prusek/mt_work/runs/SPARSE35/ep040.pth -- the
# checkpoint the declared read of 2026-09-15 measured (roi303 TEST 0.641, htw
# TEST 0.601; see backend/segmentation/models/microtubule/MODEL_CARD.md). The
# sha256 below pins it; a file that does not match is refused, because a wrong
# checkpoint of the right shape loads without a single error.
#
# It is a COMPLETE state_dict: no frozen backbone, no HF_TOKEN, no network
# access at run time. The previous checkpoint (microtubule_v5h.pth) may stay on
# disk beside it as the rollback.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST_DIR="${REPO_ROOT}/backend/segmentation/weights"
NAME="microtubule_sparse35_ep040.pth"
DEST_FILE="${DEST_DIR}/${NAME}"
EXPECTED_SHA256="db78ec2d661c4f92557a02378f30b0f710c681c7609061e41828f92acd633531"

DEFAULT_SRC="${REPO_ROOT}/mt-model-src/${NAME}"
REMOTE_URL="${MICROTUBULE_CKPT_URL:-}"
LOCAL_SRC="${MICROTUBULE_CKPT_SRC:-${DEFAULT_SRC}}"

sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1
  else shasum -a 256 "$1" | cut -d' ' -f1; fi
}

mkdir -p "${DEST_DIR}"

if [[ -f "${DEST_FILE}" ]]; then
  ACTUAL="$(sha256_of "${DEST_FILE}")"
  if [[ "${ACTUAL}" == "${EXPECTED_SHA256}" ]]; then
    echo "✅ ${DEST_FILE} already present and verified ($(du -h "${DEST_FILE}" | cut -f1))"
    exit 0
  fi
  echo "❌ ${DEST_FILE} exists but its sha256 ${ACTUAL:0:12}… is not the pinned ${EXPECTED_SHA256:0:12}…" >&2
  echo "   Remove or rename it, then re-run." >&2
  exit 1
fi

if [[ -n "${REMOTE_URL}" ]]; then
  echo "📥 Downloading microtubule SPARSE35 ep040 from ${REMOTE_URL}"
  curl -fSL --progress-bar -o "${DEST_FILE}.part" "${REMOTE_URL}"
elif [[ -f "${LOCAL_SRC}" ]]; then
  echo "📦 Copying microtubule SPARSE35 ep040 from ${LOCAL_SRC}"
  cp "${LOCAL_SRC}" "${DEST_FILE}.part"
else
  echo "❌ Cannot stage microtubule SPARSE35 ep040 weights." >&2
  echo "   Expected a local copy at: ${LOCAL_SRC}" >&2
  echo "   (source of record: tulen:/disk2/prusek/mt_work/runs/SPARSE35/ep040.pth)" >&2
  echo "   Or set MICROTUBULE_CKPT_URL=<remote url> / MICROTUBULE_CKPT_SRC=<local file> and re-run." >&2
  exit 1
fi

ACTUAL="$(sha256_of "${DEST_FILE}.part")"
if [[ "${ACTUAL}" != "${EXPECTED_SHA256}" ]]; then
  rm -f "${DEST_FILE}.part"
  echo "❌ sha256 mismatch: got ${ACTUAL}, expected ${EXPECTED_SHA256}. Nothing staged." >&2
  exit 1
fi
mv "${DEST_FILE}.part" "${DEST_FILE}"
echo "✅ Staged and verified ${DEST_FILE} ($(du -h "${DEST_FILE}" | cut -f1))"
