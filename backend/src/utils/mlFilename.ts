/**
 * Build a safe filename for the ML service multipart upload.
 *
 * The Python ML service validates uploads by `filename.split('.').pop()`
 * (see backend/segmentation/api/routes.py:39 validate_image). For most
 * standalone images this works — they're named "sample.png", split on
 * '.', last token is "png", happy path. But video-frame Image rows
 * inherit their container's human-readable name with a frame suffix,
 * e.g. "20260429_CH2_DNA_origami_BRB80MB_DO1_v2_10x_.nd2 (frame 98)".
 * That last '.' token becomes "nd2 (frame 98)", which is not in the
 * allowed extension set → ML returns 400 "Invalid image file" even
 * though the underlying buffer is a perfectly valid PNG.
 *
 * Fix: send the ML service a synthetic filename derived from the
 * mimeType so the extension always matches the bytes. The actual
 * filename is irrelevant once validation passes — the ML service
 * opens via PIL.Image.open() on the buffer, not on disk.
 */

const EXT_BY_MIME: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/tiff': '.tif',
  'image/tif': '.tif',
  'image/bmp': '.bmp',
};

/**
 * Returns a filename guaranteed to satisfy the ML service's
 * extension-based validator.
 */
export function safeMlFilename(input: {
  id: string;
  name?: string | null;
  mimeType?: string | null;
}): string {
  // Prefer mimeType — it's what tells the truth about the bytes the
  // backend is about to send. For PNG frames the mimeType is
  // "image/png" regardless of the human-readable name.
  if (input.mimeType) {
    const ext = EXT_BY_MIME[input.mimeType.toLowerCase()];
    if (ext) {
      return `${input.id}${ext}`;
    }
  }

  // Fall back to sanitising the name. Replace whitespace and parens
  // (the troublemakers for ML's split('.')-on-last-token validator)
  // with underscores. Drop anything after the last dot in the
  // remaining name and use the file's extension if it looks safe.
  if (input.name) {
    const sanitised = input.name.replace(/[\s()]+/g, '_');
    // Already safe filename → use as-is.
    if (/\.(png|jpe?g|tiff?|bmp)$/i.test(sanitised)) {
      return sanitised;
    }
    // Otherwise fall through to id-based filename below.
  }

  // Last resort: pretend it's a PNG. The ML service still tries to
  // PIL.Image.open() the buffer, so if the bytes aren't really PNG
  // the error surface stays meaningful.
  return `${input.id}.png`;
}
