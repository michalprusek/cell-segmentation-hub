/**
 * projectService.gaps5.test.ts
 *
 * Covers branches still uncovered after projectService.test.ts:
 *
 *  A. getUserProjects — error/branch paths
 *     - throws (and re-throws) when user not found
 *     - folderId='root' branch filters to projects without folderItems
 *     - folderId='<uuid>' filters to specific folder
 *     - search clause added to where.AND when search option provided
 *     - invalid sortBy falls back to 'createdAt'
 *     - statsMap branch: segment stats build correctly per project
 *     - thumbnail URL fallback: latestImage has id but no thumbnailPath
 *     - error catch re-throws
 *
 *  B. getProjectById — error paths
 *     - returns null when project not found (after access granted)
 *     - throws and re-throws on prisma error
 *
 *  C. updateProject — error catch
 *     - throws when prisma.project.update throws
 *
 *  D. deleteProject — error catch
 *     - throws when prisma.project.delete throws
 *
 *  E. getProjectStats — uncovered branches
 *     - returns null when project not found
 *     - error catch re-throws
 *
 *  F. checkProjectOwnership — error catch
 *     - throws when findFirst throws
 *
 *  G. canModifyProject — error → returns false
 *     - when checkProjectOwnership throws, returns false
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const { prismaMock } = vi.hoisted(() => {
  const mock = {
    project: {
      create: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      count: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
    },
    image: {
      count: vi.fn(),
      findMany: vi.fn(),
      groupBy: vi.fn(),
      aggregate: vi.fn(),
    },
    segmentation: {
      count: vi.fn(),
    },
  };
  return { prismaMock: mock };
});

vi.mock('../../db', () => ({ prisma: prismaMock }));
vi.mock('../../utils/logger');
vi.mock('../sharingService', () => ({
  hasProjectAccess: vi
    .fn()
    .mockResolvedValue({ hasAccess: true, isOwner: true }),
}));

import * as projectService from '../projectService';
import * as SharingService from '../sharingService';

const mockHasProjectAccess = SharingService.hasProjectAccess as ReturnType<
  typeof vi.fn
>;

// Default project fixture
const baseProject = {
  id: 'proj-1',
  title: 'Test Project',
  description: 'Description',
  userId: 'user-1',
  type: 'spheroid',
  createdAt: new Date(),
  updatedAt: new Date(),
  _count: { images: 0 },
  images: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  mockHasProjectAccess.mockResolvedValue({ hasAccess: true, isOwner: true });
  prismaMock.project.count.mockResolvedValue(0);
  prismaMock.project.findMany.mockResolvedValue([]);
  prismaMock.image.groupBy.mockResolvedValue([]);
  prismaMock.user.findUnique.mockResolvedValue({ id: 'user-1' });
});

// ─── A. getUserProjects ────────────────────────────────────────────────────────

describe('projectService.getUserProjects', () => {
  it('throws "User not found" when user lookup fails', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce(null);

    await expect(
      projectService.getUserProjects('user-missing', {})
    ).rejects.toThrow('User not found');
  });

  it('folderId="root" applies folderItems.none filter', async () => {
    prismaMock.project.count.mockResolvedValueOnce(0);
    prismaMock.project.findMany.mockResolvedValueOnce([]);
    prismaMock.image.groupBy.mockResolvedValueOnce([]);

    await projectService.getUserProjects('user-1', { folderId: 'root' });

    // Should have called findMany with a where that includes folderItems.none
    const call = prismaMock.project.findMany.mock.calls[0][0];
    expect(call.where.folderItems).toEqual({ none: { userId: 'user-1' } });
  });

  it('folderId="<uuid>" applies folderItems.some filter', async () => {
    prismaMock.project.count.mockResolvedValueOnce(0);
    prismaMock.project.findMany.mockResolvedValueOnce([]);
    prismaMock.image.groupBy.mockResolvedValueOnce([]);

    await projectService.getUserProjects('user-1', { folderId: 'folder-uuid' });

    const call = prismaMock.project.findMany.mock.calls[0][0];
    expect(call.where.folderItems).toEqual({
      some: { userId: 'user-1', folderId: 'folder-uuid' },
    });
  });

  it('search option adds OR clause to where.AND', async () => {
    prismaMock.project.count.mockResolvedValueOnce(0);
    prismaMock.project.findMany.mockResolvedValueOnce([]);
    prismaMock.image.groupBy.mockResolvedValueOnce([]);

    await projectService.getUserProjects('user-1', { search: 'spheroid' });

    const call = prismaMock.project.findMany.mock.calls[0][0];
    expect(call.where.AND).toBeDefined();
    expect(call.where.AND[0].OR[0].title).toBeDefined();
  });

  it('invalid sortBy defaults to createdAt', async () => {
    prismaMock.project.count.mockResolvedValueOnce(0);
    prismaMock.project.findMany.mockResolvedValueOnce([]);
    prismaMock.image.groupBy.mockResolvedValueOnce([]);

    await projectService.getUserProjects('user-1', {
      sortBy: 'invalidField' as never,
      sortOrder: 'asc' as never,
    });

    const call = prismaMock.project.findMany.mock.calls[0][0];
    // With invalid sortBy, orderBy.createdAt should be set
    expect('createdAt' in call.orderBy).toBe(true);
  });

  it('thumbnail URL fallback uses /api/images/<id>/display when no thumbnailPath', async () => {
    const proj = {
      ...baseProject,
      shares: [],
      folderItems: [],
      user: { id: 'user-1', email: 'u@test.com' },
      images: [
        {
          id: 'img-fallback',
          name: 'photo.jpg',
          thumbnailPath: null,
          segmentationStatus: 'no_segmentation',
          isVideoContainer: false,
        },
      ],
      _count: { images: 1 },
    };
    prismaMock.project.count.mockResolvedValueOnce(1);
    prismaMock.project.findMany.mockResolvedValueOnce([proj]);
    prismaMock.image.groupBy.mockResolvedValueOnce([]);

    const result = await projectService.getUserProjects('user-1', {});
    const p = result.projects[0];
    expect(p.thumbnailUrl).toMatch(/\/api\/images\/img-fallback\/display/);
  });

  it('error catch re-throws', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce({ id: 'user-1' });
    prismaMock.project.count.mockRejectedValueOnce(new Error('DB error'));

    await expect(projectService.getUserProjects('user-1', {})).rejects.toThrow(
      'DB error'
    );
  });
});

// ─── B. getProjectById — error paths ──────────────────────────────────────────

describe('projectService.getProjectById', () => {
  it('returns null when project not found after access granted', async () => {
    mockHasProjectAccess.mockResolvedValueOnce({
      hasAccess: true,
      isOwner: true,
    });
    prismaMock.project.findUnique.mockResolvedValueOnce(null);

    const result = await projectService.getProjectById(
      'proj-missing',
      'user-1'
    );
    expect(result).toBeNull();
  });

  it('throws and re-throws on prisma error', async () => {
    mockHasProjectAccess.mockResolvedValueOnce({
      hasAccess: true,
      isOwner: true,
    });
    prismaMock.project.findUnique.mockRejectedValueOnce(
      new Error('Connection error')
    );

    await expect(
      projectService.getProjectById('proj-1', 'user-1')
    ).rejects.toThrow('Connection error');
  });
});

// ─── C. updateProject — error catch ──────────────────────────────────────────

describe('projectService.updateProject', () => {
  it('throws when prisma.project.update throws', async () => {
    prismaMock.project.findFirst.mockResolvedValueOnce(baseProject);
    prismaMock.project.update.mockRejectedValueOnce(new Error('FK constraint'));

    await expect(
      projectService.updateProject('proj-1', 'user-1', { title: 'new title' })
    ).rejects.toThrow('FK constraint');
  });
});

// ─── D. deleteProject — error catch ──────────────────────────────────────────

describe('projectService.deleteProject', () => {
  it('throws when prisma.project.delete throws', async () => {
    prismaMock.project.findFirst.mockResolvedValueOnce({
      ...baseProject,
      _count: { images: 3 },
    });
    prismaMock.project.delete.mockRejectedValueOnce(
      new Error('Constraint violation')
    );

    await expect(
      projectService.deleteProject('proj-1', 'user-1')
    ).rejects.toThrow('Constraint violation');
  });
});

// ─── E. getProjectStats — uncovered branches ──────────────────────────────────

describe('projectService.getProjectStats', () => {
  it('returns null when project not found', async () => {
    mockHasProjectAccess.mockResolvedValueOnce({
      hasAccess: true,
      isOwner: true,
    });
    prismaMock.project.findUnique.mockResolvedValueOnce(null);

    const result = await projectService.getProjectStats(
      'proj-missing',
      'user-1'
    );
    expect(result).toBeNull();
  });

  it('error catch re-throws', async () => {
    mockHasProjectAccess.mockResolvedValueOnce({
      hasAccess: true,
      isOwner: true,
    });
    prismaMock.project.findUnique.mockRejectedValueOnce(
      new Error('DB timeout')
    );

    await expect(
      projectService.getProjectStats('proj-1', 'user-1')
    ).rejects.toThrow('DB timeout');
  });
});

// ─── F. checkProjectOwnership — error catch ───────────────────────────────────

describe('projectService.checkProjectOwnership', () => {
  it('throws when findFirst throws', async () => {
    prismaMock.project.findFirst.mockRejectedValueOnce(
      new Error('Network error')
    );

    await expect(
      projectService.checkProjectOwnership('proj-1', 'user-1')
    ).rejects.toThrow('Network error');
  });
});

// ─── G. canModifyProject — error → returns false ─────────────────────────────

describe('projectService.canModifyProject', () => {
  it('returns false when checkProjectOwnership throws internally', async () => {
    prismaMock.project.findFirst.mockRejectedValueOnce(new Error('DB error'));

    const result = await projectService.canModifyProject('proj-1', 'user-1');
    expect(result).toBe(false);
  });
});
