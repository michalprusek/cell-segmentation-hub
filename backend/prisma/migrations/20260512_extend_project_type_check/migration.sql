-- Extend the projects.type CHECK constraint to allow 'microtubules'.
--
-- The original constraint (added in 20260425130000_add_project_type)
-- pinned the allowed types to four values and so blocks any update to
-- the new 'microtubules' workflow with a 23514 check_violation. The
-- frontend already enforces the same set on submit via PROJECT_TYPES;
-- this migration realigns the database with that source of truth.

ALTER TABLE "projects" DROP CONSTRAINT IF EXISTS "projects_type_check";

ALTER TABLE "projects" ADD CONSTRAINT "projects_type_check"
  CHECK ("type" IN ('spheroid', 'spheroid_invasive', 'wound', 'sperm', 'microtubules'));
