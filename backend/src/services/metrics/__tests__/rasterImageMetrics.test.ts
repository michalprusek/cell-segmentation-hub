import { describe, it, expect } from 'vitest';
import { createHash } from 'crypto';
import {
  exportScaleWarning,
  pixelSizeWarning,
  readStoredImageMetrics,
  resampleNote,
  serialiseImageMetricsForStorage,
  sha256OfPolygons,
} from '../rasterImageMetrics';

const polygons = JSON.stringify([{ id: 'p1', points: [{ x: 1, y: 2 }] }]);
const metrics = { reference: 'core', DI: 0.5, index_B: 0.4 };

describe('rasterImageMetrics', () => {
  it('hashes the exact polygons string', () => {
    expect(sha256OfPolygons(polygons)).toBe(
      createHash('sha256').update(polygons, 'utf8').digest('hex')
    );
  });

  it('stores nothing for a model without a raster read-out', () => {
    expect(serialiseImageMetricsForStorage(undefined, polygons)).toBeNull();
    expect(serialiseImageMetricsForStorage(null, polygons)).toBeNull();
  });

  it('round-trips while the polygons are unchanged', () => {
    const stored = serialiseImageMetricsForStorage(metrics, polygons);
    const { metrics: m, reason } = readStoredImageMetrics(stored, polygons);
    expect(reason).toBe('');
    expect(m?.DI).toBe(0.5);
    expect(m?.polygons_sha256).toBe(sha256OfPolygons(polygons));
  });

  it('refuses a read-out once any byte of the polygons changed', () => {
    const stored = serialiseImageMetricsForStorage(metrics, polygons);
    const edited = polygons.replace('"x":1', '"x":2');
    const r = readStoredImageMetrics(stored, edited);
    expect(r.metrics).toBeNull();
    expect(r.reason).toBe('polygons edited since segmentation');
    // scored at the uploaded scale: the stale read-out has no resample block
    expect(r.staleResample).toBeNull();
  });

  it("hands back a stale read-out's resample block, and only a stale one's", () => {
    const resample = {
      input_um_per_px: 1.6,
      model_um_per_px: 1.28,
      factor: 1.25,
      model_w: 2560,
      model_h: 2560,
    };
    const stored = serialiseImageMetricsForStorage({ ...metrics, resample }, polygons);
    const edited = polygons.replace('"x":1', '"x":2');
    expect(readStoredImageMetrics(stored, edited).staleResample).toEqual(resample);
    // a current read-out is used as it is, not as a fallback grid
    expect(readStoredImageMetrics(stored, polygons).staleResample).toBeUndefined();
    // nothing stored, or nothing complete: no grid is known
    expect(readStoredImageMetrics(null, edited).staleResample).toBeUndefined();
    expect(readStoredImageMetrics('{"DI":0.3}', edited).staleResample).toBeUndefined();
    // a malformed block is not a grid either
    const bad = serialiseImageMetricsForStorage(
      { ...metrics, resample: { ...resample, input_um_per_px: 'x' } },
      polygons
    );
    expect(readStoredImageMetrics(bad, edited).staleResample).toBeNull();
  });

  it('refuses unreadable or incomplete JSON', () => {
    expect(readStoredImageMetrics('{oops', polygons).metrics).toBeNull();
    expect(readStoredImageMetrics('{"DI":0.3}', polygons).reason).toBe(
      'stored raster read-out incomplete'
    );
    expect(readStoredImageMetrics(null, polygons).reason).toBe(
      'no raster read-out stored'
    );
  });

  it('warns on a pixel size more than 10 % from 1.28 um/px only', () => {
    expect(pixelSizeWarning(undefined)).toBeNull();
    expect(pixelSizeWarning(0)).toBeNull();
    expect(pixelSizeWarning(1.28)).toBeNull();
    expect(pixelSizeWarning(1.28 * 1.09)).toBeNull();
    expect(pixelSizeWarning(1.28 * 0.91)).toBeNull();
    expect(pixelSizeWarning(0.65)).toContain('pixel size is 0.65 um/px');
    expect(pixelSizeWarning(2.56)).toContain('~1.28 um/px');
  });

  describe('exportScaleWarning', () => {
    const resample = {
      input_um_per_px: 1.6,
      model_um_per_px: 1.28,
      factor: 1.25,
      model_w: 2560,
      model_h: 2560,
    };

    it('is the plain pixel-size warning for a read-out that was not resampled', () => {
      for (const s of [undefined, 1.28, 1.6, 0.3]) {
        expect(exportScaleWarning(s, {})).toBe(pixelSizeWarning(s));
        expect(exportScaleWarning(s, { resample: null })).toBe(pixelSizeWarning(s));
      }
    });

    it('is silent for a resampled read-out exported at its own pixel size, or with none', () => {
      expect(exportScaleWarning(undefined, { resample })).toBeNull();
      expect(exportScaleWarning(1.6, { resample })).toBeNull();
      expect(exportScaleWarning(1.6 * 1.09, { resample })).toBeNull();
      expect(exportScaleWarning(1.6 * 0.91, { resample })).toBeNull();
    });

    it('names both pixel sizes when the export disagrees with the resample', () => {
      const w = exportScaleWarning(3.0, { resample });
      expect(w).toContain('pixel size is 3 um/px at export');
      expect(w).toContain('resampled from 1.6 um/px at segmentation');
      expect(w).toContain('~2.4 um/px'); // 1.28 * 3.0 / 1.6
      // a scale that happens to be 1.28 is no excuse: the frame is 1.28, not 1.6
      expect(exportScaleWarning(1.28, { resample })).toContain('~1.02 um/px');
    });

    it('leaves a declined pixel size to the read-out own warning', () => {
      const skipped = { input_um_per_px: 3.0, model_um_per_px: 1.28, factor: 2.34375 };
      expect(exportScaleWarning(3.0, { resample_skipped: skipped })).toBeNull();
      // a DIFFERENT scale at export is a different claim, and is warned
      expect(exportScaleWarning(1.6, { resample_skipped: skipped })).toBe(
        pixelSizeWarning(1.6)
      );
      expect(exportScaleWarning(undefined, { resample_skipped: skipped })).toBeNull();
    });
  });

  it('notes a resample only when the read-out carries one', () => {
    expect(resampleNote(undefined)).toBe('');
    expect(resampleNote(null)).toBe('');
    expect(
      resampleNote({
        input_um_per_px: 0.9,
        model_um_per_px: 1.28,
        factor: 0.703125,
        model_w: 1440,
        model_h: 1440,
      })
    ).toBe(
      'scored at 1.28 um/px: resampled from 0.9 um/px (x0.7031, 1440x1440 px)'
    );
  });
});
