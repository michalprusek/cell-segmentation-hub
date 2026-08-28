-- AlterTable - Add detectHoles column to segmentation_queue
ALTER TABLE "segmentation_queue" ADD COLUMN "detectHoles" BOOLEAN NOT NULL DEFAULT true;