#!/usr/bin/env bash
# Stages the neurite/soma (nnU-Net v2 ResEnc-M, 2D, 3-class) weight bundle into
# the ML service weights directory.
#
# Unlike every other model here the destination is a DIRECTORY, not a file. The
# bundle is five files that only mean anything together:
#
#   fold_0.pth  fold_1.pth  fold_2.pth   ~560 MB each, inference weights only
#   plans.json                           architecture + patch size; the wrapper
#                                        BUILDS the network from it
#   dataset.json                         channel names and label ids
#
# The checkpoints are .gitignore'd via the global ``*.pth`` rule and the whole
# ``backend/segmentation/weights/`` tree is ignored, so the bundle must be staged
# out-of-band on each fresh checkout. 1.6 GB does not belong in git.
#
# Provenance
# ----------
# Trained 2026-08-27 on ``Dataset102_NeuriteSoma`` — 9 expert-annotated Leica
# confocal frames, Run_no.4, tubulin channel (Stepanka; CVAT project 29, task
# 579), 3x ctrl / 3x imax / 3x wt. nnU-Net v2 ResEnc-M, 2D, 512x512 patch,
# Dice + CE + clDice on the neurite class, 250 epochs per fold. Held-out
# (grouped leave-one-condition-out) Dice: neurite 0.832, soma 0.915.
#
# The checkpoints hold INFERENCE weights only — optimizer state and training
# bookkeeping were stripped, halving them from 1121 MB to 560 MB. The full
# training checkpoints, if a resume is ever needed, are on tulen at
# ``~/BIOCEV/data/stepanka_neurons/nnunet/nnUNet_results/Dataset102_NeuriteSoma/``.
# Training / evaluation code: BIOCEV repo, ``code/stepanka_neurons/nnunet/``.
#
# Nothing is downloaded at run time: the checkpoints carry every weight, so this
# model needs no HF_TOKEN, no HuggingFace account and no network access.
#
# Sources, in order of preference:
#   1. ``NEURITE_SOMA_SRC_DIR=<dir>``  — copy from an explicit local directory
#   2. ``NEURITE_SOMA_WEIGHTS_URL=<url>`` — fetch a .tar.gz of the five files
#   3. ``<repo>/neurite-soma-seg/weights`` — the local deployment package
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST_DIR="${REPO_ROOT}/backend/segmentation/weights/neurite_soma"

DEFAULT_SRC="${REPO_ROOT}/neurite-soma-seg/weights"
SRC_DIR="${NEURITE_SOMA_SRC_DIR:-${DEFAULT_SRC}}"
REMOTE_URL="${NEURITE_SOMA_WEIGHTS_URL:-}"

REQUIRED=(fold_0.pth fold_1.pth fold_2.pth plans.json dataset.json)

have_all() {
  local dir="$1" f
  for f in "${REQUIRED[@]}"; do
    [[ -f "${dir}/${f}" ]] || return 1
  done
  return 0
}

if have_all "${DEST_DIR}"; then
  echo "✅ ${DEST_DIR} already complete ($(du -sh "${DEST_DIR}" | cut -f1))"
  exit 0
fi

# NOTE: the destination is deliberately NOT created before a source is
# confirmed. `ModelLoader.load_model` guards on `Path.exists()`, which is true
# for an EMPTY directory, and `get_model_info()` would then serve
# `has_pretrained: true` over GET /api/v1/models for a bundle that is not there —
# the miss would only surface as a 500 on the first inference.
if [[ -n "${REMOTE_URL}" ]]; then
  echo "📥 Downloading neurite/soma bundle from ${REMOTE_URL}"
  TMP_TGZ="$(mktemp -t neurite-soma-XXXXXX.tar.gz)"
  # shellcheck disable=SC2064  # expand TMP_TGZ now, not at trap time
  trap "rm -f '${TMP_TGZ}'" EXIT
  curl -fSL --progress-bar -o "${TMP_TGZ}" "${REMOTE_URL}"
  mkdir -p "${DEST_DIR}"
  # Detect the layout instead of trying --strip-components first and falling
  # back on failure: for a FLAT archive `tar --strip-components=1` extracts
  # nothing and still exits 0, so an `|| tar ...` fallback never runs and the
  # bundle silently ends up empty.
  #
  # The listing is captured into a variable rather than piped into `grep -q`.
  # grep -q exits on the first match, tar dies of SIGPIPE, and under the
  # `pipefail` above that makes the whole probe report false — for any archive
  # large enough that tar has not already finished writing. Measured: a 3 MB
  # tarball took the wrong branch, a 5 KB one did not.
  MEMBERS="$(tar -tzf "${TMP_TGZ}")"
  TOP_LEVELS="$(printf '%s\n' "${MEMBERS}" | sed 's#/.*##' | sort -u | wc -l)"
  # Nested = every member sits under ONE top-level directory, and at least one
  # of them is a file inside it (so a flat archive of a single file is not
  # mistaken for a wrapper directory).
  if [[ "${TOP_LEVELS}" -eq 1 ]] && grep -qE '^[^/]+/.+' <<<"${MEMBERS}"; then
    tar -xzf "${TMP_TGZ}" -C "${DEST_DIR}" --strip-components=1
  else
    tar -xzf "${TMP_TGZ}" -C "${DEST_DIR}"
  fi
elif have_all "${SRC_DIR}"; then
  echo "📦 Copying neurite/soma bundle from ${SRC_DIR}"
  mkdir -p "${DEST_DIR}"
  for f in "${REQUIRED[@]}"; do
    cp "${SRC_DIR}/${f}" "${DEST_DIR}/${f}"
  done
else
  echo "❌ Cannot stage neurite/soma weights." >&2
  echo "   Expected these 5 files in ${SRC_DIR}:" >&2
  printf '     %s\n' "${REQUIRED[@]}" >&2
  echo "   Or set NEURITE_SOMA_SRC_DIR=<dir> / NEURITE_SOMA_WEIGHTS_URL=<url> and re-run." >&2
  exit 1
fi

MISSING=0
for f in "${REQUIRED[@]}"; do
  if [[ ! -f "${DEST_DIR}/${f}" ]]; then
    echo "❌ Missing after staging: ${f}" >&2
    MISSING=1
  fi
done
if [[ "${MISSING}" -ne 0 ]]; then
  # Remove the half-populated bundle for the same reason we did not create it
  # early: a directory that exists but is incomplete reads as a present model.
  echo "🧹 Removing incomplete ${DEST_DIR}" >&2
  rm -rf "${DEST_DIR}"
  exit 1
fi

for f in fold_0.pth fold_1.pth fold_2.pth; do
  SIZE_MB=$(du -m "${DEST_DIR}/${f}" | cut -f1)
  # A checkpoint truncated by a half-finished copy still loads far enough to
  # look plausible, so check the size rather than trusting the file exists.
  if [[ "${SIZE_MB}" -lt 500 ]]; then
    echo "⚠️  Warning: ${f} is ${SIZE_MB} MB; expected ~535 MB. File may be truncated." >&2
  fi
done

echo "✅ Staged ${DEST_DIR} ($(du -sh "${DEST_DIR}" | cut -f1))"
