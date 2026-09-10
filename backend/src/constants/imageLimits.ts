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
