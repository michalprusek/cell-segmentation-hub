/**
 * userService.gaps5.test.ts
 *
 * Covers branches still uncovered after userService.test.ts and stats.test.ts:
 *
 *  A. getUserProfile — error catch (line 101-104)
 *     - throws when prisma throws
 *
 *  B. getUserActivity — main function + error catch (lines 274-384)
 *     - returns activities sorted by timestamp when data exists
 *     - pagination: hasMore computed correctly
 *     - throws when prisma throws
 *
 *  C. updateUserProfile — additional branches (lines 397-407)
 *     - email update when updates.email is set
 *     - profileData.title from firstName+lastName
 *     - throws when prisma throws
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    user: {
      findUnique: vi.fn() as ReturnType<typeof vi.fn>,
      update: vi.fn() as ReturnType<typeof vi.fn>,
    },
    project: {
      count: vi.fn() as ReturnType<typeof vi.fn>,
      findMany: vi.fn() as ReturnType<typeof vi.fn>,
    },
    image: {
      count: vi.fn() as ReturnType<typeof vi.fn>,
      aggregate: vi.fn() as ReturnType<typeof vi.fn>,
      findMany: vi.fn() as ReturnType<typeof vi.fn>,
    },
    segmentation: {
      count: vi.fn() as ReturnType<typeof vi.fn>,
      findMany: vi.fn() as ReturnType<typeof vi.fn>,
    },
    profile: {
      upsert: vi.fn() as ReturnType<typeof vi.fn>,
    },
  },
}));

vi.mock('../../db', () => ({ prisma: prismaMock }));
vi.mock('../../utils/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), debug: vi.fn(), warn: vi.fn() },
}));

import {
  getUserProfile,
  getUserActivity,
  updateUserProfile,
} from '../userService';

const userId = 'user-gaps5';

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── A. getUserProfile — error catch ──────────────────────────────────────────

describe('getUserProfile — error catch', () => {
  it('re-throws when prisma throws', async () => {
    prismaMock.user.findUnique.mockRejectedValueOnce(new Error('DB down'));

    await expect(getUserProfile(userId)).rejects.toThrow('DB down');
  });
});

// ─── B. getUserActivity ───────────────────────────────────────────────────────

describe('getUserActivity', () => {
  beforeEach(() => {
    // Setup default mocks
    prismaMock.project.findMany.mockResolvedValue([
      {
        id: 'p1',
        title: 'Project 1',
        createdAt: new Date('2026-01-10T00:00:00Z'),
      },
      {
        id: 'p2',
        title: 'Project 2',
        createdAt: new Date('2026-01-05T00:00:00Z'),
      },
    ]);
    prismaMock.image.findMany.mockResolvedValue([
      {
        id: 'img-1',
        name: 'photo.png',
        createdAt: new Date('2026-01-08T00:00:00Z'),
        project: { title: 'Project 1' },
      },
    ]);
    prismaMock.segmentation.findMany.mockResolvedValue([
      {
        id: 'seg-1',
        model: 'hrnet',
        createdAt: new Date('2026-01-09T00:00:00Z'),
        image: { name: 'photo.png' },
      },
    ]);
  });

  it('returns activities sorted by timestamp (most recent first)', async () => {
    const result = await getUserActivity(userId);

    expect(result.items).toBeDefined();
    expect(Array.isArray(result.items)).toBe(true);
    // 2 projects + 1 image + 1 segmentation = 4 activities
    expect(result.items.length).toBe(4);
    // Most recent first
    const timestamps = result.items.map(i => new Date(i.timestamp).getTime());
    for (let i = 0; i < timestamps.length - 1; i++) {
      expect(timestamps[i]).toBeGreaterThanOrEqual(timestamps[i + 1]);
    }
  });

  it('pagination: hasMore=true when there are more items', async () => {
    // getUserActivity(userId, limit, offset)
    const result = await getUserActivity(userId, 2, 0);

    expect(result.pagination.total).toBe(4);
    expect(result.pagination.hasMore).toBe(true);
    expect(result.items).toHaveLength(2);
  });

  it('pagination: hasMore=false when all items returned', async () => {
    const result = await getUserActivity(userId, 10, 0);

    expect(result.pagination.hasMore).toBe(false);
  });

  it('pagination: offset works correctly', async () => {
    const allResult = await getUserActivity(userId, 4, 0);
    const pagedResult = await getUserActivity(userId, 2, 2);

    // 4 total: items[2] of allResult should equal items[0] of pagedResult
    expect(pagedResult.items[0]).toEqual(allResult.items[2]);
  });

  it('re-throws when prisma throws', async () => {
    prismaMock.project.findMany.mockRejectedValueOnce(new Error('DB timeout'));

    await expect(getUserActivity(userId)).rejects.toThrow('DB timeout');
  });

  it('never asks for the polygons blob', async () => {
    // The activity line reads only id / model / createdAt / image.name. The
    // previous `include: { image: { select: { name: true } } }` narrowed the
    // RELATION but left the Segmentation row unnarrowed, so all five rows
    // dragged `polygons` — a whole frame's geometry as JSON-in-TEXT — across
    // the wire and threw it away.
    await getUserActivity(userId);

    const args = prismaMock.segmentation.findMany.mock.calls[0][0];
    expect(args.include).toBeUndefined();
    expect(args.select).toEqual({
      id: true,
      model: true,
      createdAt: true,
      image: { select: { name: true } },
    });
    expect(Object.keys(args.select)).not.toContain('polygons');
  });

  it('narrows the image read to the four fields the feed renders', async () => {
    await getUserActivity(userId);

    const args = prismaMock.image.findMany.mock.calls[0][0];
    expect(args.include).toBeUndefined();
    expect(args.select).toEqual({
      id: true,
      name: true,
      createdAt: true,
      project: { select: { title: true } },
    });
  });

  it('issues the three reads in ONE round trip, not three', async () => {
    // Nothing here depends on anything else, so blocking the first read must
    // NOT stop the other two from being issued.
    let releaseProjects!: (v: unknown) => void;
    prismaMock.project.findMany.mockReturnValueOnce(
      new Promise(resolve => {
        releaseProjects = resolve;
      })
    );

    const pending = getUserActivity(userId);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(prismaMock.image.findMany).toHaveBeenCalledTimes(1);
    expect(prismaMock.segmentation.findMany).toHaveBeenCalledTimes(1);

    releaseProjects([]);
    await pending;
  });
});

// ─── C. updateUserProfile — additional branches ───────────────────────────────

describe('updateUserProfile', () => {
  beforeEach(() => {
    prismaMock.user.update.mockResolvedValue(undefined);
    prismaMock.profile.upsert.mockResolvedValue({});
  });

  it('updates email when updates.email is provided', async () => {
    await updateUserProfile(userId, { email: 'new@example.com' });

    expect(prismaMock.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { email: 'new@example.com' },
      })
    );
  });

  it('sets title from firstName and lastName', async () => {
    await updateUserProfile(userId, {
      firstName: 'John',
      lastName: 'Doe',
    });

    expect(prismaMock.profile.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({ title: 'John Doe' }),
      })
    );
  });

  it('re-throws when prisma throws', async () => {
    prismaMock.profile.upsert.mockRejectedValueOnce(new Error('Upsert failed'));

    await expect(updateUserProfile(userId, { language: 'en' })).rejects.toThrow(
      'Upsert failed'
    );
  });
});
