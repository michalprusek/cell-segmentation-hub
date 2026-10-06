/**
 * Deleting a project removes its files, not only its rows.
 *
 * The cascade reaches the database and stops there: until 2026-10-07 every
 * still image of a deleted project stayed on disk for good.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const { prismaMock, filesMock } = vi.hoisted(() => ({
  prismaMock: {
    project: { findFirst: vi.fn(), delete: vi.fn() },
  },
  filesMock: {
    collectProjectFiles: vi.fn(),
    deleteUserFiles: vi.fn(),
  },
}));

vi.mock('../../db', () => ({ prisma: prismaMock }));
vi.mock('../../utils/logger');
vi.mock('../sharingService', () => ({ hasProjectAccess: vi.fn() }));
vi.mock('../accountFiles', () => filesMock);

import * as projectService from '../projectService';

const FILES = { fileKeys: ['u/p/originals/a.png'], dirKeys: ['projects/p'] };

beforeEach(() => {
  vi.clearAllMocks();
  filesMock.collectProjectFiles.mockResolvedValue(FILES);
  filesMock.deleteUserFiles.mockResolvedValue({
    removed: 2,
    failed: 0,
    refused: 0,
  });
});

describe('deleteProject and the project’s files', () => {
  it('reads the file list before the rows go, and removes the files after', async () => {
    prismaMock.project.findFirst.mockResolvedValue({
      id: 'p',
      userId: 'owner',
      _count: { images: 3 },
    });
    prismaMock.project.delete.mockResolvedValue({});

    await projectService.deleteProject('p', 'owner');

    expect(filesMock.collectProjectFiles).toHaveBeenCalledWith('p', 'owner');
    expect(filesMock.deleteUserFiles).toHaveBeenCalledWith(FILES);
    const collected =
      filesMock.collectProjectFiles.mock.invocationCallOrder[0];
    const rowDeleted = prismaMock.project.delete.mock.invocationCallOrder[0];
    const filesDeleted = filesMock.deleteUserFiles.mock.invocationCallOrder[0];
    // Afterwards nothing records which files were the project's...
    expect(collected).toBeLessThan(rowDeleted);
    // ...and a file must not go while its row still says it exists.
    expect(rowDeleted).toBeLessThan(filesDeleted);
  });

  it('touches no file when the project is not the caller’s', async () => {
    // Shared access is not ownership: findFirst is scoped to the owner.
    prismaMock.project.findFirst.mockResolvedValue(null);

    const result = await projectService.deleteProject('p', 'someone-else');

    expect(result).toBeNull();
    expect(filesMock.collectProjectFiles).not.toHaveBeenCalled();
    expect(prismaMock.project.delete).not.toHaveBeenCalled();
    expect(filesMock.deleteUserFiles).not.toHaveBeenCalled();
  });

  it('leaves the files alone when the row could not be deleted', async () => {
    prismaMock.project.findFirst.mockResolvedValue({
      id: 'p',
      userId: 'owner',
      _count: { images: 3 },
    });
    prismaMock.project.delete.mockRejectedValue(new Error('db down'));

    await expect(projectService.deleteProject('p', 'owner')).rejects.toThrow(
      'db down'
    );

    expect(filesMock.deleteUserFiles).not.toHaveBeenCalled();
  });
});
