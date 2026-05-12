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
