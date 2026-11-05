import { createHash } from 'crypto';

/**
 * What a project-grid preview IS, reduced to a short hash.
 *
 * A preview is derived data: the image's pixels with its stored segmentation
 * drawn over them. It used to be a file written by whichever code path
 * remembered to regenerate it, and three of the ~15 paths that change a
 * segmentation did (ML result, editor update, editor create). Deleting a
 * segmentation, every cross-frame track operation, static-channel projection,
 * neurite soma assignment and type-label clean-up left the old picture in
 * place, and nothing told the browser a new one existed.
 *
 * So the preview is now addressed by its inputs instead (the CVAT pattern:
 * `cvat/apps/engine/cache.py` validates a cached preview against the row's
 * `updated_date` rather than invalidating it from every writer). Any write to
 * the segmentation row moves `updatedAt` (Prisma `@updatedAt`), which moves
 * the version, which moves the URL — a stale preview cannot be served for a
 * current URL, and a write path that forgets to say anything still yields a
 * correct preview the next time the grid is listed.
 *
 * Inputs, and why each is one:
 *  - `originalPath`: the pixels. A frame's path names its channel, so
 *    changing the segmentation source changes it.
 *  - segmentation `id` + `updatedAt`: the overlay. The id distinguishes a
 *    deleted-and-recreated row whose clock happened to land on the same
 *    millisecond; `null` (no segmentation) is its own version — the bare image.
 *  - `PREVIEW_RENDERER_VERSION`: how it is drawn. Bump it whenever
 *    `previewRenderer.ts` changes what it outputs, and every preview is redrawn
 *    lazily on its next view; the garbage collector removes the old files.
 */
export const PREVIEW_RENDERER_VERSION = 1;

export interface PreviewInputs {
  originalPath: string;
  segmentation: { id: string; updatedAt: Date } | null;
}

export function previewVersion(inputs: PreviewInputs): string {
  const seg = inputs.segmentation
    ? `${inputs.segmentation.id}@${inputs.segmentation.updatedAt.getTime()}`
    : 'none';
  return createHash('sha1')
    .update(`${PREVIEW_RENDERER_VERSION}|${inputs.originalPath}|${seg}`)
    .digest('hex')
    .slice(0, 16);
}

/** The URL the browser loads. Versioned, so it can be cached forever. */
export function previewUrl(imageId: string, version: string): string {
  return `/api/images/${encodeURIComponent(imageId)}/preview?v=${version}`;
}

/** `previewUrl` straight from an image row and its (optional) segmentation. */
export function previewUrlFor(image: {
  id: string;
  originalPath: string;
  segmentation?: { id: string; updatedAt: Date } | null;
}): string {
  return previewUrl(
    image.id,
    previewVersion({
      originalPath: image.originalPath,
      segmentation: image.segmentation ?? null,
    })
  );
}

/** A version is 16 lowercase hex digits; anything else is not one of ours. */
export const PREVIEW_VERSION_PATTERN = /^[0-9a-f]{16}$/;
