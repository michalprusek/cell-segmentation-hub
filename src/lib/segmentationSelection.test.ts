import { describe, it, expect } from 'vitest';
import { partitionSelectedForSegmentation } from './segmentationSelection';
import type { ProjectImage } from '@/types';

const img = (id: string, segmentationStatus?: string): ProjectImage =>
  ({ id, segmentationStatus }) as unknown as ProjectImage;

describe('partitionSelectedForSegmentation', () => {
  it('ignores unselected images entirely', () => {
    const images = [img('a', 'pending'), img('b', 'completed')];
    const { toSegment, toResegment } = partitionSelectedForSegmentation(
      images,
      new Set()
    );
    expect(toSegment).toEqual([]);
    expect(toResegment).toEqual([]);
  });

  it('routes selected unsegmented/failed/pending/none to toSegment', () => {
    const images = [
      img('a', 'pending'),
      img('b', 'failed'),
      img('c', 'no_segmentation'),
      img('d', undefined),
    ];
    const { toSegment, toResegment } = partitionSelectedForSegmentation(
      images,
      new Set(['a', 'b', 'c', 'd'])
    );
    expect(toSegment.map(i => i.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(toResegment).toEqual([]);
  });

  it('routes selected completed/segmented to toResegment', () => {
    const images = [img('a', 'completed'), img('b', 'segmented')];
    const { toSegment, toResegment } = partitionSelectedForSegmentation(
      images,
      new Set(['a', 'b'])
    );
    expect(toSegment).toEqual([]);
    expect(toResegment.map(i => i.id)).toEqual(['a', 'b']);
  });

  it('skips selected images already queued/processing', () => {
    const images = [img('a', 'queued'), img('b', 'processing')];
    const { toSegment, toResegment } = partitionSelectedForSegmentation(
      images,
      new Set(['a', 'b'])
    );
    expect(toSegment).toEqual([]);
    expect(toResegment).toEqual([]);
  });

  it('partitions a mixed selection correctly', () => {
    const images = [
      img('a', 'pending'),
      img('b', 'completed'),
      img('c', 'processing'),
      img('d', 'segmented'),
    ];
    const { toSegment, toResegment } = partitionSelectedForSegmentation(
      images,
      new Set(['a', 'b', 'c', 'd'])
    );
    expect(toSegment.map(i => i.id)).toEqual(['a']);
    expect(toResegment.map(i => i.id)).toEqual(['b', 'd']);
  });
});
