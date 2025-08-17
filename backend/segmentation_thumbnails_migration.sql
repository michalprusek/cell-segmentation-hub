-- Add segmentation thumbnails table for optimized polygon caching
CREATE TABLE "segmentation_thumbnails" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "segmentationId" TEXT NOT NULL,
    "levelOfDetail" TEXT NOT NULL,
    "simplifiedData" TEXT NOT NULL,
    "polygonCount" INTEGER NOT NULL,
    "pointCount" INTEGER NOT NULL,
    "compressionRatio" REAL NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "segmentation_thumbnails_segmentationId_fkey" FOREIGN KEY ("segmentationId") REFERENCES "segmentations" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- Create indexes for optimal performance
CREATE INDEX "idx_thumbnail_segmentation_lod" ON "segmentation_thumbnails"("segmentationId", "levelOfDetail");
CREATE UNIQUE INDEX "segmentation_thumbnails_segmentationId_levelOfDetail_key" ON "segmentation_thumbnails"("segmentationId", "levelOfDetail");