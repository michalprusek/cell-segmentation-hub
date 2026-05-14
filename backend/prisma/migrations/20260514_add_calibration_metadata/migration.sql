-- AlterTable -- add upload-extracted calibration metadata to the images table.
--
-- Backwards compatible: both columns are nullable so existing rows are
-- unaffected. The fields are populated on video container rows by the
-- upload pipeline:
--   * pixelSizeUm: from ND2.voxel_size().x (assumes isotropic XY) or
--     OME-TIFF PhysicalSizeX (converted to µm) or ImageJ TIFF XResolution.
--   * frameIntervalMs: median Δ of consecutive ND2 event timestamps; for
--     OME-TIFF the Pixels TimeIncrement; for ImageJ TIFF the `finterval`
--     entry (converted from seconds). For mp4/avi/mov this is computed as
--     durationMs / frameCount on the Node side.
--
-- Float so we can store sub-µm pixel sizes (0.108 etc.) and sub-ms
-- intervals without losing precision.

ALTER TABLE "images"
    ADD COLUMN "pixelSizeUm"     DOUBLE PRECISION,
    ADD COLUMN "frameIntervalMs" DOUBLE PRECISION;
