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
  /**
   * Optional structured payload — used by PARTIAL_FAILURE in deleteFolder to
   * report which projects were successfully deleted before the failure so the
   * controller can echo it to the client (avoids silent data loss).
   */
  public details?: Record<string, unknown>;

  constructor(
    public readonly code:
      | 'NOT_FOUND'
      | 'DUPLICATE_NAME'
      | 'CYCLE'
      | 'PARENT_NOT_FOUND'
      | 'PROJECT_NOT_ACCESSIBLE'
      | 'INVALID_INPUT'
      | 'PARTIAL_FAILURE',
    message: string,
    details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'FolderError';
    this.details = details;
  }
}

export { FolderError };

/**
 * Translates known Prisma error codes into user-friendly FolderError variants.
 * Anything else passes through unchanged so the controller's default 500
 * handler logs the full technical detail (we don't want to mask unknown
 * Prisma failures — they're real bugs deserving a Sentry entry).
 *
 *   P2002 — unique constraint violated         → DUPLICATE_NAME
 *   P2003 — foreign key constraint violated    → PARENT_NOT_FOUND
 *                                                  (typically a parentId
 *                                                  that no longer exists)
 *   P2025 — record-not-found during update     → NOT_FOUND
 *                                                  (race: deleted between
 *                                                  our pre-flight check
 *                                                  and the write)
 */
function translatePrismaError(error: unknown): Error {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    switch (error.code) {
      case 'P2002':
        return new FolderError(
          'DUPLICATE_NAME',
          'Složka se stejným názvem na této úrovni už existuje'
        );
      case 'P2003':
        return new FolderError(
          'PARENT_NOT_FOUND',
          'Cílová nadřazená složka neexistuje'
        );
      case 'P2025':
        return new FolderError(
          'NOT_FOUND',
          'Složka byla mezitím smazána; obnovte stránku'
        );
    }
  }
  return error instanceof Error ? error : new Error(String(error));
}

// ---------------------------------------------------------------------------
// Read paths
// ---------------------------------------------------------------------------

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
 * (inclusive). Uses Postgres recursive CTE with three layered safeguards:
 *
 *   1. `UNION` (distinct) — if a cycle ever exists in the data (race, restore
 *      gone wrong, future bug), the second expansion adds no new ids and the
 *      CTE terminates. `UNION ALL` would loop forever, burning a connection.
 *   2. `depth < 50` — even with `UNION` a corrupted path between distinct
 *      cyclic nodes can be long; capping depth bounds the worst case.
 *   3. `userId` filter on both seed and recursive step — defense-in-depth so
 *      a future caller that forgets the pre-flight ownership check cannot
 *      enumerate another user's folder ids.
 */
async function subtreeFolderIds(
  tx: Prisma.TransactionClient,
  folderId: string,
  userId: string
): Promise<string[]> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    WITH RECURSIVE descendants AS (
      SELECT id, 1 AS depth
        FROM project_folders
        WHERE id = ${folderId} AND "userId" = ${userId}
      UNION
      SELECT f.id, d.depth + 1
        FROM project_folders f
        JOIN descendants d ON f."parentId" = d.id
        WHERE f."userId" = ${userId} AND d.depth < 50
    )
    SELECT DISTINCT id FROM descendants
  `;
  return rows.map(r => r.id);
}

export async function getFolderContentsPreview(
  userId: string,
  folderId: string
): Promise<FolderContentsPreview> {
  const folder = await prisma.projectFolder.findFirst({
    where: { id: folderId, userId },
    select: { id: true },
  });
  if (!folder) {
    throw new FolderError('NOT_FOUND', 'Složka nebyla nalezena');
  }

  const subtreeIds = await subtreeFolderIds(prisma, folderId, userId);
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
    throw translatePrismaError(error);
  }
}

/**
 * Renames a folder and/or moves it to a different parent.
 *
 * The ownership lookup, cycle check, and update all run inside a single
 * `$transaction` because otherwise two tabs could each see pre-move state
 * and produce a cycle (tab A moves X under Y, tab B moves Y under X — both
 * cycle checks pass, both updates commit). Holding a transaction takes a
 * row-level lock on the inspected rows so the second tab serializes.
 *
 * Cycle check: a folder cannot become a descendant of itself. The recursive
 * CTE on the pre-move state finds the subtree rooted at the moving folder;
 * if the requested new parent is inside that set, reject.
 */
export async function updateFolder(
  userId: string,
  folderId: string,
  patch: { name?: string; parentId?: string | null }
): Promise<FolderDTO> {
  return prisma.$transaction(async tx => {
    const folder = await tx.projectFolder.findFirst({
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
        const parent = await tx.projectFolder.findFirst({
          where: { id: patch.parentId, userId },
          select: { id: true },
        });
        if (!parent) {
          throw new FolderError(
            'PARENT_NOT_FOUND',
            'Nadřazená složka nebyla nalezena'
          );
        }
        const descendants = await subtreeFolderIds(tx, folderId, userId);
        if (descendants.includes(patch.parentId)) {
          throw new FolderError(
            'CYCLE',
            'Složku nelze přesunout do své vlastní podsložky'
          );
        }
      }
    }

    try {
      const updated = await tx.projectFolder.update({
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
  });
}

export interface DeleteFolderResult {
  folderDeleted: boolean;
  deletedProjectIds: string[];
  unlinkedSharedProjectIds: string[];
  failedProjectIds: { id: string; error: string }[];
}

/**
 * Deletes a folder and its entire subtree.
 *
 * Asymmetric semantics required by the file-explorer UX choice:
 *   - Owned projects → fully deleted (calls projectService.deleteProject so
 *     file storage, queue entries, shares are all cleaned up).
 *   - Shared projects → only their placements are dropped (we cannot delete
 *     projects owned by other users).
 *   - Subfolders → cascade-deleted via the FK.
 *
 * Partial-failure handling: project deletion does FS work outside any DB
 * transaction. We run them through `Promise.allSettled` so a single failure
 * doesn't strand the caller. If ANY owned-project deletion fails we DO NOT
 * delete the folder — leaving it in place lets the user retry and see what
 * still needs attention. The result always carries both lists; the
 * controller maps `folderDeleted: false` to HTTP 207 Multi-Status.
 */
export async function deleteFolder(
  userId: string,
  folderId: string
): Promise<DeleteFolderResult> {
  const folder = await prisma.projectFolder.findFirst({
    where: { id: folderId, userId },
    select: { id: true },
  });
  if (!folder) {
    throw new FolderError('NOT_FOUND', 'Složka nebyla nalezena');
  }

  const subtreeIds = await subtreeFolderIds(prisma, folderId, userId);
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

  const results = await Promise.allSettled(
    ownedProjectIds.map(pid => ProjectService.deleteProject(pid, userId))
  );
  const deletedProjectIds: string[] = [];
  const failedProjectIds: { id: string; error: string }[] = [];
  results.forEach((r, i) => {
    const pid = ownedProjectIds[i];
    if (r.status === 'fulfilled' && r.value) {
      deletedProjectIds.push(pid);
    } else if (r.status === 'rejected') {
      logger.error(
        'Failed to delete project during folder cascade',
        r.reason as Error,
        'FolderService',
        { userId, folderId, projectId: pid }
      );
      failedProjectIds.push({
        id: pid,
        error: r.reason instanceof Error ? r.reason.message : String(r.reason),
      });
    }
  });

  if (failedProjectIds.length > 0) {
    logger.warn(
      'Folder delete partial: kept folder due to failures',
      'FolderService',
      {
        userId,
        folderId,
        deleted: deletedProjectIds.length,
        failed: failedProjectIds.length,
      }
    );
    return {
      folderDeleted: false,
      deletedProjectIds,
      unlinkedSharedProjectIds,
      failedProjectIds,
    };
  }

  await prisma.projectFolder.delete({ where: { id: folderId } });

  logger.info('Folder deleted with subtree', 'FolderService', {
    userId,
    folderId,
    subtreeSize: subtreeIds.length,
    deletedProjectIds: deletedProjectIds.length,
    unlinkedSharedProjectIds: unlinkedSharedProjectIds.length,
  });

  return {
    folderDeleted: true,
    deletedProjectIds,
    unlinkedSharedProjectIds,
    failedProjectIds: [],
  };
}

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
