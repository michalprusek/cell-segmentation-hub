import type { ProjectImage } from '@/types';

export interface SelectedSegmentationPartition {
  /** Selected images not yet segmented (pending/failed/no_segmentation/none). */
  toSegment: ProjectImage[];
  /** Selected images already segmented (completed/segmented) — force re-run. */
  toResegment: ProjectImage[];
}

/**
 * Partition the SELECTED images into those to segment vs re-segment.
 *
 * - Unselected images are never included.
 * - Selected images currently `queued`/`processing` are skipped (in flight).
 *
 * Single source of truth for the "segment only the selected ones" decision,
 * shared by the enqueue handler and the queue button's label/counts.
 */
export function partitionSelectedForSegmentation(
  images: ProjectImage[],
  selectedImageIds: Set<string>
): SelectedSegmentationPartition {
  const toSegment: ProjectImage[] = [];
  const toResegment: ProjectImage[] = [];

  for (const image of images) {
    if (!selectedImageIds.has(image.id)) {
      continue;
    }
    const status = image.segmentationStatus;
    if (
      !status ||
      status === 'pending' ||
      status === 'failed' ||
      status === 'no_segmentation'
    ) {
      toSegment.push(image);
    } else if (status === 'completed' || status === 'segmented') {
      toResegment.push(image);
    }
    // queued / processing → skipped (already in flight)
  }

  return { toSegment, toResegment };
}
