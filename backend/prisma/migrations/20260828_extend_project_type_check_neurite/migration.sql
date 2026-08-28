-- Extend the projects.type CHECK constraint to allow 'neurite'.
--
-- `projects.type` is a plain Prisma `String` column, but it ALSO carries a
-- raw-SQL CHECK constraint (`projects_type_check`, introduced in
-- 20260425130000_add_project_type and last widened for 'microcapsule'), which
-- is invisible in schema.prisma. Without this migration, creating or updating
-- a project to the new 'neurite' workflow fails with a 23514 check_violation
-- and the API returns a 500.
--
-- NOTE FOR DEPLOY: production's Prisma migration history has drifted, so
-- `migrate deploy` is NEVER run blind against it. The statements below are
-- idempotent — the DROP uses IF EXISTS and the ADD re-creates the constraint
-- from the full list — so they can safely be applied directly:
--
--   docker exec -i spheroseg-postgres psql -U spheroseg -d spheroseg \
--     < backend/prisma/migrations/20260828_extend_project_type_check_neurite/migration.sql
--
-- Verify with:
--   SELECT pg_get_constraintdef(oid) FROM pg_constraint
--    WHERE conname = 'projects_type_check';
--
-- The live constraint before this change (verified 2026-08-28) was:
--   spheroid, spheroid_invasive, wound, sperm, microtubules, microcapsule

ALTER TABLE "projects" DROP CONSTRAINT IF EXISTS "projects_type_check";

ALTER TABLE "projects" ADD CONSTRAINT "projects_type_check"
  CHECK ("type" IN ('spheroid', 'spheroid_invasive', 'wound', 'sperm', 'microtubules', 'microcapsule', 'neurite'));
