-- Keep the export audit trail when the account that made it is deleted.
--
-- `export_logs.userId` was ON DELETE CASCADE, so a user with access to a shared
-- project could download its data and then delete their account, taking every
-- row naming them with it — the offboarding case the table exists to cover, and
-- silently, because `deleteAccount`'s transaction never mentions export logs.
--
-- The row now survives with a null `userId` and a denormalised `userEmail`
-- captured at write time, so it still says WHO even after the join is gone.
--
-- Hand-written and idempotent, for the reason the previous migration's header
-- gives: `prisma migrate diff` against this deployment proposes unrelated
-- destructive statements.

ALTER TABLE "export_logs" ADD COLUMN IF NOT EXISTS "userEmail" TEXT;

ALTER TABLE "export_logs" ALTER COLUMN "userId" DROP NOT NULL;

-- Backfill the rows written before the column existed, while their users are
-- still joinable.
UPDATE "export_logs" l
   SET "userEmail" = u.email
  FROM "users" u
 WHERE l."userId" = u.id AND l."userEmail" IS NULL;

-- Swap CASCADE for SET NULL. Dropping first because a constraint cannot be
-- altered in place, and IF EXISTS so a re-run is a no-op.
ALTER TABLE "export_logs" DROP CONSTRAINT IF EXISTS "export_logs_userId_fkey";
ALTER TABLE "export_logs"
  ADD CONSTRAINT "export_logs_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
