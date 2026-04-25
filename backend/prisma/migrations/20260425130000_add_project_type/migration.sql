-- Add project workflow type column.
-- Drives metric export format and editor mode dispatch.
-- Values: 'spheroid' (standard) | 'spheroid_invasive' (disintegrated) | 'wound' | 'sperm'.
ALTER TABLE "projects" ADD COLUMN "type" TEXT NOT NULL DEFAULT 'spheroid';

-- Constrain to the four supported project types.
ALTER TABLE "projects" ADD CONSTRAINT "projects_type_check"
  CHECK ("type" IN ('spheroid', 'spheroid_invasive', 'wound', 'sperm'));
