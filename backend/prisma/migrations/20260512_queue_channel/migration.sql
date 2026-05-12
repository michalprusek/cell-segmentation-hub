-- Add optional channel override for video-frame segmentation.
-- Nullable so existing single-channel rows behave unchanged.
ALTER TABLE "segmentation_queue" ADD COLUMN "channel" TEXT;
