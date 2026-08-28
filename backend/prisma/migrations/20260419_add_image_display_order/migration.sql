-- AlterTable - add optional displayOrder column to images (null => fallback to createdAt ordering)
ALTER TABLE "images" ADD COLUMN "displayOrder" INTEGER;

-- CreateIndex - scoped to project, supports efficient ordered listing
CREATE INDEX "idx_image_project_order" ON "images" ("projectId", "displayOrder");
