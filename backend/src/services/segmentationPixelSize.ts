/**
 * The pixel size a segmentation request carries to the ML service.
 *
 * Only `spheroid_disintegration` reads one: it resamples the frame to the
 * 1.28 µm/px it was validated at before inference
 * (`backend/segmentation/api/disintegration_scale.py`), and its `/segment`
 * route answers 400 when any other model is sent `pixel_size_um`, so the
 * field must never be appended for another model.
 *
 * Kept free of Prisma and the HTTP client so the rule can be tested alone.
 */

/** Models whose `/segment` reads `pixel_size_um`. Mirrors
 *  `PIXEL_SIZE_MODELS` in `backend/segmentation/api/routes.py`. */
export const MODELS_READING_PIXEL_SIZE: ReadonlySet<string> = new Set([
  'spheroid_disintegration',
]);

export function modelReadsPixelSize(model: string): boolean {
  return MODELS_READING_PIXEL_SIZE.has(model);
}

const isUsable = (v: number | null | undefined): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v > 0;

/**
 * The pixel size of the image being segmented, in µm/px, or null when none is
 * known.
 *
 * Precedence: a video frame's CONTAINER (where a frame's calibration lives,
 * as the image listing and the export resolve it), then the image row's own
 * value (an Olympus cellSens JPEG or TIFF fills it at upload since
 * 2026-10-14), then the project's. The first USABLE value wins — finite and
 * > 0 — rather than the first non-null one, so a malformed stored value falls
 * through instead of being sent and refused.
 */
export function resolveSegmentationPixelSizeUm(sources: {
  container?: number | null;
  image?: number | null;
  project?: number | null;
}): number | null {
  for (const v of [sources.container, sources.image, sources.project]) {
    if (isUsable(v)) {
      return v;
    }
  }
  return null;
}

/**
 * The value of the `pixel_size_um` form field for this request, or null when
 * the field must not be sent: a model that does not read it, or no usable
 * pixel size.
 */
export function pixelSizeFormValue(
  model: string,
  pixelSizeUm: number | null | undefined
): string | null {
  if (!modelReadsPixelSize(model) || !isUsable(pixelSizeUm)) {
    return null;
  }
  return String(pixelSizeUm);
}
