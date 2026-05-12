-- AlterTable -- add video container support to the images table.
--
-- Backwards compatible: all new columns are nullable / default false, so
-- existing rows continue to behave exactly as before (no parent video, no
-- channels, not a container).
--
-- The model is: a single Image row with ``isVideoContainer = true`` and a
-- ``channels`` JSONB array represents an uploaded video.  Each extracted
-- frame is a child Image row pointing at the container via parentVideoId,
-- with frameIndex marking its position in the source video.  Per-frame
-- segmentation runs against the child rows; the container itself is never
-- enqueued.

ALTER TABLE "images"
    ADD COLUMN "isVideoContainer" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "parentVideoId"    TEXT,
    ADD COLUMN "frameIndex"       INTEGER,
    ADD COLUMN "frameCount"       INTEGER,
    ADD COLUMN "videoDurationMs"  INTEGER,
    ADD COLUMN "channels"         JSONB;

-- ForeignKey -- self-referential parent/child relation between video
-- container row and its extracted frames.  Cascade so deleting the
-- container wipes the entire frame set in one statement.
ALTER TABLE "images"
    ADD CONSTRAINT "images_parentVideoId_fkey"
    FOREIGN KEY ("parentVideoId") REFERENCES "images"("id")
    ON DELETE CASCADE
    ON UPDATE CASCADE;

-- CreateIndex -- supports the editor's per-video frame fetch
--   (WHERE parentVideoId = ? ORDER BY frameIndex)
-- and the project gallery's top-level filter
--   (WHERE parentVideoId IS NULL).
CREATE INDEX "idx_image_video_frame"
    ON "images" ("parentVideoId", "frameIndex");
