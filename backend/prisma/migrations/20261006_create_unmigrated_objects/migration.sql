-- Objects `schema.prisma` declares that NO migration in this history creates.
--
-- Until this file, `prisma migrate deploy` on an empty database "succeeded"
-- and left a server that could not register a user. Measured 2026-10-06 by
-- replaying every migration onto an empty Postgres 15 and running
-- `prisma migrate diff --from-url <that database> --to-schema-datamodel`:
-- the whole difference was the three objects below.
--
--   sessions."rememberMe"  its migration, 20250921133009_add_remember_me_to_session,
--                          is recorded as applied in production but its
--                          directory is gone from the repository (and from
--                          git history - it was never committed).
--   project_shares         created by `prisma db push`, never by a migration.
--   essay_jobs             likewise. 20260904_add_query_path_indexes already
--                          had to guard an index on project_shares with
--                          `to_regclass(...) IS NOT NULL` because of this.
--
-- It is a NEW migration rather than a restored 20250921133009 directory on
-- purpose. A restored file could not be byte-identical to the lost one, so
-- its checksum would differ from the one production recorded and every
-- future deploy would warn that an applied migration was modified.
--
-- On production every statement is a no-op: the definitions were compared
-- with `pg_dump --schema-only` of the live tables, column by column and index
-- by index. Two differences are deliberate and are NOT reconciled here:
--
--   * Production's essay_jobs foreign key is named "essay_jobs_userid_fkey"
--     (lower case, made by hand). A guard on the constraint NAME would
--     therefore add a second, redundant foreign key to the live table - so
--     the guards below test for a foreign key on the COLUMN instead.
--   * Production's essay_jobs."updatedAt" has DEFAULT CURRENT_TIMESTAMP. The
--     schema declares none (`@updatedAt` is set by the client on every
--     write), so a fresh database follows the schema.
--
-- Same house style as the 20260902 migrations: hand-written, every statement
-- idempotent, nothing taken wholesale from a diff against the drifted
-- production database.

ALTER TABLE "sessions"
  ADD COLUMN IF NOT EXISTS "rememberMe" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS "project_shares" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "sharedById" TEXT NOT NULL,
    "sharedWithId" TEXT,
    "email" TEXT,
    "shareToken" TEXT NOT NULL,
    "tokenExpiry" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_shares_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "project_shares_shareToken_key" ON "project_shares"("shareToken");
CREATE INDEX IF NOT EXISTS "idx_share_project_status" ON "project_shares"("projectId", "status");
CREATE INDEX IF NOT EXISTS "idx_share_token" ON "project_shares"("shareToken");
CREATE INDEX IF NOT EXISTS "idx_share_email_status" ON "project_shares"("email", "status");
-- 20260904_add_query_path_indexes skipped this one on a database without the
-- table, which is every database built from migrations alone.
CREATE INDEX IF NOT EXISTS "idx_share_sharedwith_status" ON "project_shares"("sharedWithId", "status", "createdAt");

CREATE TABLE IF NOT EXISTS "essay_jobs" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "fileCount" INTEGER NOT NULL DEFAULT 0,
    "mtCount" INTEGER NOT NULL DEFAULT 0,
    "device" TEXT,
    "inputKey" TEXT NOT NULL,
    "outputKey" TEXT NOT NULL,
    "resultZipKey" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "essay_jobs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "idx_essayjob_user_created" ON "essay_jobs"("userId", "createdAt");
CREATE INDEX IF NOT EXISTS "idx_essayjob_status" ON "essay_jobs"("status");

-- Foreign keys, each added only when its column has none yet - whatever the
-- existing one is called.
DO $$
DECLARE
  fk RECORD;
BEGIN
  FOR fk IN
    SELECT * FROM (VALUES
      ('project_shares', 'projectId',    'projects', 'project_shares_projectId_fkey'),
      ('project_shares', 'sharedById',   'users',    'project_shares_sharedById_fkey'),
      ('project_shares', 'sharedWithId', 'users',    'project_shares_sharedWithId_fkey'),
      ('essay_jobs',     'userId',       'users',    'essay_jobs_userId_fkey')
    ) AS t(tbl, col, ref, name)
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM pg_constraint c
      JOIN pg_attribute a
        ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
      WHERE c.contype = 'f'
        AND c.conrelid = format('public.%I', fk.tbl)::regclass
        AND a.attname = fk.col
    ) THEN
      EXECUTE format(
        'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES %I("id") ON DELETE CASCADE ON UPDATE CASCADE',
        fk.tbl, fk.name, fk.col, fk.ref
      );
    END IF;
  END LOOP;
END $$;
