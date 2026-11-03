import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import type { ProjectImage } from '@/types';
import apiClient from '@/lib/api';
import { loadFullSegmentations } from '../loadFullSegmentations';

vi.mock('@/lib/api', () => ({
  default: { getProjectImagesWithThumbnails: vi.fn() },
}));

const list = apiClient.getProjectImagesWithThumbnails as Mock;

const listed = (id: string, segmented = true) =>
  ({
    id,
    name: id,
    segmentationResult: segmented ? { polygons: [] } : undefined,
  }) as unknown as ProjectImage;

const row = (id: string, polygons: unknown[] = [{ id: `${id}-p` }]) => ({
  id,
  segmentationResult: { polygons, levelOfDetail: 'high' },
});

function serve(rows: Array<{ id: string; segmentationResult?: unknown }>) {
  list.mockImplementation(async (_projectId: string, { page, limit }) => ({
    images: rows.slice((page - 1) * limit, page * limit),
    pagination: {
      page,
      limit,
      total: rows.length,
      pages: Math.ceil(rows.length / limit),
    },
  }));
}

beforeEach(() => {
  list.mockReset();
});

describe('loadFullSegmentations', () => {
  it('asks for full polygons, 100 images a page, the backend maximum', async () => {
    serve([row('a')]);

    await loadFullSegmentations('project-1', [listed('a')]);

    expect(list).toHaveBeenCalledWith('project-1', {
      page: 1,
      limit: 100,
      lod: 'high',
    });
  });

  it('replaces the listed segmentation of each image', async () => {
    serve([row('a')]);

    const [image] = await loadFullSegmentations('project-1', [listed('a')]);

    expect(image.segmentationResult?.polygons).toEqual([{ id: 'a-p' }]);
  });

  it('follows the pages until it has every wanted image', async () => {
    const rows = Array.from({ length: 150 }, (_, i) => row(`i${i}`));
    serve(rows);

    const [image] = await loadFullSegmentations('project-1', [listed('i149')]);

    expect(list).toHaveBeenCalledTimes(2);
    expect(image.segmentationResult?.polygons).toEqual([{ id: 'i149-p' }]);
  });

  it('stops as soon as it has them, even with pages left', async () => {
    const rows = Array.from({ length: 250 }, (_, i) => row(`i${i}`));
    serve(rows);

    await loadFullSegmentations('project-1', [listed('i0')]);

    expect(list).toHaveBeenCalledTimes(1);
  });

  it('does not ask when no image has a segmentation', async () => {
    const images = [listed('a', false)];

    await expect(loadFullSegmentations('project-1', images)).resolves.toEqual(
      images
    );
    expect(list).not.toHaveBeenCalled();
  });

  it('keeps images without a segmentation as they are', async () => {
    serve([row('a')]);
    const bare = listed('b', false);

    const out = await loadFullSegmentations('project-1', [listed('a'), bare]);

    expect(out[1]).toBe(bare);
  });

  it('refuses rather than exporting an image the server no longer returns', async () => {
    serve([row('a')]);

    await expect(
      loadFullSegmentations('project-1', [listed('a'), listed('gone')])
    ).rejects.toThrow(/gone/);
  });

  it('refuses an image whose segmentation has disappeared', async () => {
    serve([{ id: 'a' }]);

    await expect(
      loadFullSegmentations('project-1', [listed('a')])
    ).rejects.toThrow(/a/);
  });

  it('refuses without a project id instead of writing empty polygons', async () => {
    await expect(
      loadFullSegmentations(undefined, [listed('a')])
    ).rejects.toThrow(/project/i);
  });

  it('does not export the internal embedding of a polyline', async () => {
    serve([row('a', [{ id: 'p', _embedding: [0.1, 0.2], points: [] }])]);

    const [image] = await loadFullSegmentations('project-1', [listed('a')]);

    expect(image.segmentationResult?.polygons).toEqual([
      { id: 'p', points: [] },
    ]);
  });

  it('passes on the mark of a row the server could not parse', async () => {
    serve([
      {
        id: 'a',
        segmentationResult: { polygons: [], hasParseError: true },
      },
    ]);

    const [image] = await loadFullSegmentations('project-1', [listed('a')]);

    expect(image.segmentationResult).toMatchObject({ hasParseError: true });
  });
});
