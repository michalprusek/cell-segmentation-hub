#!/usr/bin/env bash
# Stages a microtubule checkpoint into the ML service weights directory and
# verifies it. Without an argument: V16 DEB_S4 ep040, the interactive service's.
# With microtubule_sparse35_ep040.pth: SPARSE35 ep040, the essays batch's.
#
# The checkpoint (~535 MB) is .gitignore'd via the global ``*.pth`` rule, so it
# must be staged out-of-band on each fresh checkout. Sources, in order:
#
#   MICROTUBULE_CKPT_URL   a remote URL (curl)
#   MICROTUBULE_CKPT_SRC   a local file
#   ./mt-model-src/<name>  the default local staging directory (gitignored)
#
# Provenance: kajman:/data2/prusek/mt_work/runs/DEB_S4/ep040.pth and
# tulen:/disk2/prusek/mt_work/runs/SPARSE35/ep040.pth; what each scores is in
# backend/segmentation/models/microtubule/MODEL_CARD.md. The sha256 below pins
# each; a file that does not match is refused, because a wrong
# checkpoint of the right shape loads without a single error.
#
# It is a COMPLETE state_dict: no frozen backbone, no HF_TOKEN, no network
# access at run time. Both checkpoints stay on disk side by side: SPARSE35 is
# the essays batch's model and the interactive service's rollback.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST_DIR="${REPO_ROOT}/backend/segmentation/weights"
NAME="${1:-microtubule_v16_deb_s4_ep040.pth}"
DEST_FILE="${DEST_DIR}/${NAME}"
case "${NAME}" in
  microtubule_v16_deb_s4_ep040.pth)
    EXPECTED_SHA256="8fc22555737b2054f89c73db417314e5f4f89be0d4514bc60c6993508ec42f73"
    RECORD="kajman:/data2/prusek/mt_work/runs/DEB_S4/ep040.pth" ;;
  microtubule_sparse35_ep040.pth)
    EXPECTED_SHA256="db78ec2d661c4f92557a02378f30b0f710c681c7609061e41828f92acd633531"
    RECORD="tulen:/disk2/prusek/mt_work/runs/SPARSE35/ep040.pth" ;;
  *) echo "❌ Unknown microtubule checkpoint: ${NAME}" >&2; exit 1 ;;
esac

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
  echo "📥 Downloading ${NAME} from ${REMOTE_URL}"
  curl -fSL --progress-bar -o "${DEST_FILE}.part" "${REMOTE_URL}"
elif [[ -f "${LOCAL_SRC}" ]]; then
  echo "📦 Copying ${NAME} from ${LOCAL_SRC}"
  cp "${LOCAL_SRC}" "${DEST_FILE}.part"
else
  echo "❌ Cannot stage ${NAME}." >&2
  echo "   Expected a local copy at: ${LOCAL_SRC}" >&2
  echo "   (source of record: ${RECORD})" >&2
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
