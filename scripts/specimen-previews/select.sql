-- Candidate pool for specimen preview tiles.
--
-- Ranking is by the model's OWN mean confidence, not by polygon count. Count
-- ranking looks reasonable and is actively harmful: on the spheroid models a
-- high object count means the model was tracing debris, so the top-ranked rows
-- of a 2191-row table rendered as red scribble over texture. Confidence is
-- stored inside each polygon; use it.
--
-- The count band is per model because "many objects" means different things:
-- a disintegration frame legitimately carries hundreds of invading cells, a
-- clean spheroid frame carries one.
--
-- Dedup is by source FILE NAME, not by project: the same twelve wound frames
-- are uploaded into two different projects and would otherwise fill the pool
-- with eight copies of one experiment.
--
--   docker exec -i spheroseg-postgres psql -U spheroseg -d spheroseg \
--     -F $'\t' -A -t < scripts/specimen-previews/select.sql
WITH cand AS (
  SELECT s.model,
         p.type            AS project_type,
         i.id              AS image_id,
         i."projectId"     AS project_id,
         i."originalPath"  AS path,
         COALESCE(s."imageWidth", i.width)   AS width,
         COALESCE(s."imageHeight", i.height) AS height,
         (SELECT COUNT(*) FROM json_array_elements(s.polygons::json)) AS objects,
         (SELECT AVG((e->>'confidence')::float)
            FROM json_array_elements(s.polygons::json) e
           WHERE e->>'confidence' IS NOT NULL) AS confidence,
         regexp_replace(i.name, '^[0-9]+_', '') AS basename
    FROM segmentations s
    JOIN images   i ON i.id = s."imageId"
    JOIN projects p ON p.id = i."projectId"
   WHERE s.model NOT IN ('manual', 'cvat_import')   -- not models
     AND s.polygons LIKE '[{%'                      -- non-empty result
     AND i."isVideoContainer" = false               -- containers hold no pixels
),
ok AS (
  SELECT * FROM cand
   WHERE confidence >= 0.9
     AND CASE
           WHEN model IN ('microtubule', 'spheroid_disintegration')
             THEN objects BETWEEN 20 AND 400
           WHEN model = 'wound' THEN objects BETWEEN 2 AND 8
           -- Sperm counts PARTS, not spermatozoa: head + midpiece + tail, so
           -- seven cells is 21 objects. Microcapsule counts capsules and a
           -- field routinely holds ten. Both sat under the spheroid band
           -- below until 2026-09-02, which silently excluded every one of the
           -- six sperm/microcapsule tiles this pool is supposed to have
           -- produced (they measure 10-21).
           WHEN model IN ('sperm', 'microcapsule')
             THEN objects BETWEEN 1 AND 30
           ELSE objects BETWEEN 1 AND 5
         END
),
dedup AS (
  SELECT DISTINCT ON (model, basename) *
    FROM ok ORDER BY model, basename, confidence DESC
),
-- One per project first, so the pool spreads across labs before it deepens.
ranked AS (
  SELECT *, row_number() OVER (PARTITION BY model, project_id
                                   ORDER BY confidence DESC) AS rank_in_project
    FROM dedup
),
pool AS (
  SELECT *, row_number() OVER (PARTITION BY model
                                   ORDER BY rank_in_project, confidence DESC) AS rank
    FROM ranked
)
SELECT model, project_type, objects, width, height, project_id, image_id, path
  FROM pool WHERE rank <= 8 ORDER BY model, rank;
