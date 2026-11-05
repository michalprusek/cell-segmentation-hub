import { previewUrlFor } from './previewVersion';

/**
 * Which image a dashboard card shows, as a Prisma `images` relation query:
 * the newest image the project grid shows — a still, or the FIRST frame of a
 * video. Never a container (the grid hides them) and never an arbitrary frame
 * of a 300-frame upload whose rows all share one `createdAt`.
 *
 * One definition for every list that carries a card picture — the owner's
 * project list (`projectService.getUserProjects`) and the shared-projects list
 * (`sharingService.getSharedProjects`). The second had its own copy without
 * `previewUrl`, and every shared project's card fell back to the placeholder.
 */
export const PROJECT_CARD_IMAGE_QUERY = {
  take: 1,
  where: {
    isVideoContainer: false,
    OR: [{ parentVideoId: null }, { frameIndex: 0 }],
  },
  orderBy: [{ createdAt: 'desc' as const }, { id: 'asc' as const }],
  select: {
    id: true,
    name: true,
    thumbnailPath: true,
    originalPath: true,
    segmentationStatus: true,
    createdAt: true,
    updatedAt: true,
    segmentation: { select: { id: true, updatedAt: true } },
  },
};

/** The card preview URL of a project row loaded with that query. */
export function projectCardPreviewUrl(
  images:
    | Array<{
        id: string;
        originalPath: string;
        segmentation?: { id: string; updatedAt: Date } | null;
      }>
    | undefined
): string | null {
  const first = images?.[0];
  return first ? previewUrlFor(first) : null;
}

/** The card image row, without the segmentation stamp only the version
 *  needed. */
export function withoutSegmentation<T extends { segmentation?: unknown }>(
  row: T
): Omit<T, 'segmentation'> {
  const { segmentation: _segmentation, ...rest } = row;
  return rest;
}
