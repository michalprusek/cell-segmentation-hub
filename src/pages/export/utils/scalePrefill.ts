/**
 * The number the export dialog's pixel-size field starts with.
 *
 * Since 2026-10-14 Olympus cellSens stills carry their own pixel size, so a
 * project can hold images at different scales — the sperm lab's 4104 px JPEGs
 * are 0.08625 µm/px and its 2052 px TIFFs 0.1725, the same field at half the
 * resolution. "The first calibrated image" is then an arbitrary pick, and
 * whatever the field holds is sent as though the user had typed it:
 *
 * - the SPERM report converts every image by its own scale on the server and
 *   uses this value only for images that have none. Prefilling another image's
 *   scale would silently convert those by a number that was never theirs, so
 *   only the project's value is offered;
 * - every OTHER report converts with this one value. An image scale is offered
 *   only when every calibrated image agrees on it; when they disagree no single
 *   number is right, and the field falls back to the project's value — what it
 *   showed before stills were calibrated.
 */
const SAME_SCALE_REL_TOL = 1e-6;

const usable = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v > 0;

export function resolveScalePrefill(input: {
  projectType?: string | null;
  images: ReadonlyArray<{ pixelSizeUm?: number | null }>;
  projectPixelSizeUm?: number | null;
}): number | undefined {
  const project = usable(input.projectPixelSizeUm)
    ? input.projectPixelSizeUm
    : undefined;
  if (input.projectType === 'sperm') {
    return project;
  }
  const scales = input.images.map(i => i.pixelSizeUm).filter(usable);
  if (scales.length === 0) {
    return project;
  }
  const first = scales[0];
  const allAgree = scales.every(
    s => Math.abs(s - first) <= SAME_SCALE_REL_TOL * Math.max(s, first)
  );
  return allAgree ? first : project;
}
