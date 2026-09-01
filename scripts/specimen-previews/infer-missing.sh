#!/usr/bin/env bash
# Produce the polygons for the `origin=infer` rows of chosen.tsv.
#
# Three models have no usable production output to borrow: neurite_soma has no
# project at all on this deployment, mamba_unet had one segmentation and
# cbam_resunet two. Rather than show them a sibling model's outlines — which
# would put a picture under a model's name that the model never produced — each
# is run on a real frame through the ML service and its OWN output is stored.
#
# Deterministic: the neurite crops are picked by frame statistics (see
# crop-neurite.py), and the spheroid frames are named in chosen.tsv, so a re-run
# regenerates the same tiles.
#
#   ./scripts/specimen-previews/infer-missing.sh [stage-dir]
set -euo pipefail

STAGE="${1:-/tmp/specimen-previews}"
ML_URL="${ML_URL:-http://localhost:4008/api/v1/segment}"
UPLOADS="${UPLOADS_ROOT:-/data/uploads/blue}"
ML_IMAGE="${ML_IMAGE:-cell-segmentation-hub-ml}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"

mkdir -p "$STAGE/polys" "$STAGE/infer"

# The neurite sample is a 6657-px confocal frame; three non-overlapping fields
# out of it are three genuinely different specimens, not three crops of one.
if ! ls "$STAGE"/infer/neurite_*.png >/dev/null 2>&1; then
  docker run --rm -v "$STAGE:/work" -v "$REPO:/repo:ro" "$ML_IMAGE" \
    python /repo/scripts/specimen-previews/crop-neurite.py
fi

while IFS=$'\t' read -r id model ptype image_id w h source origin; do
  case "$id" in \#*|'') continue ;; esac
  [ "$origin" = infer ] || continue

  if [ "${source#work:}" != "$source" ]; then
    frame="$STAGE/${source#work:}"
  else
    frame="$UPLOADS/$source"
  fi
  [ -f "$frame" ] || { echo "missing frame for $id: $frame" >&2; exit 1; }

  response="$STAGE/infer/$image_id.response.json"
  code=$(curl -s -m 900 -X POST "$ML_URL" \
    -F "file=@$frame" -F "model=$model" -F "threshold=0.5" \
    -o "$response" -w '%{http_code}')
  [ "$code" = 200 ] || { echo "$id: ML service returned HTTP $code" >&2; exit 1; }

  python3 - "$response" "$STAGE/polys/$image_id.json" "$id" <<'PY'
import json, sys
response, out, row_id = sys.argv[1], sys.argv[2], sys.argv[3]
polygons = json.load(open(response))['polygons']
if not polygons:
    raise SystemExit('%s: the model returned no polygons for this frame' % row_id)
json.dump(polygons, open(out, 'w'))
print('inferred %s: %d polygons' % (row_id, len(polygons)))
PY
done < "$HERE/chosen.tsv"
