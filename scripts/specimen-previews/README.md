# Specimen previews

The tiles the project-type and model pickers show on hover: three real
production frames per model, each carrying the outlines that model actually
produced. `src/components/specimens/SpecimenHoverCard.tsx` renders them;
`src/lib/specimens/` holds the index, the loader and the stroke rules.

Everything under `public/specimens/previews/` and
`src/lib/specimens/previewIndex.ts` is **generated**. Do not hand-edit either.

## Regenerating

From the repo root, on the production host (the pipeline reads the live
database and the upload volume):

```bash
# 1. Stored polygons + frame geometry for the `origin=db` rows.
./scripts/specimen-previews/dump-polygons.sh

# 2. Polygons for the `origin=infer` rows: models with no production output,
#    run on a real frame through the ML service. Needs `ml` up on :4008.
./scripts/specimen-previews/infer-missing.sh

# 3. Tiles, geometry and the index.
docker run --rm \
  -v "$PWD:/repo" -v /tmp/specimen-previews:/work \
  -v /data/uploads/blue:/uploads:ro \
  cell-segmentation-hub-ml python /repo/scripts/specimen-previews/generate.py
```

The renderer runs in the ml image because the repo's own Node cannot do the
job: `sharp` reads no BMP (three source frames are BMPs) and has no 16-bit
windowing path, while PIL/numpy have both and the image is already on the host.

## Choosing new specimens

`select.sql` produces the candidate pool. Two things about it are the whole
lesson of the first pass:

- **Rank by the model's own confidence, not by polygon count.** Ranking the
  2191 HRNet rows by object count returns the runs where the model traced
  debris — the contact sheet was red scribble over texture. `AVG(confidence) >=
0.9` plus a per-model object-count band returns clean spheroid outlines from
  the same table.
- **Deduplicate by source file name.** The eight "different" wound candidates
  were the same twelve frames uploaded into two projects.

Then **look at every candidate at the size it will be shown**. The contact
sheet is the only way to catch what SQL cannot see: a figure lifted from a
publication, a frame whose 16-bit channel is nearly black, a segmentation that
is technically confident and visually wrong. Render one with:

```bash
docker run --rm -v /tmp/specimen-previews:/work -v "$PWD:/repo:ro" \
  cell-segmentation-hub-ml python /repo/scripts/specimen-previews/contact-sheet.py
```

Record the survivors in `chosen.tsv`, which is the human-reviewed part of the
pipeline and the only file to edit by hand.

## Why the tiles look the way they do

Both rules below were wrong on the first attempt and were fixed by measuring;
the numbers are in `generate.py`'s docstrings.

- The tile is a **crop sized from the objects**, not the whole frame. A 2048-px
  field of 60-px spheroids renders each object at 4 px in a 150-px tile.
- The crop must also **contain** the largest objects. Sizing from the median
  alone zoomed inside a wound frame and left its outline outside the tile.

16-bit frames are stretched min..max over the frame's own samples, which is what
`applyRanges` in `ImageDisplayContext` does when a channel is first seen — so a
tile shows the picture the editor would open.

## Privacy

The tiles are served from `public/`, so they are public. They come from
production projects on this deployment, the same source as the landing page's
seven showcase specimens.
