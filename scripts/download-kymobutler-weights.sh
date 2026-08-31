#!/usr/bin/env bash
# Stages the three KymoButler ONNX graphs into the ML service weights directory.
#
# KymoButler (Jakobs, Dimitracopoulos & Franze, eLife 2019) backs kymograph
# trajectory detection — see backend/segmentation/models/kymobutler/README.md.
# The .onnx files are ~272 MB total and are .gitignore'd (both by the global
# ``*.onnx`` rule and by ``backend/segmentation/weights/``), so they must be
# staged out-of-band on each fresh checkout.
#
# They live in the upstream repo under Git LFS, but **git-lfs is NOT required**:
# GitHub serves LFS objects anonymously from media.githubusercontent.com, and
# that is what this fetches. Each file is verified against the SHA256 recorded
# below, which IS the LFS object id from upstream's pointer files at commit
# be4aa20201faa5cbc104114fda8456e378931f5f — so a truncated download, an HTML
# error page saved as .onnx, or a silently re-uploaded model all fail loudly
# here instead of at the first inference.
#
# Idempotent: an already-present file with the right hash is left alone; a
# present file with the WRONG hash is re-fetched.
#
# Override with ``KYMOBUTLER_BASE_URL`` to stage from a mirror (kajman, S3).
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST_DIR="${REPO_ROOT}/backend/segmentation/weights/kymobutler"
BASE_URL="${KYMOBUTLER_BASE_URL:-https://media.githubusercontent.com/media/MaxJakobs/KymoButler/master/models}"

# name  sha256  bytes
#
# Three of upstream's four graphs. ``classifier.onnx`` is deliberately absent:
# it is meant to pick unidirectional-vs-bidirectional automatically, and NOTHING
# calls it — not this repo (the mode is a request field, defaulting to
# bidirectional) and not upstream either, whose Mathematica ``KymoButler.wl``
# loads it into an association at line 25 and never reads it back. Staging a
# fourth file nothing loads would be 4.6 MB of decoration.
MODELS=(
  "bidirectional_seg.onnx 6446b8c2e8caa7c291cf9a8eacda986a694cf92fb0c72b336e40426b4a19e38d 22667877"
  "unidirectional_seg.onnx 092513fd70d8a8519b73849f43ac945cd346bf314e72a2d558b3082d9152b247 124206164"
  "decision_module.onnx af1c3bb1881cbf36f00921bfa5dc923b2484c9f9099f948f79ff4c9aa88a8d74 124209198"
)

mkdir -p "${DEST_DIR}"

hash_ok() {
  # $1 = path, $2 = expected sha256
  [[ -f "$1" ]] || return 1
  local actual
  actual="$(sha256sum "$1" | cut -d' ' -f1)"
  [[ "${actual}" == "$2" ]]
}

staged=0
kept=0
for entry in "${MODELS[@]}"; do
  read -r name sha size <<<"${entry}"
  dest="${DEST_DIR}/${name}"

  if hash_ok "${dest}" "${sha}"; then
    echo "✅ ${name} already staged and verified"
    kept=$((kept + 1))
    continue
  fi
  if [[ -f "${dest}" ]]; then
    echo "♻️  ${name} present but hash mismatch — re-fetching" >&2
  fi

  echo "📥 Downloading ${name} ($((size / 1024 / 1024)) MB)"
  tmp="${dest}.part"
  if ! curl -fSL --progress-bar -o "${tmp}" "${BASE_URL}/${name}"; then
    rm -f "${tmp}"
    echo "❌ Download failed: ${BASE_URL}/${name}" >&2
    exit 1
  fi

  if ! hash_ok "${tmp}" "${sha}"; then
    echo "❌ SHA256 mismatch for ${name}" >&2
    echo "   expected ${sha}" >&2
    echo "   actual   $(sha256sum "${tmp}" | cut -d' ' -f1)" >&2
    echo "   size     $(stat -c%s "${tmp}") bytes (expected ${size})" >&2
    rm -f "${tmp}"
    exit 1
  fi
  mv "${tmp}" "${dest}"
  staged=$((staged + 1))
done

echo "✅ KymoButler weights ready in ${DEST_DIR} (${staged} downloaded, ${kept} already present)"
