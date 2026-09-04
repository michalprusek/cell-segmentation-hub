-- RUN THIS FIRST, BEFORE `prisma migrate deploy`.
--
-- `migration.sql` in this directory creates the same four indexes with plain
-- `CREATE INDEX`, which takes an ACCESS EXCLUSIVE lock for the whole build and
-- therefore blocks every write to `images` and `segmentation_queue` until it
-- finishes. `images` is the largest table in this database, and blocking it
-- stalls uploads and the segmentation worker.
--
-- The safe form is `CREATE INDEX CONCURRENTLY`, which cannot live in
-- `migration.sql` because Prisma wraps each migration file in a transaction and
-- CONCURRENTLY is not allowed inside one. So run this file by hand first.
-- Every statement in BOTH files is `IF NOT EXISTS`, so once these have built,
-- `prisma migrate deploy` finds the indexes already present and the migration
-- becomes a no-op that only records itself in `_prisma_migrations`.
--
--   docker exec -i spheroseg-postgres psql -U spheroseg -d spheroseg \
--     -v ON_ERROR_STOP=1 \
--     < backend/prisma/migrations/20260904_add_query_path_indexes/CONCURRENTLY.sql
--
-- Run the statements ONE AT A TIME (psql sends each on its own, which is what
-- CONCURRENTLY needs — do not wrap this file in BEGIN/COMMIT).
--
-- A CONCURRENTLY build that is interrupted leaves an INVALID index behind. It
-- does not corrupt anything and queries ignore it, but it must be dropped and
-- rebuilt. Check afterwards with:
--
--   SELECT c.relname FROM pg_class c JOIN pg_index i ON i.indexrelid = c.oid
--    WHERE i.indisvalid = false;
--
-- The rationale for each index is in `migration.sql`; keep the two files in
-- step.

CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_queue_batch"
  ON "segmentation_queue"("batchId");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_queue_status_completed"
  ON "segmentation_queue"("status", "completedAt");

-- `project_shares` has no CREATE TABLE anywhere in this migration history (it
-- arrived via `db push`), so this one is skipped rather than failed when the
-- table is absent — same guard as in migration.sql. It cannot use a DO block,
-- because CONCURRENTLY is not allowed inside PL/pgSQL either; run it only if
-- `\dt project_shares` shows the table, which it will on any real deployment.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_share_sharedwith_status"
  ON "project_shares"("sharedWithId", "status", "createdAt");

-- The big one: `images`. Expect this to take the longest.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_image_project_created"
  ON "images"("projectId", "createdAt");
