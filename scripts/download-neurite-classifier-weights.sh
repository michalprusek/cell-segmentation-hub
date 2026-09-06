#!/usr/bin/env bash
# Stages the soma classifier (fine-tuned ResNet-18, 3-seed ensemble) into the ML
# service weights directory.
#
# WHAT IT IS FOR
# --------------
# The neurite metrics pipeline instances somas from the semantic mask, and a
# large share of those instances are not neuronal cell bodies at all: measured
# on Stepanka's review of 251 crops (CVAT task 717), **47 % of the expert's own
# `soma` polygons** are registered growth cones, cell fragments, two dead cells
# and one looped neurite.
#
# That is not a labelling curiosity. A neurite whose far end is the cell's OWN
# growth cone looks exactly like a neurite connecting two cells, and the
# arc-length rule then credits half its length to the growth cone. Scoring the
# endpoints of every detected connection, **76 % lose an endpoint** once the
# classifier is applied. Without this bundle the service still runs
# (`classify=false`), but connections are over-reported and their lengths are
# mis-split.
#
# PROVENANCE AND LIMITS
# ---------------------
# Fine-tuned ImageNet ResNet-18, three-seed ensemble. Leave-one-frame-out
# ROC-AUC 0.956, balanced accuracy 0.901. Chosen over a frozen-feature probe by
# measurement, not preference -- see `neurite-metrics/weights/CLASSIFIER.md`.
#
#   * trained on CONFOCAL only (ctrl + imax + 10 crops of wt) -- no spinning disk
#   * balanced accuracy 0.901, so roughly ONE INSTANCE IN TEN is misjudged
#   * rejected instances are kept in the exported table with `soma_neuronal = 0`,
#     never deleted, so the rejection rate stays auditable
#
# The checkpoint is 129 MB and `backend/segmentation/weights/` is .gitignore'd
# wholesale, so it must be staged out-of-band on each fresh checkout.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST="${REPO_ROOT}/backend/segmentation/weights/neurite_soma_classifier.pt"

DEFAULT_SRC="${REPO_ROOT}/neurite-metrics/weights/soma_clf_ft18.pt"
SRC="${NEURITE_CLASSIFIER_SRC:-${DEFAULT_SRC}}"
REMOTE_URL="${NEURITE_CLASSIFIER_URL:-}"

if [[ -f "${DEST}" ]]; then
  echo "✅ ${DEST} already staged ($(du -h "${DEST}" | cut -f1))"
  exit 0
fi

# The destination is written via a temp file + mv, never opened in place: a
# checkpoint truncated by an interrupted copy still passes the -f test above,
# so the next run would report it staged and the failure would surface as a
# torch.load error on the first export instead of here.
TMP="$(mktemp "${DEST}.XXXXXX")"
# shellcheck disable=SC2064  # expand TMP now, not at trap time
trap "rm -f '${TMP}'" EXIT

if [[ -n "${REMOTE_URL}" ]]; then
  echo "📥 Downloading soma classifier from ${REMOTE_URL}"
  curl -fSL --progress-bar -o "${TMP}" "${REMOTE_URL}"
elif [[ -f "${SRC}" ]]; then
  echo "📦 Copying soma classifier from ${SRC}"
  cp "${SRC}" "${TMP}"
else
  cat >&2 <<EOF
❌ No soma classifier weights found.

  Looked for a local copy at:
    ${SRC}
  (override with NEURITE_CLASSIFIER_SRC=/path/to/soma_clf_ft18.pt)

  Or set a URL:
    NEURITE_CLASSIFIER_URL=https://... $0

The service runs without it, but neurite metrics must then be requested with
classify=false, which over-reports connections between cells -- see the header
of this script for the measured numbers.
EOF
  exit 1
fi

mv "${TMP}" "${DEST}"
trap - EXIT

# The ML container runs as uid 999; a root-owned checkpoint is unreadable there.
if command -v chown >/dev/null 2>&1; then
  chown 999:999 "${DEST}" 2>/dev/null || true
fi

echo "✅ Staged $(du -h "${DEST}" | cut -f1) → ${DEST}"
