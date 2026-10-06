-- Asynchronous segmentation jobs of the public API (/api/v1/jobs).
--
-- Hand-written and idempotent, like its predecessors and for the same reason:
-- the production schema has drifted from the migration history, so a
-- generated diff also proposes changes nobody intends.
--
-- "inputBytes" is BIGINT (a job may hold 2 GiB of uploads; INT4 stops at
-- 2 147 483 647). "apiKeyId" deliberately has no foreign key: revoking the
-- key that created a job must not delete the job. The unique index on
-- ("userId", "idempotencyKey") relies on Postgres treating NULLs as distinct,
-- so any number of jobs without a key coexist.

CREATE TABLE IF NOT EXISTS "api_jobs" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "apiKeyId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "model" TEXT NOT NULL,
    "parameters" TEXT NOT NULL,
    "page" INTEGER NOT NULL DEFAULT 0,
    "items" TEXT NOT NULL,
    "inputBytes" BIGINT NOT NULL DEFAULT 0,
    "idempotencyKey" TEXT,
    "requestHash" TEXT,
    "cancelRequested" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "api_jobs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "api_jobs_user_idempotency_key" ON "api_jobs"("userId", "idempotencyKey");
CREATE INDEX IF NOT EXISTS "idx_apijob_user_created" ON "api_jobs"("userId", "createdAt");
CREATE INDEX IF NOT EXISTS "idx_apijob_status_updated" ON "api_jobs"("status", "updatedAt");

DO $$
BEGIN
  ALTER TABLE "api_jobs" ADD CONSTRAINT "api_jobs_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
