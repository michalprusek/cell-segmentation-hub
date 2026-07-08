import type { ProjectImage } from '@/types';

/**
 * True when the project contains at least one video container with ≥ 2 frames —
 * i.e. a kymograph (which needs a time axis) can be built.
 *
 * The project images listing returns per-FRAME rows (each with `parentVideoId`
 * set), not the video-container rows, so `container.frameCount` is not available
 * here. The reliable signal is therefore "≥ 2 frames share a `parentVideoId`".
 * A container row that happens to carry `frameCount > 1` is also honoured.
 *
 * When this is false — a single-frame container, or only standalone images —
 * the export dialog offers per-image intensity profiles only.
 */
export function projectCanBuildKymograph(images: ProjectImage[]): boolean {
  const framesPerContainer = new Map<string, number>();
  for (const img of images) {
    if (img.isVideoContainer && (img.frameCount ?? 0) > 1) return true;
    if (img.parentVideoId) {
      const n = (framesPerContainer.get(img.parentVideoId) ?? 0) + 1;
      if (n > 1) return true;
      framesPerContainer.set(img.parentVideoId, n);
    }
  }
  return false;
}
