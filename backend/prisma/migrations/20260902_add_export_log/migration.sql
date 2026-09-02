-- Export audit log: who took data off the platform, and when.
--
-- Hand-written rather than taken from `prisma migrate diff`. The diff against
-- this deployment's database also proposes dropping
-- `sparse_backfill_snapshot_20260828` (a real snapshot table from the August
-- IRM backfill that no migration created), renaming an essay_jobs constraint
-- and re-defaulting two columns — none of which belong to this change. The
-- production schema has drifted from the migration history since 2026-06;
-- only the statements below are intended here.
--
-- Every statement is idempotent so re-running it against a database that
-- already has the table is a no-op rather than a failed deploy.

CREATE TABLE IF NOT EXISTS "export_logs" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "projectId" TEXT,
    "jobId" TEXT NOT NULL,
    "options" JSONB,
    "imageCount" INTEGER,
    -- BIGINT, not INTEGER: an export ZIP passes 2^31 bytes long before it
    -- passes any other limit, and Int4 overflow has bitten this schema before.
    "fileSizeBytes" BIGINT,
    "detail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "export_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "idx_exportlog_created" ON "export_logs"("createdAt");
CREATE INDEX IF NOT EXISTS "idx_exportlog_user_created" ON "export_logs"("userId", "createdAt");
CREATE INDEX IF NOT EXISTS "idx_exportlog_project_created" ON "export_logs"("projectId", "createdAt");
CREATE INDEX IF NOT EXISTS "idx_exportlog_job" ON "export_logs"("jobId");

DO $$
BEGIN
  ALTER TABLE "export_logs" ADD CONSTRAINT "export_logs_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "export_logs" ADD CONSTRAINT "export_logs_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
