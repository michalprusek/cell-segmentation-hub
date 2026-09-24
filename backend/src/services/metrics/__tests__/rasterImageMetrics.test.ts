import { describe, it, expect } from 'vitest';
import { createHash } from 'crypto';
import {
  pixelSizeWarning,
  readStoredImageMetrics,
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
});
