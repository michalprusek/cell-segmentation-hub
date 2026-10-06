-- Drop the legacy `sessions` table.
--
-- Sessions have lived in Redis (services/sessionService.ts) since the cookie
-- migration; nothing has READ this table since. Until 2026-10-07 the code
-- still wrote to it: one row per registration, holding that registration's
-- refresh token IN THE CLEAR. Redis keeps only a SHA-256 of each token, on
-- purpose - this table undid that, for the database and for every backup of
-- it. Measured on production before this migration: 55 rows, 11 of them
-- with a refresh token that had not yet expired.
--
-- The last writer was removed in the release before this one (#579), so the
-- code that is running while this migration is applied does not touch the
-- table - which is what makes "migrate before you recreate" safe here. It
-- also means there is no rolling back past #579 without restoring the table:
-- older code inserts into it on every registration.
--
-- No foreign key references it. Idempotent.

DROP TABLE IF EXISTS "sessions";
