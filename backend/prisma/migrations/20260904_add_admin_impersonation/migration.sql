-- Admin flag + impersonation audit trail.
--
-- Hand-written rather than taken from `prisma migrate diff`, for the reason
-- the 20260902 migrations' headers give at length: the production schema has
-- drifted from the migration history since 2026-06, and a diff against this
-- deployment also proposes dropping `sparse_backfill_snapshot_20260828` (a
-- real table no migration created) and re-defaulting unrelated columns. Only
-- the statements below are intended here.
--
-- Every statement is idempotent, so re-running it against a database that
-- already has the column/table is a no-op rather than a failed deploy.

-- ---------------------------------------------------------------------------
-- The admin flag.
--
-- DEFAULT false, so this migration grants nothing to anybody. That is
-- deliberate and this comment is the reason it must stay that way: sign-up on
-- this deployment is open, so a migration that granted the flag to a fixed
-- e-mail address would hand admin to whoever registered that address first.
-- Granting is an explicit operator action:
--
--   docker exec -e ADMIN_EMAIL=admin@admin.com spheroseg-backend \
--     npx tsx src/db/grantAdmin.ts
--
-- (or `npx tsx src/db/grantAdmin.ts <email>`). See backend/src/db/grantAdmin.ts.
-- ---------------------------------------------------------------------------
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "isAdmin" BOOLEAN NOT NULL DEFAULT false;

-- ---------------------------------------------------------------------------
-- Impersonation audit log — append-only, one row per event.
--
-- Both actor FKs are nullable with ON DELETE SET NULL and both e-mails are
-- denormalised at write time, so deleting either account keeps the record of
-- what happened AND keeps it readable. Same design (and same reasoning) as
-- `export_logs` after 20260902_export_log_survives_deletion: a CASCADE here
-- would let the subject of the audit erase their own trail in one click.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "impersonation_logs" (
    "id" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "adminId" TEXT,
    "adminEmail" TEXT,
    "targetId" TEXT,
    "targetEmail" TEXT,
    "sessionId" TEXT NOT NULL,
    "ip" TEXT,
    "userAgent" TEXT,
    "detail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "impersonation_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "idx_impersonationlog_created" ON "impersonation_logs"("createdAt");
CREATE INDEX IF NOT EXISTS "idx_impersonationlog_admin_created" ON "impersonation_logs"("adminId", "createdAt");
CREATE INDEX IF NOT EXISTS "idx_impersonationlog_target_created" ON "impersonation_logs"("targetId", "createdAt");
CREATE INDEX IF NOT EXISTS "idx_impersonationlog_session" ON "impersonation_logs"("sessionId");

DO $$
BEGIN
  ALTER TABLE "impersonation_logs" ADD CONSTRAINT "impersonation_logs_adminId_fkey"
    FOREIGN KEY ("adminId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "impersonation_logs" ADD CONSTRAINT "impersonation_logs_targetId_fkey"
    FOREIGN KEY ("targetId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
