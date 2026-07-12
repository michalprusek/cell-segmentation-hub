/**
 * Tests for MetricsCalculator paths NOT exercised by the existing
 * metricsCalculator.test.ts (which focuses on scale conversion with a mocked
 * Python API).
 *
 * This file specifically covers:
 *   - calculateBasicMetrics (the offline fallback used when the Python endpoint
 *     is unavailable). It is private but is exercised via calculateImageMetrics
 *     when the mocked HTTP post rejects.
 *   - calculateAllImageMetrics — area aggregation (Shoelace, no network),
 *     disintegration-index fallback to 'none' when images lack dimensions,
 *     and polygon JSON parse failures.
 *   - _emptyImageMetrics sentinel values (exercised via calculateAllImageMetrics
 *     when an image has no segmentation).
 *
 * All geometric expectations use shapes with hand-computable ground truth:
 *   unit square    (1×1): area=1, perimeter=4
 *   10×10 square:         area=100, perimeter=40
 *   right triangle (3-4-5 legs at origin): area=6, perimeter=12
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mocked } from 'vitest';
import { MetricsCalculator, ImageWithSegmentation } from '../metricsCalculator';

// ── ExcelJS mock ──────────────────────────────────────────────────────────────
const mockWorksheet = {
  columns: [] as Array<{ header?: string; key?: string; width?: number }>,
  addRow: vi.fn(),
  getRow: vi.fn(() => ({ font: undefined, fill: undefined })),
};
const mockAddWorksheet = vi.fn(() => mockWorksheet);
const mockWriteFile = vi.fn().mockResolvedValue(undefined);

vi.mock('exceljs', () => ({
  default: {
    Workbook: function MockWorkbook(this: object) {
      return {
        addWorksheet: mockAddWorksheet,
        xlsx: { writeFile: mockWriteFile },
      };
    },
  },
}));

// ── fs/promises mock ──────────────────────────────────────────────────────────
vi.mock('fs/promises', () => {
  const noop = vi.fn().mockResolvedValue(undefined);
  const api = {
    mkdir: noop,
    readFile: noop,
    writeFile: noop,
    unlink: noop,
    access: noop,
    stat: noop,
  };
  return { default: api, ...api };
});

// ── axios mock ────────────────────────────────────────────────────────────────
// We control `postMock` per-test so we can test both success and rejection.
const postMock = vi.fn();

vi.mock('axios', () => ({
  default: { create: vi.fn(() => ({ post: postMock })) },
  create: vi.fn(() => ({ post: postMock })),
}));

// ── logger mock ───────────────────────────────────────────────────────────────
vi.mock('../../../utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// ── config mock (prevents process.exit) ──────────────────────────────────────
vi.mock('../../../utils/config', () => ({
  config: {
    SEGMENTATION_SERVICE_URL: 'http://ml-service:8000',
  },
}));

// ── helpers ───────────────────────────────────────────────────────────────────

/** Returns CCW-ordered unit square vertices. Area = side². */
const square = (side: number, ox = 0, oy = 0) => [
  { x: ox, y: oy },
  { x: ox + side, y: oy },
  { x: ox + side, y: oy + side },
  { x: ox, y: oy + side },
];

/** External polygon wrapper understood by calculateImageMetrics. */
const extPolygon = (pts: { x: number; y: number }[]) => ({
  type: 'external' as const,
  points: pts,
});

/** Internal (hole) polygon wrapper. */
const intPolygon = (pts: { x: number; y: number }[]) => ({
  type: 'internal' as const,
  points: pts,
});

/** Build a minimal ImageWithSegmentation. */
const buildImage = (
  id: string,
  polygons: unknown[],
  dims?: { width: number; height: number }
): ImageWithSegmentation => ({
  id,
  name: `img-${id}.png`,
  width: dims?.width,
  height: dims?.height,
  segmentation: {
    polygons: JSON.stringify(polygons),
    model: 'test',
    threshold: 0.5,
  },
});

// ── suite ─────────────────────────────────────────────────────────────────────

describe('MetricsCalculator — calculateBasicMetrics (fallback path)', () => {
  let calc: MetricsCalculator;

  beforeEach(() => {
    vi.clearAllMocks();
    calc = new MetricsCalculator();
    // Make the Python endpoint always reject so the code falls back to
    // calculateBasicMetrics for every polygon.
    postMock.mockRejectedValue(new Error('ML service unavailable'));
  });

  it('computes correct area for a 10×10 square', async () => {
    const image = buildImage('sq10', [extPolygon(square(10))]);
    const metrics = await calc.calculateImageMetrics(
      [extPolygon(square(10))] as Parameters<
        typeof calc.calculateImageMetrics
      >[0],
      'sq10',
      'test.png'
    );

    expect(metrics).toHaveLength(1);
    // Shoelace area of a 10×10 square = 100
    expect(metrics[0]!.area).toBeCloseTo(100, 5);
  });

  it('computes correct perimeter for a 10×10 square', async () => {
    const metrics = await calc.calculateImageMetrics(
      [extPolygon(square(10))],
      'sq10',
      'test.png'
    );
    // Perimeter = 4 × 10 = 40
    expect(metrics[0]!.perimeter).toBeCloseTo(40, 5);
  });

  it('computes circularity in (0, 1] for a square', async () => {
    const metrics = await calc.calculateImageMetrics(
      [extPolygon(square(10))],
      'sq10',
      'test.png'
    );
    // circularity = 4π·A / P² = 4π·100/1600 ≈ 0.785
    const c = metrics[0]!.circularity;
    expect(c).toBeGreaterThan(0.78);
    expect(c).toBeLessThanOrEqual(1.0);
  });

  it('computes compactness as reciprocal-ish of circularity for a square', async () => {
    const metrics = await calc.calculateImageMetrics(
      [extPolygon(square(10))],
      'sq10',
      'test.png'
    );
    const m = metrics[0]!;
    // compactness = P²/(4πA) ≈ 1 / circularity (for non-zero area)
    expect(m.compactness).toBeCloseTo(1 / m.circularity, 1);
  });

  it('computes equivalentDiameter = sqrt(4A/π) for a 10×10 square', async () => {
    const metrics = await calc.calculateImageMetrics(
      [extPolygon(square(10))],
      'sq10',
      'test.png'
    );
    const expected = Math.sqrt((4 * 100) / Math.PI); // ≈ 11.28
    expect(metrics[0]!.equivalentDiameter).toBeCloseTo(expected, 3);
  });

  it('computes feretDiameterMax = diagonal of square = side * sqrt(2)', async () => {
    const metrics = await calc.calculateImageMetrics(
      [extPolygon(square(10))],
      'sq10',
      'test.png'
    );
    // Diagonal of 10×10 = 10√2 ≈ 14.142
    expect(metrics[0]!.feretDiameterMax).toBeCloseTo(10 * Math.SQRT2, 2);
  });

  it('computes feretDiameterMin = side of square = 10', async () => {
    const metrics = await calc.calculateImageMetrics(
      [extPolygon(square(10))],
      'sq10',
      'test.png'
    );
    expect(metrics[0]!.feretDiameterMin).toBeCloseTo(10, 1);
  });

  it('computes feretAspectRatio = max/min ≈ √2 for a square', async () => {
    const metrics = await calc.calculateImageMetrics(
      [extPolygon(square(10))],
      'sq10',
      'test.png'
    );
    expect(metrics[0]!.feretAspectRatio).toBeCloseTo(Math.SQRT2, 1);
  });

  it('computes convexity ≈ 1 for a convex shape (square)', async () => {
    // convexity = convex-hull perimeter / polygon perimeter; for a square they are equal
    const metrics = await calc.calculateImageMetrics(
      [extPolygon(square(10))],
      'sq10',
      'test.png'
    );
    expect(metrics[0]!.convexity).toBeCloseTo(1, 2);
  });

  it('computes solidity = 1 for a convex shape (square)', async () => {
    // solidity = polygon area / convex hull area; equal for a convex polygon
    const metrics = await calc.calculateImageMetrics(
      [extPolygon(square(10))],
      'sq10',
      'test.png'
    );
    expect(metrics[0]!.solidity).toBeCloseTo(1, 2);
  });

  it('computes sphericity = circularity * 0.8', async () => {
    const metrics = await calc.calculateImageMetrics(
      [extPolygon(square(10))],
      'sq10',
      'test.png'
    );
    const m = metrics[0]!;
    expect(m.sphericity).toBeCloseTo(m.circularity * 0.8, 5);
  });

  it('computes correct bounding box for a 10×20 rectangle', async () => {
    const rect = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 20 },
      { x: 0, y: 20 },
    ];
    const metrics = await calc.calculateImageMetrics(
      [extPolygon(rect)],
      'rect',
      'test.png'
    );
    expect(metrics[0]!.boundingBoxWidth).toBeCloseTo(10, 5);
    expect(metrics[0]!.boundingBoxHeight).toBeCloseTo(20, 5);
  });

  it('computes extent = area / (bBox.w × bBox.h) = 1 for a square', async () => {
    const metrics = await calc.calculateImageMetrics(
      [extPolygon(square(10))],
      'sq10',
      'test.png'
    );
    expect(metrics[0]!.extent).toBeCloseTo(1, 5);
  });

  it('subtracts hole area from the reported area', async () => {
    // 10×10 outer square (area 100) containing a 4×4 hole (area 16) centred inside
    const outer = square(10, 0, 0);
    const hole = square(4, 3, 3); // placed inside the outer square
    const metrics = await calc.calculateImageMetrics(
      [extPolygon(outer), intPolygon(hole)],
      'with-hole',
      'test.png'
    );
    // Only one external polygon entry is created; hole is subtracted
    expect(metrics).toHaveLength(1);
    // area ≈ 100 - 16 = 84
    expect(metrics[0]!.area).toBeCloseTo(84, 1);
  });

  it('adds hole perimeter to perimeterWithHoles', async () => {
    const outer = square(10, 0, 0); // perimeter 40
    const hole = square(4, 3, 3); // perimeter 16
    const metrics = await calc.calculateImageMetrics(
      [extPolygon(outer), intPolygon(hole)],
      'with-hole',
      'test.png'
    );
    // perimeterWithHoles = 40 (outer) + 16 (hole) = 56
    expect(metrics[0]!.perimeterWithHoles).toBeCloseTo(56, 1);
  });

  it('skips degenerate polygons with fewer than 3 points', async () => {
    const degenerate = {
      type: 'external' as const,
      points: [
        { x: 0, y: 0 },
        { x: 1, y: 1 },
      ],
    };
    const metrics = await calc.calculateImageMetrics(
      [degenerate as Parameters<typeof calc.calculateImageMetrics>[0][0]],
      'degen',
      'test.png'
    );
    // No metrics produced for a 2-point polygon
    expect(metrics).toHaveLength(0);
  });

  it('returns empty array when no external polygons provided', async () => {
    // Internal-only — no externals
    const metrics = await calc.calculateImageMetrics(
      [
        intPolygon(square(5)) as unknown as Parameters<
          typeof calc.calculateImageMetrics
        >[0][0],
      ],
      'no-ext',
      'test.png'
    );
    expect(metrics).toHaveLength(0);
  });

  it('returns empty array for empty polygon list', async () => {
    const metrics = await calc.calculateImageMetrics([], 'empty', 'test.png');
    expect(metrics).toHaveLength(0);
  });

  it('assigns incremental polygonId starting at 1', async () => {
    const metrics = await calc.calculateImageMetrics(
      [extPolygon(square(10)), extPolygon(square(5, 20, 20))],
      'two-polys',
      'test.png'
    );
    expect(metrics).toHaveLength(2);
    expect(metrics[0]!.polygonId).toBe(1);
    expect(metrics[1]!.polygonId).toBe(2);
  });

  it('sets type="external" on every returned metric', async () => {
    const metrics = await calc.calculateImageMetrics(
      [extPolygon(square(10))],
      'sq10',
      'test.png'
    );
    expect(metrics[0]!.type).toBe('external');
  });
});

// ── calculateAllImageMetrics ──────────────────────────────────────────────────

describe('MetricsCalculator — calculateAllImageMetrics', () => {
  let calc: MetricsCalculator;

  beforeEach(() => {
    vi.clearAllMocks();
    calc = new MetricsCalculator();
    // Default: make the DI endpoint succeed; individual tests can override.
    postMock.mockResolvedValue({
      data: { di: 0.3, w1: 1.5, reference: 'core', n_pixels: 50000 },
    });
  });

  it('returns empty-sentinel row for image with no segmentation', async () => {
    const image: ImageWithSegmentation = {
      id: 'no-seg',
      name: 'blank.png',
      // no segmentation field
    };
    const result = await calc.calculateAllImageMetrics([image]);
    expect(result).toHaveLength(1);
    const row = result[0]!;
    expect(row.imageId).toBe('no-seg');
    expect(row.polygonCount).toBe(0);
    expect(row.disintegrationIndex).toBe(0);
    expect(row.referenceMode).toBe('none');
    expect(row.totalSpheroidArea).toBe(0);
    expect(row.coreArea).toBe(0);
    expect(row.invasionArea).toBe(0);
  });

  it('returns referenceMode="failed" for malformed polygon JSON', async () => {
    const image: ImageWithSegmentation = {
      id: 'bad-json',
      name: 'bad.png',
      segmentation: { polygons: '{not valid json', model: 'x', threshold: 0.5 },
    };
    const result = await calc.calculateAllImageMetrics([image]);
    expect(result[0]!.referenceMode).toBe('failed');
  });

  it('computes totalSpheroidArea via Shoelace for external non-core polygon', async () => {
    // 10×10 external polygon → area = 100 px²; no core, no scale
    const image = buildImage('a1', [extPolygon(square(10))]);
    const result = await calc.calculateAllImageMetrics([image]);
    // No core → DI short-circuits to 'no_core' (no ML call); area still comes
    // from the local Shoelace computation.
    expect(result[0]!.totalSpheroidArea).toBeCloseTo(100, 3);
  });

  it('excludes core polygons from totalSpheroidArea', async () => {
    // One 10×10 external spheroid + one 4×4 external core (partClass='core')
    // totalSpheroidArea should count only the non-core external
    const corePoly = {
      type: 'external' as const,
      partClass: 'core' as const,
      points: square(4),
    };
    const image = buildImage('a2', [extPolygon(square(10)), corePoly]);
    const result = await calc.calculateAllImageMetrics([image]);
    // Only the 10×10 (area=100) contributes to totalSpheroidArea
    expect(result[0]!.totalSpheroidArea).toBeCloseTo(100, 3);
    // Core area = 4×4 = 16
    expect(result[0]!.coreArea).toBeCloseTo(16, 3);
  });

  it('invasion area = totalSpheroidArea - coreArea (clamped at 0)', async () => {
    const corePoly = {
      type: 'external' as const,
      partClass: 'core' as const,
      points: square(4),
    };
    const image = buildImage('a3', [extPolygon(square(10)), corePoly]);
    const result = await calc.calculateAllImageMetrics([image]);
    // invasionArea = 100 - 16 = 84
    expect(result[0]!.invasionArea).toBeCloseTo(84, 3);
  });

  it('applies pixelToMicrometerScale² to area fields', async () => {
    const image = buildImage('a4', [extPolygon(square(10))]);
    const scale = 2; // 2 µm/px → 1 px² = 4 µm²
    const result = await calc.calculateAllImageMetrics([image], scale);
    // 100 px² * 4 = 400 µm²
    expect(result[0]!.totalSpheroidArea).toBeCloseTo(400, 3);
  });

  it('referenceMode="none" when image has only an internal polygon (no usable externals)', async () => {
    const image = buildImage('a5', [intPolygon(square(5))]);
    const result = await calc.calculateAllImageMetrics([image]);
    // No external polygons → usableExternals empty → DI not attempted → 'none'
    expect(result[0]!.referenceMode).toBe('none');
    expect(result[0]!.disintegrationIndex).toBe(0);
  });

  it('referenceMode="none" when image has external polygon + core but missing dimensions', async () => {
    // A core is present (so the no_core short-circuit does not fire), but the
    // image has no width/height → DI endpoint is skipped and referenceMode
    // stays at its initialised 'none'.
    const corePoly = {
      type: 'external' as const,
      partClass: 'core' as const,
      points: square(4),
    };
    const image = buildImage('a6', [extPolygon(square(10)), corePoly]);
    // No dims passed → width/height are undefined
    const result = await calc.calculateAllImageMetrics([image]);
    expect(result[0]!.referenceMode).toBe('none');
  });

  it('referenceMode="no_core" when externals are present but no core polygon', async () => {
    // DI is core-anchored; without a core it is undefined → N/A, and no ML
    // call is issued (the short-circuit fires before the network path).
    const image = buildImage('a6b', [extPolygon(square(10))], {
      width: 100,
      height: 100,
    });
    const result = await calc.calculateAllImageMetrics([image]);
    expect(result[0]!.referenceMode).toBe('no_core');
    expect(result[0]!.disintegrationIndex).toBe(0);
    expect(postMock).not.toHaveBeenCalled();
    // Areas are still reported.
    expect(result[0]!.totalSpheroidArea).toBeCloseTo(100, 3);
  });

  it('referenceMode="failed" when DI HTTP call rejects', async () => {
    postMock.mockRejectedValue(new Error('Network error'));
    // A core is required for the ML call to be issued at all.
    const corePoly = {
      type: 'external' as const,
      partClass: 'core' as const,
      points: square(4),
    };
    const image = buildImage('a7', [extPolygon(square(10)), corePoly], {
      width: 100,
      height: 100,
    });
    const result = await calc.calculateAllImageMetrics([image]);
    // DI failed but area should still be computed
    expect(result[0]!.referenceMode).toBe('failed');
    expect(result[0]!.totalSpheroidArea).toBeCloseTo(100, 3);
  });

  it('propagates DI values from successful ML response', async () => {
    postMock.mockResolvedValue({
      data: { di: 0.42, w1: 2.1, reference: 'core', n_pixels: 12345 },
    });
    const corePoly = {
      type: 'external' as const,
      partClass: 'core' as const,
      points: square(4),
    };
    const image = buildImage('a8', [extPolygon(square(10)), corePoly], {
      width: 100,
      height: 100,
    });
    const result = await calc.calculateAllImageMetrics([image]);
    expect(result[0]!.disintegrationIndex).toBeCloseTo(0.42, 5);
    expect(result[0]!.wassersteinW1).toBeCloseTo(2.1, 5);
    expect(result[0]!.referenceMode).toBe('core');
    expect(result[0]!.nPixels).toBe(12345);
  });

  it('polygonCount counts all closed polygons (external + internal)', async () => {
    const image = buildImage('a9', [
      extPolygon(square(10)),
      intPolygon(square(3, 2, 2)),
      extPolygon(square(5, 15, 15)),
    ]);
    const result = await calc.calculateAllImageMetrics([image]);
    // 3 closed polygons total (1 internal + 2 external)
    expect(result[0]!.polygonCount).toBe(3);
  });

  it('polyline polygons are excluded from polygonCount (geometry=polyline)', async () => {
    const polyline = {
      geometry: 'polyline' as const,
      type: 'external' as const,
      points: [
        { x: 0, y: 0 },
        { x: 5, y: 0 },
      ],
    };
    const image = buildImage('a10', [extPolygon(square(10)), polyline]);
    const result = await calc.calculateAllImageMetrics([image]);
    // Only the closed polygon counts
    expect(result[0]!.polygonCount).toBe(1);
  });

  it('processes multiple images independently', async () => {
    const img1 = buildImage('b1', [extPolygon(square(10))]);
    const img2 = buildImage('b2', [extPolygon(square(20))]);
    const result = await calc.calculateAllImageMetrics([img1, img2]);
    expect(result).toHaveLength(2);
    expect(result[0]!.imageId).toBe('b1');
    expect(result[1]!.imageId).toBe('b2');
    // Areas independent
    expect(result[0]!.totalSpheroidArea).toBeCloseTo(100, 3);
    expect(result[1]!.totalSpheroidArea).toBeCloseTo(400, 3);
  });
});

// ── escapeHtml + sanitizeUrl (pure utils, no config dep) ─────────────────────

describe('escapeHtml', () => {
  // Import inside the describe block to ensure no config side-effects
  let escapeHtml: (s: string) => string;
  let sanitizeUrl: (s: string) => string;

  beforeEach(async () => {
    const mod = await import('../../../utils/escapeHtml');
    escapeHtml = mod.escapeHtml;
    sanitizeUrl = mod.sanitizeUrl;
  });

  it('escapes & to &amp;', () => {
    expect(escapeHtml('a & b')).toBe('a &amp; b');
  });

  it('escapes < and > to &lt; &gt;', () => {
    expect(escapeHtml('<script>')).toBe('&lt;script&gt;');
  });

  it('escapes " to &quot;', () => {
    expect(escapeHtml('"quoted"')).toBe('&quot;quoted&quot;');
  });

  it("escapes ' to &#39;", () => {
    expect(escapeHtml("it's")).toBe('it&#39;s');
  });

  it('escapes / to &#x2F;', () => {
    expect(escapeHtml('a/b')).toBe('a&#x2F;b');
  });

  it('escapes all special chars in one string', () => {
    expect(escapeHtml('<b>"Hello"</b> & it\'s/fine')).toBe(
      '&lt;b&gt;&quot;Hello&quot;&lt;&#x2F;b&gt; &amp; it&#39;s&#x2F;fine'
    );
  });

  it('returns empty string for falsy input', () => {
    expect(escapeHtml('')).toBe('');
    expect(escapeHtml(null as unknown as string)).toBe('');
    expect(escapeHtml(undefined as unknown as string)).toBe('');
  });

  it('leaves safe text unchanged', () => {
    expect(escapeHtml('Hello world 123')).toBe('Hello world 123');
  });

  describe('sanitizeUrl', () => {
    it('returns empty string for falsy input', () => {
      expect(sanitizeUrl('')).toBe('');
      expect(sanitizeUrl(null as unknown as string)).toBe('');
    });

    it('returns empty string for non-http protocols', () => {
      expect(sanitizeUrl('javascript:alert(1)')).toBe('');
      expect(sanitizeUrl('ftp://example.com')).toBe('');
      expect(sanitizeUrl('data:text/html,<h1>')).toBe('');
    });

    it('returns normalised http URL', () => {
      expect(sanitizeUrl('http://example.com/path')).toBe(
        'http://example.com/path'
      );
    });

    it('returns normalised https URL', () => {
      expect(sanitizeUrl('https://example.com?q=1')).toBe(
        'https://example.com/?q=1'
      );
    });

    it('returns empty string for invalid URL', () => {
      expect(sanitizeUrl('not a url')).toBe('');
      expect(sanitizeUrl('://bad')).toBe('');
    });
  });
});

// ── getBaseUrl (pure env inspection) ─────────────────────────────────────────

describe('getBaseUrl', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Reset env after each test
    Object.assign(process.env, originalEnv);
    delete process.env.API_BASE_URL;
    delete process.env.BACKEND_URL;
    delete process.env.PUBLIC_URL;
  });

  it('returns API_BASE_URL when set', async () => {
    process.env.API_BASE_URL = 'https://api.example.com';
    const { getBaseUrl } = await import('../../../utils/getBaseUrl');
    expect(getBaseUrl()).toBe('https://api.example.com');
  });

  it('falls back to BACKEND_URL when API_BASE_URL is absent', async () => {
    delete process.env.API_BASE_URL;
    process.env.BACKEND_URL = 'https://backend.example.com';
    const { getBaseUrl } = await import('../../../utils/getBaseUrl');
    expect(getBaseUrl()).toBe('https://backend.example.com');
  });

  it('falls back to PUBLIC_URL when both higher-priority vars are absent', async () => {
    delete process.env.API_BASE_URL;
    delete process.env.BACKEND_URL;
    process.env.PUBLIC_URL = 'https://public.example.com';
    const { getBaseUrl } = await import('../../../utils/getBaseUrl');
    expect(getBaseUrl()).toBe('https://public.example.com');
  });

  it('returns localhost default in non-production when no env var set', async () => {
    delete process.env.API_BASE_URL;
    delete process.env.BACKEND_URL;
    delete process.env.PUBLIC_URL;
    process.env.NODE_ENV = 'test';
    const { getBaseUrl } = await import('../../../utils/getBaseUrl');
    expect(getBaseUrl()).toBe('http://localhost:3001');
  });

  it('returns empty string in production when no env var set', async () => {
    delete process.env.API_BASE_URL;
    delete process.env.BACKEND_URL;
    delete process.env.PUBLIC_URL;
    process.env.NODE_ENV = 'production';
    const { getBaseUrl } = await import('../../../utils/getBaseUrl');
    expect(getBaseUrl()).toBe('');
  });
});
