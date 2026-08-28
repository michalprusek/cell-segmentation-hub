-- Extend the projects.type CHECK constraint to allow 'microcapsule'.
--
-- The previous constraint (20260512_extend_project_type_check) pinned the
-- allowed types to five values and so blocks creating or updating a project to
-- the new 'microcapsule' workflow with a 23514 check_violation. The frontend
-- and backend already enforce the same set on submit via PROJECT_TYPES; this
-- migration realigns the database with that source of truth.
--
-- NOTE: applied directly to production via idempotent SQL (the prod Prisma
-- migration history has drifted, so `migrate deploy` is not run blind here).

ALTER TABLE "projects" DROP CONSTRAINT IF EXISTS "projects_type_check";

ALTER TABLE "projects" ADD CONSTRAINT "projects_type_check"
  CHECK ("type" IN ('spheroid', 'spheroid_invasive', 'wound', 'sperm', 'microtubules', 'microcapsule'));
