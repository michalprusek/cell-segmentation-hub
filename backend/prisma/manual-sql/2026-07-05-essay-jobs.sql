-- Automated Essays: essay_jobs table. Applied as direct idempotent SQL to the
-- live `spheroseg` DB (prod prisma history is drifted — see memory
-- project_migration_drift_2026_06_17; never `migrate deploy` blind). Matches the
-- EssayJob model in schema.prisma exactly (quoted camelCase identifiers so the
-- Prisma-generated queries resolve).
CREATE TABLE IF NOT EXISTS essay_jobs (
  id            TEXT PRIMARY KEY,
  "userId"      TEXT NOT NULL,
  name          TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'queued',
  progress      INTEGER NOT NULL DEFAULT 0,
  "fileCount"   INTEGER NOT NULL DEFAULT 0,
  "mtCount"     INTEGER NOT NULL DEFAULT 0,
  device        TEXT,
  "inputKey"    TEXT NOT NULL,
  "outputKey"   TEXT NOT NULL,
  "resultZipKey" TEXT,
  error         TEXT,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  CONSTRAINT essay_jobs_userId_fkey FOREIGN KEY ("userId")
    REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_essayjob_user_created ON essay_jobs("userId", "createdAt");
CREATE INDEX IF NOT EXISTS idx_essayjob_status ON essay_jobs(status);
