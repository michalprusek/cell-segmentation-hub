/**
 * Rewrite the channel segment of a video-frame storage key.
 *
 * Frame paths look like
 *   projects/<pid>/images/<videoId>/frames/<NNNN>/<channel>.<ext>
 * where <channel> is a token like "488_nm", "640_nm", "ch_0". When the user
 * picks a non-default channel for Segment All, we keep the rest of the path
 * intact and just swap the channel token. For non-frame paths (single images,
 * legacy rows without channels), this is a no-op and returns the input.
 *
 * Lives in utils/ (not the segmentation service) so unit tests can import
 * the function in isolation — the service module triggers parseConfig at
 * import time, which is fine for runtime but inconvenient for pure tests.
 */
export function resolveChannelPath(
  originalPath: string,
  channel: string | null | undefined
): string {
  if (!channel) {
    return originalPath;
  }
  // Only video-frame rows live under .../frames/<NNNN>/<channel>.<ext>.
  // Match the last "/frames/<digits>/" segment and replace the filename body.
  const framePattern = /(\/frames\/\d+\/)([^/]+?)(\.[A-Za-z0-9]+)$/;
  if (!framePattern.test(originalPath)) {
    return originalPath;
  }
  return originalPath.replace(framePattern, `$1${channel}$3`);
}

/** The part of a container's channel metadata `frameChannelPath` reads. */
export interface FrameChannelMeta {
  name: string;
  sparseFill?: Record<string, number> | null;
}

/**
 * Storage key of one channel's image for one video frame, following a sparse
 * channel to the frame that stands in for a gap.
 *
 * `resolveChannelPath` swaps the channel name and nothing else, which is right
 * for a channel acquired on every frame. A channel the microscope refreshed
 * only every N-th frame has NO picture of its own on the frames in between:
 * the container's `sparseFill` says which frame each gap reads from, and the
 * pixels are never duplicated on disk. Reading the gap frame's own file would
 * return the constant fill the acquisition software wrote there.
 *
 * Returns `null` when `framePath` is not a video-frame path, so a caller can
 * tell "this image has no channels" from "this is the channel's file".
 */
export function frameChannelPath(
  framePath: string,
  channel: FrameChannelMeta
): string | null {
  const framePattern = /(\/frames\/)(\d+)(\/)([^/]+?)(\.[A-Za-z0-9]+)$/;
  const match = framePattern.exec(framePath);
  if (!match) {
    return null;
  }
  // The directory number IS the frame index (`frames/<NNNN>/`), which is also
  // what `sparseFill` is keyed by.
  const digits = match[2] ?? '';
  const anchor = channel.sparseFill?.[String(Number(digits))];
  // `Number.isInteger`, not a coercion: a corrupt `null` entry must not turn
  // into a redirect to frame 0.
  const index =
    typeof anchor === 'number' && Number.isInteger(anchor) && anchor >= 0
      ? anchor
      : Number(digits);
  const padded = String(index).padStart(digits.length, '0');
  return framePath.replace(
    framePattern,
    `$1${padded}$3${channel.name}$5`
  );
}
