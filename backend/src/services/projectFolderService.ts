import { Prisma } from '@prisma/client';
import { prisma } from '../db';
import { logger } from '../utils/logger';
import * as ProjectService from './projectService';
import * as SharingService from './sharingService';

export interface FolderDTO {
  id: string;
  name: string;
  parentId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface FolderContentsPreview {
  folderId: string;
  ownedProjectCount: number;
  sharedProjectCount: number;
  subfolderCount: number;
}

class FolderError extends Error {
  constructor(
    public readonly code:
      | 'NOT_FOUND'
      | 'DUPLICATE_NAME'
      | 'CYCLE'
      | 'PARENT_NOT_FOUND'
      | 'PROJECT_NOT_ACCESSIBLE'
      | 'INVALID_INPUT',
    message: string
  ) {
    super(message);
    this.name = 'FolderError';
  }
}

export { FolderError };

// ---------------------------------------------------------------------------
// Read paths
// ---------------------------------------------------------------------------

/**
 * Returns the user's entire folder tree as a flat list. The client side composes
 * the tree from parentId — keeping the wire format flat avoids deep JSON nesting
 * and makes optimistic updates trivial (insert/update by id, recompute children).
 */
export async function listUserFolders(userId: string): Promise<FolderDTO[]> {
  const folders = await prisma.projectFolder.findMany({
    where: { userId },
    select: {
      id: true,
      name: true,
      parentId: true,
      createdAt: true,
      updatedAt: true,
    },
    orderBy: [{ parentId: 'asc' }, { name: 'asc' }],
  });

  return folders;
}

/**
 * Returns the full set of folder ids in the subtree rooted at `folderId`
 * (inclusive). Uses Postgres recursive CTE — adjacency-list traversal in a
 * single round trip. Caller is responsible for ownership validation; this
 * function does NOT enforce userId on the CTE to keep the query simple, so
 * never expose its result without filtering by userId beforehand.
 */
async function subtreeFolderIds(
  tx: Prisma.TransactionClient,
  folderId: string
): Promise<string[]> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    WITH RECURSIVE descendants AS (
      SELECT id FROM project_folders WHERE id = ${folderId}
      UNION ALL
      SELECT f.id
        FROM project_folders f
        JOIN descendants d ON f."parentId" = d.id
    )
    SELECT id FROM descendants
  `;
  return rows.map(r => r.id);
}

/**
 * Counts what's *inside* a folder for the delete-confirmation dialog.
 * Walks the subtree; for each placement counts owned vs shared projects.
 * Shared = the user is in ProjectFolderItem but doesn't own the underlying
 * project — deleting the folder will unlink (not delete) those.
 */
export async function getFolderContentsPreview(
  userId: string,
  folderId: string
): Promise<FolderContentsPreview> {
  // Ownership check first so we never reveal counts of folders the user doesn't own.
  const folder = await prisma.projectFolder.findFirst({
    where: { id: folderId, userId },
    select: { id: true },
  });
  if (!folder) {
    throw new FolderError('NOT_FOUND', 'Složka nebyla nalezena');
  }

  const subtreeIds = await subtreeFolderIds(prisma, folderId);
  const subfolderCount = Math.max(0, subtreeIds.length - 1);

  const items = await prisma.projectFolderItem.findMany({
    where: { userId, folderId: { in: subtreeIds } },
    select: { project: { select: { userId: true } } },
  });

  let ownedProjectCount = 0;
  let sharedProjectCount = 0;
  for (const item of items) {
    if (item.project.userId === userId) ownedProjectCount += 1;
    else sharedProjectCount += 1;
  }

  return { folderId, ownedProjectCount, sharedProjectCount, subfolderCount };
}

// ---------------------------------------------------------------------------
// Write paths
// ---------------------------------------------------------------------------

/**
 * Creates a folder. Parent (if provided) must belong to the same user.
 * Duplicate sibling names are rejected via the DB unique constraint —
 * Prisma surfaces P2002 which we translate to DUPLICATE_NAME.
 *
 * The Zod-inferred CreateFolderData widens `name` to `string | undefined`
 * because of `.trim()`; the route's validateBody guarantees the value is
 * present, so we re-narrow defensively at the boundary.
 */
export async function createFolder(
  userId: string,
  data: { name?: string; parentId?: string | null }
): Promise<FolderDTO> {
  if (!data.name || !data.name.trim()) {
    throw new FolderError('INVALID_INPUT', 'Název složky je povinný');
  }
  if (data.parentId) {
    const parent = await prisma.projectFolder.findFirst({
      where: { id: data.parentId, userId },
      select: { id: true },
    });
    if (!parent) {
      throw new FolderError(
        'PARENT_NOT_FOUND',
        'Nadřazená složka nebyla nalezena'
      );
    }
  }

  const trimmedName = data.name.trim();
  try {
    const folder = await prisma.projectFolder.create({
      data: {
        userId,
        name: trimmedName,
        parentId: data.parentId ?? null,
      },
      select: {
        id: true,
        name: true,
        parentId: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    logger.info('Folder created', 'FolderService', { userId, folderId: folder.id });
    return folder;
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      throw new FolderError(
        'DUPLICATE_NAME',
        'Složka se stejným názvem na této úrovni už existuje'
      );
    }
    throw error;
  }
}

/**
 * Renames a folder and/or moves it to a different parent.
 * Cycle check: a folder cannot become a descendant of itself — the recursive
 * CTE on the *current* state would still find the subtree before the move,
 * so we just verify the new parent is not in that set.
 */
export async function updateFolder(
  userId: string,
  folderId: string,
  patch: { name?: string; parentId?: string | null }
): Promise<FolderDTO> {
  const folder = await prisma.projectFolder.findFirst({
    where: { id: folderId, userId },
    select: { id: true, parentId: true },
  });
  if (!folder) {
    throw new FolderError('NOT_FOUND', 'Složka nebyla nalezena');
  }

  if (patch.parentId !== undefined) {
    if (patch.parentId === folderId) {
      throw new FolderError('CYCLE', 'Složku nelze přesunout do sebe sama');
    }
    if (patch.parentId !== null) {
      const parent = await prisma.projectFolder.findFirst({
        where: { id: patch.parentId, userId },
        select: { id: true },
      });
      if (!parent) {
        throw new FolderError(
          'PARENT_NOT_FOUND',
          'Nadřazená složka nebyla nalezena'
        );
      }
      const descendants = await subtreeFolderIds(prisma, folderId);
      if (descendants.includes(patch.parentId)) {
        throw new FolderError(
          'CYCLE',
          'Složku nelze přesunout do své vlastní podsložky'
        );
      }
    }
  }

  try {
    const updated = await prisma.projectFolder.update({
      where: { id: folderId },
      data: {
        ...(patch.name !== undefined && { name: patch.name }),
        ...(patch.parentId !== undefined && { parentId: patch.parentId }),
      },
      select: {
        id: true,
        name: true,
        parentId: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    logger.info('Folder updated', 'FolderService', { userId, folderId, patch });
    return updated;
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      throw new FolderError(
        'DUPLICATE_NAME',
        'Složka se stejným názvem na této úrovni už existuje'
      );
    }
    throw error;
  }
}

/**
 * Deletes a folder and its entire subtree.
 *
 * Asymmetric semantics required by the file-explorer UX choice:
 *   - Owned projects placed inside the subtree → fully deleted (calls
 *     projectService.deleteProject so file storage, queue entries, shares
 *     are all cleaned up).
 *   - Shared projects placed inside the subtree → only their placements
 *     are dropped (we cannot delete projects owned by other users). The
 *     project itself stays intact for its real owner.
 *   - Subfolders → cascade-deleted via the FK.
 *
 * Project deletions happen sequentially because projectService.deleteProject
 * does file-system work outside the DB transaction; a Prisma $transaction
 * around it would not cover the FS operations anyway, and parallelism would
 * fight the same file paths. The final folder delete itself is fast.
 */
export async function deleteFolder(
  userId: string,
  folderId: string
): Promise<{ deletedProjectIds: string[]; unlinkedSharedProjectIds: string[] }> {
  const folder = await prisma.projectFolder.findFirst({
    where: { id: folderId, userId },
    select: { id: true },
  });
  if (!folder) {
    throw new FolderError('NOT_FOUND', 'Složka nebyla nalezena');
  }

  const subtreeIds = await subtreeFolderIds(prisma, folderId);
  const placements = await prisma.projectFolderItem.findMany({
    where: { userId, folderId: { in: subtreeIds } },
    select: { projectId: true, project: { select: { userId: true } } },
  });

  const ownedProjectIds: string[] = [];
  const unlinkedSharedProjectIds: string[] = [];
  for (const p of placements) {
    if (p.project.userId === userId) ownedProjectIds.push(p.projectId);
    else unlinkedSharedProjectIds.push(p.projectId);
  }

  const deletedProjectIds: string[] = [];
  for (const projectId of ownedProjectIds) {
    try {
      const deleted = await ProjectService.deleteProject(projectId, userId);
      if (deleted) deletedProjectIds.push(projectId);
    } catch (err) {
      logger.error(
        'Failed to delete project during folder cascade',
        err as Error,
        'FolderService',
        { userId, folderId, projectId }
      );
      throw err;
    }
  }

  // The folder delete cascades to:
  //   * all subfolders (self-relation FK ON DELETE CASCADE)
  //   * all remaining ProjectFolderItem placements inside the subtree
  //     (folder→item FK ON DELETE CASCADE) — this is what handles the
  //     "unlink shared projects" case.
  await prisma.projectFolder.delete({ where: { id: folderId } });

  logger.info('Folder deleted with subtree', 'FolderService', {
    userId,
    folderId,
    subtreeSize: subtreeIds.length,
    deletedProjectIds: deletedProjectIds.length,
    unlinkedSharedProjectIds: unlinkedSharedProjectIds.length,
  });

  return { deletedProjectIds, unlinkedSharedProjectIds };
}

/**
 * Moves a set of projects into a target folder, or to root when folderId === null.
 *
 * Pre-flight: every projectId must be either owned by the user or accepted-shared
 * with the user (`SharingService.hasProjectAccess`). Anything else is silently
 * dropped from the move — we report which ones moved so the caller can show a
 * partial-success message if needed.
 *
 * Storage:
 *   - Move to a folder: upsert ProjectFolderItem keyed on (userId, projectId).
 *     The unique index guarantees a project never sits in two folders for the
 *     same user; upsert replaces the previous placement atomically.
 *   - Move to root: delete the placement row (absence == root).
 */
export async function moveProjectsToFolder(
  userId: string,
  folderId: string | null,
  projectIds: string[]
): Promise<{ movedProjectIds: string[]; skippedProjectIds: string[] }> {
  if (folderId) {
    const folder = await prisma.projectFolder.findFirst({
      where: { id: folderId, userId },
      select: { id: true },
    });
    if (!folder) {
      throw new FolderError('NOT_FOUND', 'Složka nebyla nalezena');
    }
  }

  const accessChecks = await Promise.all(
    projectIds.map(async pid => ({
      pid,
      ok: (await SharingService.hasProjectAccess(pid, userId)).hasAccess,
    }))
  );
  const allowed = accessChecks.filter(c => c.ok).map(c => c.pid);
  const skipped = accessChecks.filter(c => !c.ok).map(c => c.pid);

  if (allowed.length === 0) {
    return { movedProjectIds: [], skippedProjectIds: skipped };
  }

  await prisma.$transaction(async tx => {
    if (folderId === null) {
      await tx.projectFolderItem.deleteMany({
        where: { userId, projectId: { in: allowed } },
      });
    } else {
      for (const projectId of allowed) {
        await tx.projectFolderItem.upsert({
          where: { userId_projectId: { userId, projectId } },
          create: { userId, projectId, folderId },
          update: { folderId },
        });
      }
    }
  });

  logger.info('Projects moved to folder', 'FolderService', {
    userId,
    folderId: folderId ?? 'root',
    movedCount: allowed.length,
    skippedCount: skipped.length,
  });

  return { movedProjectIds: allowed, skippedProjectIds: skipped };
}
