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
    recordPendingCleanup: vi.fn(),
    discardPendingCleanup: vi.fn(),
    completeCleanup: vi.fn(),
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
  filesMock.recordPendingCleanup.mockResolvedValue('/up/.pending/p.json');
  filesMock.discardPendingCleanup.mockResolvedValue(undefined);
  filesMock.completeCleanup.mockResolvedValue({
    removed: 2,
    failed: 0,
    refused: 0,
  });
});

describe('deleteProject and the project’s files', () => {
  it('lists the files, writes the list down, deletes the rows, then removes the files', async () => {
    prismaMock.project.findFirst.mockResolvedValue({
      id: 'p',
      userId: 'owner',
      _count: { images: 3 },
    });
    prismaMock.project.delete.mockResolvedValue({});

    await projectService.deleteProject('p', 'owner');

    expect(filesMock.collectProjectFiles).toHaveBeenCalledWith('p', 'owner');
    expect(filesMock.recordPendingCleanup).toHaveBeenCalledWith(
      { kind: 'project', id: 'p' },
      FILES
    );
    expect(filesMock.completeCleanup).toHaveBeenCalledWith(
      '/up/.pending/p.json',
      FILES
    );
    const order = [
      filesMock.collectProjectFiles,
      filesMock.recordPendingCleanup,
      prismaMock.project.delete,
      filesMock.completeCleanup,
    ].map(mock => mock.mock.invocationCallOrder[0]);
    // The list must exist on disk BEFORE the rows go - afterwards nothing
    // records which files were the project's - and no file may go while its
    // row still says it exists.
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(filesMock.discardPendingCleanup).not.toHaveBeenCalled();
  });

  it('touches no file when the project is not the caller’s', async () => {
    // Shared access is not ownership: findFirst is scoped to the owner.
    prismaMock.project.findFirst.mockResolvedValue(null);

    const result = await projectService.deleteProject('p', 'someone-else');

    expect(result).toBeNull();
    expect(filesMock.collectProjectFiles).not.toHaveBeenCalled();
    expect(filesMock.recordPendingCleanup).not.toHaveBeenCalled();
    expect(prismaMock.project.delete).not.toHaveBeenCalled();
    expect(filesMock.completeCleanup).not.toHaveBeenCalled();
  });

  it('withdraws the list and leaves the files alone when the row could not be deleted', async () => {
    prismaMock.project.findFirst.mockResolvedValue({
      id: 'p',
      userId: 'owner',
      _count: { images: 3 },
    });
    prismaMock.project.delete.mockRejectedValue(new Error('db down'));

    await expect(projectService.deleteProject('p', 'owner')).rejects.toThrow(
      'db down'
    );

    expect(filesMock.completeCleanup).not.toHaveBeenCalled();
    // Or the sweeper would later find a list for a project that still exists.
    expect(filesMock.discardPendingCleanup).toHaveBeenCalledWith(
      '/up/.pending/p.json'
    );
  });
});
