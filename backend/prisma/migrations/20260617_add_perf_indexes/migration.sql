-- Performance indexes (audit Phase 4).
--
-- 1. images(parentVideoId, segmentationStatus): the microtubule tracker gate
--    asks "are all frames of this video container in a final status?" — a
--    filter on parentVideoId AND segmentationStatus. The existing
--    (parentVideoId, frameIndex) index does not cover the status predicate, so
--    the gate scanned every sibling frame of a 600+-frame video.
--
-- 2. segmentation_queue(imageId): the FK to images is ON DELETE CASCADE and the
--    queue is also probed for "is this image already queued?". Without an index
--    on imageId both did a full scan of the queue table.

CREATE INDEX "idx_image_video_status" ON "images"("parentVideoId", "segmentationStatus");

CREATE INDEX "idx_queue_image" ON "segmentation_queue"("imageId");
