/**
 * How many pixels sharp is allowed to decode from a user-supplied image.
 *
 * sharp defaults `limitInputPixels` to 0x3FFF_FFFF — 268.4 megapixels — as a
 * decompression-bomb guard, and rejects anything larger with
 * `Input image exceeds pixel limit`. That default is far below what light
 * microscopy actually produces.
 *
 * Reported 2026-09-10 as "a ~1 GB single-channel TIFF would not upload, and
 * the moment I converted it to PNG it went straight through". The conversion
 * was a red herring: the file is **22 324 x 22 324 = 498.4 Mpx**, 1.86x over
 * sharp's default, so it failed on every path that reads it — the TIFF upload
 * died generating the container thumbnail (`videoUploadService`), and the
 * converted 16 MB JPEG uploaded but then could not be segmented, because the
 * pixel count is a property of the image and not of its container format.
 *
 * 1 Gpx is chosen against the memory actually available rather than picked for
 * roundness: the backend container is capped at 12 GB, and libvips decodes
 * outside the V8 heap, so the binding cost is roughly `pixels x channels x
 * bytes-per-sample`. At 1 Gpx that is ~3 GB for 8-bit RGB — a decode that fits
 * with room for the rest of the process — while still leaving 2x headroom over
 * the largest real image this has had to handle.
 *
 * It is deliberately NOT `false`. Removing the guard entirely would let a
 * malformed or hostile file ask for an unbounded allocation, which is the
 * failure mode the sharp default exists to prevent.
 */
export const MAX_INPUT_PIXELS = 1_000_000_000;

/**
 * Spread into a sharp constructor for anything a USER supplied.
 *
 * Not for avatars (`authService`): those are small by definition and the tight
 * default is the right guard there.
 */
export const SHARP_INPUT_LIMITS = { limitInputPixels: MAX_INPUT_PIXELS } as const;

/**
 * How long to let the ML service work on one frame, from its pixel count.
 *
 * The client-side ceiling used to be a flat 5 minutes, which is generous for
 * the sizes this platform started with and far too short for the ones it now
 * accepts. Measured 2026-09-10 on the frame from the report above:
 *
 *   6 664 x 6 657   44 Mpx    ~22 s   (the model's own packaged sample)
 *   22 324 x 22 324 498 Mpx  1 342 s  (22.4 min, once the accumulators moved
 *                                      off the GPU — before that it spent
 *                                      1 246 s and then ran out of memory)
 *
 * That is ~2.7 s per megapixel at the large end and ~0.5 s at the small one:
 * the cost per pixel RISES, because the whole-frame accumulators no longer fit
 * on the card and every tile's contribution crosses the bus. The budget below
 * uses the pessimistic end with headroom, so the timeout tracks the work
 * instead of a number chosen when frames were smaller.
 *
 * A flat cap still applies. Past it the honest answer is that the frame is too
 * large for this deployment, and holding a connection open for an hour to
 * discover that helps nobody.
 */
const MS_PER_MEGAPIXEL = 4_000;
const MIN_SEGMENTATION_TIMEOUT_MS = 300_000; // the previous flat value
const MAX_SEGMENTATION_TIMEOUT_MS = 45 * 60_000;

export function segmentationTimeoutMs(
  width?: number | null,
  height?: number | null
): number {
  // Dimensions are not always recorded (an upload that failed part-way, an
  // older row). Falling back to the previous flat value is right: it is what
  // every frame got before this existed.
  if (!width || !height || width <= 0 || height <= 0) {
    return MIN_SEGMENTATION_TIMEOUT_MS;
  }
  const megapixels = (width * height) / 1_000_000;
  return Math.min(
    MAX_SEGMENTATION_TIMEOUT_MS,
    Math.max(MIN_SEGMENTATION_TIMEOUT_MS, Math.ceil(megapixels * MS_PER_MEGAPIXEL))
  );
}
