-- Indexes for four query shapes that no existing index can serve.
--
-- Hand-written rather than taken from `prisma migrate diff`, for the reason
-- spelled out in `20260902_add_export_log/migration.sql`: the production schema
-- has drifted from the migration history since 2026-06, and a diff against it
-- proposes dropping real tables. Only the statements below are intended here.
--
-- Every statement is idempotent (`IF NOT EXISTS`) so re-running it against a
-- database that already has the index is a no-op rather than a failed deploy.
--
-- ===========================================================================
-- READ BEFORE DEPLOYING. Run `CONCURRENTLY.sql` (this directory) FIRST.
--
-- `CREATE INDEX` takes an ACCESS EXCLUSIVE lock for the whole build, so
-- applying this file directly BLOCKS EVERY WRITE to `images` and
-- `segmentation_queue` until it finishes — `images` is the largest table here,
-- and stalling it stalls uploads and the segmentation worker.
--
-- The safe form is `CREATE INDEX CONCURRENTLY`, which cannot be used in this
-- file: Prisma wraps each migration in a transaction and CONCURRENTLY is not
-- allowed inside one. `CONCURRENTLY.sql` beside this file holds the four
-- statements in that form, ready to pipe into psql. Because every statement in
-- BOTH files is `IF NOT EXISTS`, running it first makes the migration below a
-- no-op that merely records itself in `_prisma_migrations`.
--
-- Applying this file directly is acceptable only on a database small enough,
-- or quiet enough, that the lock does not matter. Keep the two files in step.
-- ===========================================================================

-- 1. segmentation_queue(batchId)
--    `batchId` appears in NO existing index (the three are
--    (status, priority, createdAt), (projectId, status) and (imageId)), yet
--    every enqueue reads the rows it just wrote back by batchId
--    (`QueueService.addBatchToQueue` → `tx.segmentationQueue.findMany({ where:
--    { batchId } })`, up to 10 000 rows per request), and `cancelBatch` filters
--    on it twice (a findMany and a deleteMany). All of those are sequential
--    scans of the whole queue table today.
CREATE INDEX IF NOT EXISTS "idx_queue_batch"
  ON "segmentation_queue"("batchId");

-- 2. segmentation_queue(status, completedAt)
--    Two callers, one of them the most frequently executed query in the
--    backend:
--      * the queue-fairness window in `QueueService.getNextBatchExcluding`
--        (`WHERE status IN ('processing','completed') ORDER BY completedAt
--        DESC, startedAt DESC LIMIT 5`), which the worker runs every 100 ms;
--        `idx_queue_status_priority` orders by (priority, createdAt) and cannot
--        supply that ordering, so it sorts every processing+completed row to
--        return five.
--      * the hourly `performQueueCleanup` / `cleanupOldEntries`
--        (`WHERE status IN ('completed','failed') AND completedAt < ?`), whose
--        range predicate is on a column in no index.
CREATE INDEX IF NOT EXISTS "idx_queue_status_completed"
  ON "segmentation_queue"("status", "completedAt");

-- 3. project_shares(sharedWithId, status, createdAt)
--    `sharedWithId` is in no index at all. It is the filter for
--    `SharingService.getSharedProjects` (`WHERE sharedWithId = ? AND status =
--    'accepted' ORDER BY createdAt DESC`) and for the shared-projects arm of
--    `ProjectService.getUserProjects` (`shares: { some: { sharedWithId, status
--    } }`) — i.e. every dashboard load — and it is also an ON DELETE CASCADE
--    foreign key, so deleting a user scans the whole table too.
--
--    Guarded on the table existing: `project_shares` was created by `db push`
--    and has no CREATE TABLE in this migration history, so a from-scratch
--    `migrate deploy` never creates it. The guard keeps this migration from
--    turning that pre-existing gap into a hard failure.
DO $$
BEGIN
  IF to_regclass('public.project_shares') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS "idx_share_sharedwith_status"
      ON "project_shares"("sharedWithId", "status", "createdAt");
  END IF;
END $$;

-- 4. images(projectId, createdAt)
--    `createdAt` is the DEFAULT sort of both image listings
--    (`imageQuerySchema.sortBy` defaults to 'createdAt', `sortOrder` to
--    'desc'), and it is also the ordering of the project card's latest-image
--    pull (`ProjectService.getUserProjects` → `images: { take: 1, orderBy: {
--    createdAt: 'desc' } }`). The existing image indexes are
--    (projectId, segmentationStatus) and (projectId, displayOrder); neither
--    supplies that order, so the gallery sorts the whole project on every page
--    and OFFSET pagination re-sorts it for every page after the first.
CREATE INDEX IF NOT EXISTS "idx_image_project_created"
  ON "images"("projectId", "createdAt");
