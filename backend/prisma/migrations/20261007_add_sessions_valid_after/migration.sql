-- users."sessionsValidAfter": every session of the user that began before
-- this instant is void. Set on a password change or reset; NULL (every
-- existing row) means "never revoked", so applying this signs nobody out.
--
-- Hand-written and idempotent, like the other migrations since 2026-09.
-- Nullable with no default: adding it rewrites nothing and takes the
-- ACCESS EXCLUSIVE lock only for the catalogue update.

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "sessionsValidAfter" TIMESTAMP(3);
