-- Segmenter P0 data model (additive; safe to apply on a live DB — new tables only).
-- Idempotent (IF NOT EXISTS / guarded FKs) so it can be applied directly on the
-- production DB, which carries known Prisma migration-history drift.

CREATE TABLE IF NOT EXISTS "segmenter_datasets" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "segmenter_datasets_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "segmenter_images" (
    "id" TEXT NOT NULL,
    "datasetId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "storagePath" TEXT NOT NULL,
    "thumbnailPath" TEXT,
    "width" INTEGER,
    "height" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "segmenter_images_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "segmenter_classes" (
    "id" TEXT NOT NULL,
    "datasetId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "segmenter_classes_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "segmenter_annotations" (
    "id" TEXT NOT NULL,
    "imageId" TEXT NOT NULL,
    "polygons" TEXT NOT NULL,
    "imageWidth" INTEGER NOT NULL,
    "imageHeight" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "segmenter_annotations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "segmenter_annotations_imageId_key" ON "segmenter_annotations"("imageId");
CREATE INDEX IF NOT EXISTS "idx_segmenter_dataset_user_created" ON "segmenter_datasets"("userId", "createdAt");
CREATE INDEX IF NOT EXISTS "idx_segmenter_image_dataset" ON "segmenter_images"("datasetId");
CREATE INDEX IF NOT EXISTS "idx_segmenter_class_dataset" ON "segmenter_classes"("datasetId");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'segmenter_datasets_userId_fkey') THEN
    ALTER TABLE "segmenter_datasets" ADD CONSTRAINT "segmenter_datasets_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'segmenter_images_datasetId_fkey') THEN
    ALTER TABLE "segmenter_images" ADD CONSTRAINT "segmenter_images_datasetId_fkey"
      FOREIGN KEY ("datasetId") REFERENCES "segmenter_datasets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'segmenter_classes_datasetId_fkey') THEN
    ALTER TABLE "segmenter_classes" ADD CONSTRAINT "segmenter_classes_datasetId_fkey"
      FOREIGN KEY ("datasetId") REFERENCES "segmenter_datasets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'segmenter_annotations_imageId_fkey') THEN
    ALTER TABLE "segmenter_annotations" ADD CONSTRAINT "segmenter_annotations_imageId_fkey"
      FOREIGN KEY ("imageId") REFERENCES "segmenter_images"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
