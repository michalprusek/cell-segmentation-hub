-- CreateTable -- per-user folder tree for organising the project gallery.
--
-- Data model: adjacency list with self-referential parentId. NULL parentId
-- means the folder lives at the user's root level. Folder uniqueness is
-- enforced *per parent* so two siblings cannot share a name; the same name
-- in different parents (e.g. "Pictures" under two different folders) is
-- allowed. We deliberately do NOT bound the depth — the application uses
-- recursive CTEs to fetch the whole subtree and rejects cyclic moves.
--
-- Cascade behaviour:
--   * Deleting a User cascades to every folder + placement they own.
--   * Deleting a parent folder cascades to all descendants via the
--     self-relation ON DELETE CASCADE, and the items inside them via the
--     folder->item FK below. The service layer additionally invokes
--     projectService.deleteProject for any *owned* projects in the subtree
--     (file cleanup, queue purge, share revocation); shared-project
--     placements are simply dropped, leaving the project intact for its
--     real owner.

CREATE TABLE "project_folders" (
    "id"        TEXT         NOT NULL,
    "name"      TEXT         NOT NULL,
    "userId"    TEXT         NOT NULL,
    "parentId"  TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_folders_pkey" PRIMARY KEY ("id")
);

-- CreateTable -- per-user placement of a project into one of their folders.
--
-- One row = "user U placed project P into folder F". The (userId, projectId)
-- uniqueness means a user keeps each project in at most one folder; absence
-- of a row means the project sits at the user's root level. userId is
-- denormalised from folder.userId so the unique lookup is index-only.
--
-- Shared projects: when user A shares a project with user B, B can place
-- the project into their own folder without touching A's view. The userId
-- on the placement is B's id; the project's underlying userId is A's.

CREATE TABLE "project_folder_items" (
    "id"        TEXT         NOT NULL,
    "userId"    TEXT         NOT NULL,
    "projectId" TEXT         NOT NULL,
    "folderId"  TEXT         NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_folder_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex -- siblings unique by name under the same parent (or root).
-- NULL parentId is treated as a distinct group per Postgres NULL semantics:
-- this still enforces uniqueness at root because (userId, NULL, name) only
-- collides if another row has the *same* userId, NULL parent, and name.
-- Actually Postgres treats NULLs as distinct in unique indexes, so we add
-- a partial-index hardening below to lock down the root case.
CREATE UNIQUE INDEX "uq_folder_sibling_name"
    ON "project_folders" ("userId", "parentId", "name");

CREATE UNIQUE INDEX "uq_folder_root_sibling_name"
    ON "project_folders" ("userId", "name")
    WHERE "parentId" IS NULL;

-- CreateIndex -- fast lookup of a folder's direct children for tree builds.
CREATE INDEX "idx_folder_user_parent"
    ON "project_folders" ("userId", "parentId");

-- CreateIndex -- each user keeps each project in at most one folder.
CREATE UNIQUE INDEX "uq_folder_item_user_project"
    ON "project_folder_items" ("userId", "projectId");

-- CreateIndex -- fast "list everything inside this folder" query.
CREATE INDEX "idx_folder_item_folder"
    ON "project_folder_items" ("folderId");

-- ForeignKey -- folder belongs to a user; cascade on user delete.
ALTER TABLE "project_folders"
    ADD CONSTRAINT "project_folders_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id")
    ON DELETE CASCADE
    ON UPDATE CASCADE;

-- ForeignKey -- self-relation for nested folders; cascade on parent delete
-- sweeps the whole subtree in one statement.
ALTER TABLE "project_folders"
    ADD CONSTRAINT "project_folders_parentId_fkey"
    FOREIGN KEY ("parentId") REFERENCES "project_folders"("id")
    ON DELETE CASCADE
    ON UPDATE CASCADE;

-- ForeignKey -- placement points at its folder; cascade removes placements
-- when the containing folder is deleted.
ALTER TABLE "project_folder_items"
    ADD CONSTRAINT "project_folder_items_folderId_fkey"
    FOREIGN KEY ("folderId") REFERENCES "project_folders"("id")
    ON DELETE CASCADE
    ON UPDATE CASCADE;

-- ForeignKey -- placement points at the project itself; cascade removes
-- placements when the project is deleted (for owned projects this fires
-- via projectService.deleteProject; for shared ones it never does, the
-- owner's deletion is what triggers it).
ALTER TABLE "project_folder_items"
    ADD CONSTRAINT "project_folder_items_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "projects"("id")
    ON DELETE CASCADE
    ON UPDATE CASCADE;

-- ForeignKey -- placement belongs to the placing user; cascade on user delete.
ALTER TABLE "project_folder_items"
    ADD CONSTRAINT "project_folder_items_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id")
    ON DELETE CASCADE
    ON UPDATE CASCADE;
