import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { MockedFunction } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted prisma mock — keeps the factory referencing the same object that
// vi.mock() uses (Vitest hoists vi.mock above imports)
// ---------------------------------------------------------------------------

const { prismaMock } = vi.hoisted(() => {
  const mock = {
    projectFolder: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    projectFolderItem: {
      findMany: vi.fn(),
      deleteMany: vi.fn(),
      upsert: vi.fn(),
    },
    $queryRaw: vi.fn(),
    $transaction: vi.fn(),
  };
  return { prismaMock: mock };
});

vi.mock('../../db', () => ({
  prisma: prismaMock,
}));

vi.mock('../../utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../projectService', () => ({
  deleteProject: vi.fn(),
}));

vi.mock('../sharingService', () => ({
  hasProjectAccess: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Imports AFTER mocks
// ---------------------------------------------------------------------------

import {
  listUserFolders,
  createFolder,
  updateFolder,
  deleteFolder,
  getFolderContentsPreview,
  moveProjectsToFolder,
  FolderError,
} from '../projectFolderService';

import * as ProjectService from '../projectService';
import * as SharingService from '../sharingService';
import { Prisma } from '@prisma/client';

const mockDeleteProject = ProjectService.deleteProject as MockedFunction<
  typeof ProjectService.deleteProject
>;
const mockHasProjectAccess = SharingService.hasProjectAccess as MockedFunction<
  typeof SharingService.hasProjectAccess
>;

// ---------------------------------------------------------------------------
// Shared test data
// ---------------------------------------------------------------------------

const USER_ID = 'user-abc';
const FOLDER_ID = 'folder-1';

const makeFolder = (overrides?: object) => ({
  id: FOLDER_ID,
  name: 'My Folder',
  parentId: null,
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-02'),
  ...overrides,
});

// Simulate `$transaction` executing the callback with the mock tx (prismaMock itself)
function setupTransaction() {
  prismaMock.$transaction.mockImplementation(
    (fn: (tx: typeof prismaMock) => Promise<unknown>) => fn(prismaMock)
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('projectFolderService', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default: $queryRaw returns subtree containing only the root folder
    prismaMock.$queryRaw.mockResolvedValue([{ id: FOLDER_ID }]);

    setupTransaction();
  });

  // =========================================================================
  // listUserFolders
  // =========================================================================

  describe('listUserFolders()', () => {
    it('queries all folders for the given user ordered by parentId then name', async () => {
      const rows = [makeFolder(), makeFolder({ id: 'folder-2', name: 'Another' })];
      prismaMock.projectFolder.findMany.mockResolvedValue(rows);

      const result = await listUserFolders(USER_ID);

      expect(prismaMock.projectFolder.findMany).toHaveBeenCalledWith({
        where: { userId: USER_ID },
        select: {
          id: true,
          name: true,
          parentId: true,
          createdAt: true,
          updatedAt: true,
        },
        orderBy: [{ parentId: 'asc' }, { name: 'asc' }],
      });
      expect(result).toEqual(rows);
    });

    it('returns an empty array when the user has no folders', async () => {
      prismaMock.projectFolder.findMany.mockResolvedValue([]);
      const result = await listUserFolders(USER_ID);
      expect(result).toEqual([]);
    });
  });

  // =========================================================================
  // createFolder
  // =========================================================================

  describe('createFolder()', () => {
    it('creates a root folder and returns the DTO', async () => {
      const folder = makeFolder();
      prismaMock.projectFolder.create.mockResolvedValue(folder);

      const result = await createFolder(USER_ID, { name: 'My Folder' });

      expect(prismaMock.projectFolder.create).toHaveBeenCalledWith({
        data: { userId: USER_ID, name: 'My Folder', parentId: null },
        select: {
          id: true,
          name: true,
          parentId: true,
          createdAt: true,
          updatedAt: true,
        },
      });
      expect(result).toEqual(folder);
    });

    it('trims whitespace from the name before persisting', async () => {
      prismaMock.projectFolder.create.mockResolvedValue(makeFolder({ name: 'Trimmed' }));

      await createFolder(USER_ID, { name: '  Trimmed  ' });

      const createCall = prismaMock.projectFolder.create.mock.calls[0][0];
      expect(createCall.data.name).toBe('Trimmed');
    });

    it('throws FolderError(INVALID_INPUT) when name is blank', async () => {
      await expect(createFolder(USER_ID, { name: '   ' })).rejects.toMatchObject({
        name: 'FolderError',
        code: 'INVALID_INPUT',
      });
      expect(prismaMock.projectFolder.create).not.toHaveBeenCalled();
    });

    it('throws FolderError(INVALID_INPUT) when name is missing', async () => {
      await expect(createFolder(USER_ID, {})).rejects.toMatchObject({
        code: 'INVALID_INPUT',
      });
    });

    it('verifies parentId ownership before creating a nested folder', async () => {
      prismaMock.projectFolder.findFirst.mockResolvedValue({ id: 'parent-1' });
      prismaMock.projectFolder.create.mockResolvedValue(
        makeFolder({ parentId: 'parent-1' })
      );

      await createFolder(USER_ID, { name: 'Child', parentId: 'parent-1' });

      expect(prismaMock.projectFolder.findFirst).toHaveBeenCalledWith({
        where: { id: 'parent-1', userId: USER_ID },
        select: { id: true },
      });
    });

    it('throws FolderError(PARENT_NOT_FOUND) when parentId does not belong to user', async () => {
      prismaMock.projectFolder.findFirst.mockResolvedValue(null);

      await expect(
        createFolder(USER_ID, { name: 'Child', parentId: 'other-users-folder' })
      ).rejects.toMatchObject({ code: 'PARENT_NOT_FOUND' });

      expect(prismaMock.projectFolder.create).not.toHaveBeenCalled();
    });

    it('translates Prisma P2002 into FolderError(DUPLICATE_NAME)', async () => {
      prismaMock.projectFolder.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('unique constraint', {
          code: 'P2002',
          clientVersion: '5.0.0',
        })
      );

      await expect(createFolder(USER_ID, { name: 'Dupe' })).rejects.toMatchObject({
        code: 'DUPLICATE_NAME',
      });
    });

    it('translates Prisma P2003 into FolderError(PARENT_NOT_FOUND)', async () => {
      prismaMock.projectFolder.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('foreign key', {
          code: 'P2003',
          clientVersion: '5.0.0',
        })
      );

      await expect(createFolder(USER_ID, { name: 'Orphan' })).rejects.toMatchObject({
        code: 'PARENT_NOT_FOUND',
      });
    });
  });

  // =========================================================================
  // updateFolder
  // =========================================================================

  describe('updateFolder()', () => {
    it('renames a folder in a transaction and returns updated DTO', async () => {
      const updated = makeFolder({ name: 'Renamed' });
      prismaMock.projectFolder.findFirst.mockResolvedValue({ id: FOLDER_ID, parentId: null });
      prismaMock.projectFolder.update.mockResolvedValue(updated);

      const result = await updateFolder(USER_ID, FOLDER_ID, { name: 'Renamed' });

      expect(prismaMock.projectFolder.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: FOLDER_ID },
          data: { name: 'Renamed' },
        })
      );
      expect(result).toEqual(updated);
    });

    it('throws FolderError(NOT_FOUND) when folder does not belong to user', async () => {
      prismaMock.projectFolder.findFirst.mockResolvedValue(null);

      await expect(
        updateFolder(USER_ID, 'nonexistent', { name: 'X' })
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });

    it('throws FolderError(CYCLE) when trying to move a folder into itself', async () => {
      prismaMock.projectFolder.findFirst.mockResolvedValue({ id: FOLDER_ID, parentId: null });

      await expect(
        updateFolder(USER_ID, FOLDER_ID, { parentId: FOLDER_ID })
      ).rejects.toMatchObject({ code: 'CYCLE' });
    });

    it('throws FolderError(CYCLE) when new parent is a descendant of the folder', async () => {
      const CHILD_ID = 'folder-child';
      prismaMock.projectFolder.findFirst
        // First call: ownership check for the folder being moved
        .mockResolvedValueOnce({ id: FOLDER_ID, parentId: null })
        // Second call: parent existence check
        .mockResolvedValueOnce({ id: CHILD_ID });
      // CTE returns both root and child in the subtree
      prismaMock.$queryRaw.mockResolvedValue([{ id: FOLDER_ID }, { id: CHILD_ID }]);

      await expect(
        updateFolder(USER_ID, FOLDER_ID, { parentId: CHILD_ID })
      ).rejects.toMatchObject({ code: 'CYCLE' });
    });

    it('throws FolderError(PARENT_NOT_FOUND) when target parent does not belong to user', async () => {
      prismaMock.projectFolder.findFirst
        .mockResolvedValueOnce({ id: FOLDER_ID, parentId: null }) // ownership check
        .mockResolvedValueOnce(null); // parent lookup

      await expect(
        updateFolder(USER_ID, FOLDER_ID, { parentId: 'alien-folder' })
      ).rejects.toMatchObject({ code: 'PARENT_NOT_FOUND' });
    });

    it('translates P2002 inside the transaction into FolderError(DUPLICATE_NAME)', async () => {
      prismaMock.projectFolder.findFirst.mockResolvedValue({ id: FOLDER_ID, parentId: null });
      prismaMock.projectFolder.update.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('unique', {
          code: 'P2002',
          clientVersion: '5.0.0',
        })
      );

      await expect(
        updateFolder(USER_ID, FOLDER_ID, { name: 'Duplicate' })
      ).rejects.toMatchObject({ code: 'DUPLICATE_NAME' });
    });

    it('can move a folder to root by passing parentId: null', async () => {
      const updated = makeFolder({ parentId: null });
      prismaMock.projectFolder.findFirst.mockResolvedValue({ id: FOLDER_ID, parentId: 'old-parent' });
      prismaMock.projectFolder.update.mockResolvedValue(updated);

      const result = await updateFolder(USER_ID, FOLDER_ID, { parentId: null });

      expect(prismaMock.projectFolder.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { parentId: null } })
      );
      expect(result.parentId).toBeNull();
    });
  });

  // =========================================================================
  // deleteFolder
  // =========================================================================

  describe('deleteFolder()', () => {
    beforeEach(() => {
      prismaMock.projectFolder.findFirst.mockResolvedValue({ id: FOLDER_ID });
      prismaMock.projectFolderItem.findMany.mockResolvedValue([]);
      mockDeleteProject.mockResolvedValue(true);
    });

    it('throws FolderError(NOT_FOUND) when folder does not belong to user', async () => {
      prismaMock.projectFolder.findFirst.mockResolvedValue(null);

      await expect(deleteFolder(USER_ID, FOLDER_ID)).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
    });

    it('deletes an empty folder and returns folderDeleted: true', async () => {
      const result = await deleteFolder(USER_ID, FOLDER_ID);

      expect(prismaMock.projectFolder.delete).toHaveBeenCalledWith({
        where: { id: FOLDER_ID },
      });
      expect(result).toEqual({
        folderDeleted: true,
        deletedProjectIds: [],
        unlinkedSharedProjectIds: [],
        failedProjectIds: [],
      });
    });

    it('cascades deletion of owned projects before removing the folder', async () => {
      const PROJECT_A = 'proj-a';
      const PROJECT_B = 'proj-b';
      prismaMock.projectFolderItem.findMany.mockResolvedValue([
        { projectId: PROJECT_A, project: { userId: USER_ID } },
        { projectId: PROJECT_B, project: { userId: USER_ID } },
      ]);
      mockDeleteProject.mockResolvedValue(true);

      const result = await deleteFolder(USER_ID, FOLDER_ID);

      expect(mockDeleteProject).toHaveBeenCalledTimes(2);
      expect(mockDeleteProject).toHaveBeenCalledWith(PROJECT_A, USER_ID);
      expect(mockDeleteProject).toHaveBeenCalledWith(PROJECT_B, USER_ID);
      expect(result.deletedProjectIds).toEqual(expect.arrayContaining([PROJECT_A, PROJECT_B]));
      expect(result.folderDeleted).toBe(true);
    });

    it('only unlinks shared projects (owned by other users) without deleting them', async () => {
      const SHARED_PID = 'shared-proj';
      prismaMock.projectFolderItem.findMany.mockResolvedValue([
        { projectId: SHARED_PID, project: { userId: 'other-user' } },
      ]);

      const result = await deleteFolder(USER_ID, FOLDER_ID);

      // deleteProject must NOT be called for foreign-owned projects
      expect(mockDeleteProject).not.toHaveBeenCalled();
      expect(result.unlinkedSharedProjectIds).toEqual([SHARED_PID]);
      expect(result.folderDeleted).toBe(true);
    });

    it('returns folderDeleted: false and keeps the folder when a project deletion fails', async () => {
      const GOOD_PID = 'proj-ok';
      const BAD_PID = 'proj-fail';
      prismaMock.projectFolderItem.findMany.mockResolvedValue([
        { projectId: GOOD_PID, project: { userId: USER_ID } },
        { projectId: BAD_PID, project: { userId: USER_ID } },
      ]);
      mockDeleteProject
        .mockResolvedValueOnce(true) // GOOD_PID succeeds
        .mockRejectedValueOnce(new Error('FS error')); // BAD_PID fails

      const result = await deleteFolder(USER_ID, FOLDER_ID);

      expect(result.folderDeleted).toBe(false);
      expect(result.deletedProjectIds).toContain(GOOD_PID);
      expect(result.failedProjectIds).toEqual([
        { id: BAD_PID, error: 'FS error' },
      ]);
      // Folder row must NOT be deleted
      expect(prismaMock.projectFolder.delete).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // getFolderContentsPreview
  // =========================================================================

  describe('getFolderContentsPreview()', () => {
    it('throws FolderError(NOT_FOUND) when folder does not belong to user', async () => {
      prismaMock.projectFolder.findFirst.mockResolvedValue(null);

      await expect(getFolderContentsPreview(USER_ID, FOLDER_ID)).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
    });

    it('returns zero counts for an empty folder with no subfolders', async () => {
      prismaMock.projectFolder.findFirst.mockResolvedValue({ id: FOLDER_ID });
      // Subtree = just the root (length 1), so subfolderCount = 0
      prismaMock.$queryRaw.mockResolvedValue([{ id: FOLDER_ID }]);
      prismaMock.projectFolderItem.findMany.mockResolvedValue([]);

      const result = await getFolderContentsPreview(USER_ID, FOLDER_ID);

      expect(result).toEqual({
        folderId: FOLDER_ID,
        ownedProjectCount: 0,
        sharedProjectCount: 0,
        subfolderCount: 0,
      });
    });

    it('counts owned vs shared projects and subfolders correctly', async () => {
      const CHILD_ID = 'folder-child';
      prismaMock.projectFolder.findFirst.mockResolvedValue({ id: FOLDER_ID });
      // Subtree has 2 entries → subfolderCount = 1
      prismaMock.$queryRaw.mockResolvedValue([{ id: FOLDER_ID }, { id: CHILD_ID }]);
      prismaMock.projectFolderItem.findMany.mockResolvedValue([
        { project: { userId: USER_ID } },   // owned
        { project: { userId: USER_ID } },   // owned
        { project: { userId: 'other' } },   // shared
      ]);

      const result = await getFolderContentsPreview(USER_ID, FOLDER_ID);

      expect(result.subfolderCount).toBe(1);
      expect(result.ownedProjectCount).toBe(2);
      expect(result.sharedProjectCount).toBe(1);
    });
  });

  // =========================================================================
  // moveProjectsToFolder
  // =========================================================================

  describe('moveProjectsToFolder()', () => {
    beforeEach(() => {
      mockHasProjectAccess.mockResolvedValue({ hasAccess: true, isOwner: true });
      prismaMock.projectFolder.findFirst.mockResolvedValue({ id: FOLDER_ID });
      prismaMock.projectFolderItem.upsert.mockResolvedValue({});
      prismaMock.projectFolderItem.deleteMany.mockResolvedValue({ count: 1 });
    });

    it('throws FolderError(NOT_FOUND) when folderId does not belong to user', async () => {
      prismaMock.projectFolder.findFirst.mockResolvedValue(null);

      await expect(
        moveProjectsToFolder(USER_ID, FOLDER_ID, ['proj-1'])
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });

    it('upserts each accessible project into the target folder', async () => {
      await moveProjectsToFolder(USER_ID, FOLDER_ID, ['proj-a', 'proj-b']);

      expect(prismaMock.projectFolderItem.upsert).toHaveBeenCalledTimes(2);
      expect(prismaMock.projectFolderItem.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId_projectId: { userId: USER_ID, projectId: 'proj-a' } },
          create: { userId: USER_ID, projectId: 'proj-a', folderId: FOLDER_ID },
          update: { folderId: FOLDER_ID },
        })
      );
    });

    it('returns movedProjectIds for accessible projects, skips inaccessible ones', async () => {
      mockHasProjectAccess
        .mockResolvedValueOnce({ hasAccess: true, isOwner: true })  // proj-ok
        .mockResolvedValueOnce({ hasAccess: false, isOwner: false }); // proj-denied

      const result = await moveProjectsToFolder(USER_ID, FOLDER_ID, ['proj-ok', 'proj-denied']);

      expect(result.movedProjectIds).toEqual(['proj-ok']);
      expect(result.skippedProjectIds).toEqual(['proj-denied']);
    });

    it('removes folder placements when folderId is null (move to root)', async () => {
      const result = await moveProjectsToFolder(USER_ID, null, ['proj-a']);

      expect(prismaMock.projectFolderItem.deleteMany).toHaveBeenCalledWith({
        where: { userId: USER_ID, projectId: { in: ['proj-a'] } },
      });
      expect(result.movedProjectIds).toEqual(['proj-a']);
    });

    it('returns empty lists immediately when all projects are inaccessible', async () => {
      mockHasProjectAccess.mockResolvedValue({ hasAccess: false, isOwner: false });

      const result = await moveProjectsToFolder(USER_ID, FOLDER_ID, ['bad-1', 'bad-2']);

      expect(prismaMock.projectFolderItem.upsert).not.toHaveBeenCalled();
      expect(result.movedProjectIds).toEqual([]);
      expect(result.skippedProjectIds).toEqual(['bad-1', 'bad-2']);
    });

    it('does not verify folder existence when folderId is null', async () => {
      await moveProjectsToFolder(USER_ID, null, ['proj-a']);
      // findFirst only called for access check, not folder lookup
      expect(prismaMock.projectFolder.findFirst).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // FolderError class
  // =========================================================================

  describe('FolderError', () => {
    it('has name "FolderError", a typed code, and inherits from Error', () => {
      const err = new FolderError('NOT_FOUND', 'not found');
      expect(err).toBeInstanceOf(Error);
      expect(err.name).toBe('FolderError');
      expect(err.code).toBe('NOT_FOUND');
      expect(err.message).toBe('not found');
    });

    it('stores optional details payload', () => {
      const err = new FolderError('PARTIAL_FAILURE', 'partial', { deletedCount: 2 });
      expect(err.details).toEqual({ deletedCount: 2 });
    });
  });
});
