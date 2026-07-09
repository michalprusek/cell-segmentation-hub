import { describe, it, expect, vi, beforeEach } from 'vitest';

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    project: {
      findUnique: vi.fn() as ReturnType<typeof vi.fn>,
      update: vi.fn() as ReturnType<typeof vi.fn>,
    },
    image: { findMany: vi.fn() as ReturnType<typeof vi.fn> },
    segmentation: { update: vi.fn() as ReturnType<typeof vi.fn> },
    $transaction: vi.fn() as ReturnType<typeof vi.fn>,
  },
}));

vi.mock('../../db', () => ({ prisma: prismaMock }));
vi.mock('../../utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { getLabels, putLabels, deleteLabel } from '../mtTypeLabelService';

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.$transaction.mockResolvedValue([]);
  prismaMock.project.update.mockResolvedValue({});
  prismaMock.segmentation.update.mockReturnValue({});
});

describe('getLabels', () => {
  it('sanitizes the stored palette', async () => {
    prismaMock.project.findUnique.mockResolvedValue({
      mtTypeLabels: [
        { id: 'a', name: 'alpha', color: '#ff0000' },
        { id: '', name: 'x', color: '#000000' }, // dropped
      ],
    });
    expect(await getLabels('p1')).toEqual([
      { id: 'a', name: 'alpha', color: '#ff0000' },
    ]);
  });

  it('returns [] when the project is missing or the column is null', async () => {
    prismaMock.project.findUnique.mockResolvedValueOnce(null);
    expect(await getLabels('p1')).toEqual([]);
    prismaMock.project.findUnique.mockResolvedValueOnce({ mtTypeLabels: null });
    expect(await getLabels('p1')).toEqual([]);
  });
});

describe('putLabels', () => {
  it('stores the sanitized set and reports removed ids', async () => {
    prismaMock.project.findUnique.mockResolvedValue({
      mtTypeLabels: [
        { id: 'a', name: 'alpha', color: '#ff0000' },
        { id: 'b', name: 'beta', color: '#00ff00' },
      ],
    });
    const res = await putLabels('p1', [
      { id: 'a', name: 'alpha', color: '#ff0000' },
    ]);
    expect(res.labels).toEqual([{ id: 'a', name: 'alpha', color: '#ff0000' }]);
    expect(res.removedIds).toEqual(['b']);
    expect(prismaMock.project.update).toHaveBeenCalledTimes(1);
  });
});

describe('deleteLabel', () => {
  const withLabel = () =>
    prismaMock.project.findUnique.mockResolvedValue({
      mtTypeLabels: [{ id: 'a', name: 'alpha', color: '#ff0000' }],
    });

  it('removes the entry and nulls mtType references across frames', async () => {
    withLabel();
    prismaMock.image.findMany.mockResolvedValue([
      {
        id: 'f1',
        segmentation: {
          id: 's1',
          polygons: JSON.stringify([{ id: 'p', mtType: 'a', trackId: 't' }]),
        },
      },
      {
        id: 'f2',
        segmentation: {
          id: 's2',
          polygons: JSON.stringify([{ id: 'q', mtType: 'other' }]),
        },
      },
      { id: 'f3', segmentation: null },
    ]);
    const res = await deleteLabel('p1', 'a');
    expect(res.labels).toEqual([]);
    expect(res.framesCleaned).toBe(1);
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
  });

  it('guards an empty labelId (no scan, no writes)', async () => {
    prismaMock.project.findUnique.mockResolvedValue({ mtTypeLabels: [] });
    const res = await deleteLabel('p1', '');
    expect(res.framesCleaned).toBe(0);
    expect(prismaMock.image.findMany).not.toHaveBeenCalled();
  });

  it('skips the transaction when no frame references the label', async () => {
    withLabel();
    prismaMock.image.findMany.mockResolvedValue([
      {
        id: 'f',
        segmentation: {
          id: 's',
          polygons: JSON.stringify([{ id: 'p', mtType: 'other' }]),
        },
      },
    ]);
    const res = await deleteLabel('p1', 'a');
    expect(res.framesCleaned).toBe(0);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('tolerates corrupt polygons JSON without throwing', async () => {
    withLabel();
    prismaMock.image.findMany.mockResolvedValue([
      { id: 'f', segmentation: { id: 's', polygons: 'not json' } },
    ]);
    const res = await deleteLabel('p1', 'a');
    expect(res.framesCleaned).toBe(0);
  });
});
