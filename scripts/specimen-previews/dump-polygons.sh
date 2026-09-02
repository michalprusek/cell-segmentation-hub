#!/usr/bin/env bash
# Pull the stored polygons + image geometry for every `origin=db` row of
# chosen.tsv out of the production database into the staging directory the
# renderer reads. Run from the repo root.
set -euo pipefail

STAGE="${1:-/tmp/specimen-previews}"
CONTAINER="${PG_CONTAINER:-spheroseg-postgres}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

mkdir -p "$STAGE/polys"
: > "$STAGE/meta.tsv"

while IFS=$'\t' read -r id model ptype image_id w h source origin; do
  case "$id" in \#*|'') continue ;; esac
  [ "$origin" = db ] || continue
  docker exec "$CONTAINER" psql -U spheroseg -d spheroseg -t -A -c \
    "SELECT polygons FROM segmentations WHERE \"imageId\" = '$image_id'" \
    > "$STAGE/polys/$image_id.json"
  docker exec "$CONTAINER" psql -U spheroseg -d spheroseg -F $'\t' -A -t -c \
    "SELECT i.id, COALESCE(s.\"imageWidth\", i.width, 0), COALESCE(s.\"imageHeight\", i.height, 0), i.\"originalPath\"
       FROM images i JOIN segmentations s ON s.\"imageId\" = i.id WHERE i.id = '$image_id'" \
    >> "$STAGE/meta.tsv"
  echo "dumped $id ($image_id)"
done < "$HERE/chosen.tsv"
