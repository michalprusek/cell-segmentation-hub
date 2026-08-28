-- Add the per-project microtubule type-label palette column.
--
-- Stores the SSOT for the user-defined tubulin "type" labels of a microtubule
-- project: a JSON array of `{ id, name, color }`. Each microtubule polyline
-- references a label by id via its `mtType` field (stored inside the
-- segmentation polygons JSON, not a column). Nullable so non-MT projects and
-- pre-existing rows are unaffected.
--
-- NOTE: applied directly to production via idempotent SQL (the prod Prisma
-- migration history has drifted, so `migrate deploy` is not run blind here).

ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "mtTypeLabels" jsonb;
