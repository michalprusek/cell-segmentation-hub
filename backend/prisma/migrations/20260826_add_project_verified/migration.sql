-- Add the project "verified" flag: the owner or an accepted-share annotator
-- marks that all annotations in the project have been reviewed and passed.
--
-- verifiedAt/verifiedBy are stamped for later auditability but are NOT
-- surfaced in the UI today. verifiedBy is a bare user id with no FK,
-- matching how other loose per-project metadata (e.g. mtTypeLabels) is
-- stored in this table.
--
-- NOTE: applied directly to production via idempotent SQL (the prod Prisma
-- migration history has drifted, so `migrate deploy` is not run blind here —
-- see the 20260709_add_mt_type_labels precedent).

ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "verified" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "verifiedAt" TIMESTAMP(3);
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "verifiedBy" TEXT;
