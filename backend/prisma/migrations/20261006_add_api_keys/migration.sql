-- API keys for the public /api/v1 surface.
--
-- Hand-written rather than taken from `prisma migrate diff`, for the reason
-- the 20260902 migrations' headers give at length: the production schema has
-- drifted from the migration history, and a diff against this deployment also
-- proposes dropping real tables no migration created. Only the statements
-- below are intended here.
--
-- Every statement is idempotent, so re-running it against a database that
-- already has the table is a no-op rather than a failed deploy.
--
-- "keyHash" holds a SHA-256 of the key, never the key. It is UNIQUE because
-- it is the lookup: every API request hashes the presented key and reads this
-- index. ON DELETE CASCADE, unlike the audit tables: a key is a credential
-- for its owner's account and must not outlive it.

CREATE TABLE IF NOT EXISTS "api_keys" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "lastUsedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "api_keys_keyHash_key" ON "api_keys"("keyHash");
CREATE INDEX IF NOT EXISTS "idx_apikey_user_created" ON "api_keys"("userId", "createdAt");

DO $$
BEGIN
  ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
