-- The channels a queue item's image is MERGED from, for a model that segments
-- one image built out of several channels (`neurite_soma_classical`).
--
-- Separate from `channel` on purpose: that column means "read this one channel
-- instead of the default", is validated as a single path token, and keys the
-- static-channel collapse. An empty array is "not a merge".
--
-- IF NOT EXISTS so the statement can be re-run by hand if a deploy is
-- interrupted between the migration and the recreate.
ALTER TABLE "segmentation_queue"
  ADD COLUMN IF NOT EXISTS "mergeChannels" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
