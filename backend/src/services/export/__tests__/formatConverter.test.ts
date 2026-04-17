import { describe, it, expect, jest, beforeEach } from '@jest/globals';

jest.mock('../../../utils/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

import {
  FormatConverter,
  type ImageData,
  type Polygon,
} from '../formatConverter';
import { logger } from '../../../utils/logger';

const mockedLogger = logger as jest.Mocked<typeof logger>;

beforeEach(() => {
  mockedLogger.warn.mockClear();
  mockedLogger.error.mockClear();
});

const closedPolygon: Polygon = {
  id: 'p1',
  type: 'external',
  points: [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
  ],
};

const spermHead: Polygon = {
  id: 'pl-head',
  type: 'external',
  geometry: 'polyline',
  partClass: 'head',
  instanceId: 'sperm_1',
  points: [
    { x: 0, y: 0 },
    { x: 3, y: 0 },
  ],
};

const spermMidpiece: Polygon = {
  id: 'pl-mid',
  type: 'external',
  geometry: 'polyline',
  partClass: 'midpiece',
  instanceId: 'sperm_1',
  points: [
    { x: 3, y: 0 },
    { x: 3, y: 4 },
  ],
};

const spermTail: Polygon = {
  id: 'pl-tail',
  type: 'external',
  geometry: 'polyline',
  partClass: 'tail',
  instanceId: 'sperm_1',
  points: [
    { x: 3, y: 4 },
    { x: 3, y: 9 },
  ],
};

const buildImageData = (
  polygons: Polygon[],
  overrides: Partial<ImageData> = {}
): ImageData => ({
  id: 'img1',
  filename: 'image1.png',
  width: 100,
  height: 100,
  segmentationResults: [
    {
      polygons: JSON.stringify(polygons),
      cellCount: 0,
      timestamp: new Date('2026-04-17T00:00:00Z'),
    },
  ],
  ...overrides,
});

describe('FormatConverter', () => {
  describe('convertToCOCO', () => {
    it('emits only the cell category for polygon-only projects', async () => {
      const converter = new FormatConverter();
      const data = buildImageData([closedPolygon]);

      const coco = await converter.convertToCOCO([data]);

      expect(coco.categories).toEqual([
        expect.objectContaining({ id: 1, name: 'cell' }),
      ]);
      expect(coco.categories.find(c => c.name === 'sperm')).toBeUndefined();
    });

    it('adds sperm category when polylines are present', async () => {
      const converter = new FormatConverter();
      const data = buildImageData([closedPolygon, spermHead]);

      const coco = await converter.convertToCOCO([data]);

      expect(coco.categories).toEqual([
        expect.objectContaining({ id: 1, name: 'cell' }),
        expect.objectContaining({ id: 2, name: 'sperm' }),
      ]);
    });

    it('writes closed polygons under category 1 with exact area', async () => {
      const converter = new FormatConverter();
      const data = buildImageData([closedPolygon]);

      const coco = await converter.convertToCOCO([data]);

      expect(coco.annotations).toHaveLength(1);
      const ann = coco.annotations[0];
      expect(ann.category_id).toBe(1);
      expect(ann.attributes?.geometry).toBe('polygon');
      expect(ann.area).toBe(100);
    });

    it('writes polylines under category 2 with exact length and partClass+instanceId', async () => {
      const converter = new FormatConverter();
      const data = buildImageData([
        closedPolygon,
        spermHead,
        spermMidpiece,
        spermTail,
      ]);

      const coco = await converter.convertToCOCO([data]);

      const polylineAnns = coco.annotations.filter(a => a.category_id === 2);
      expect(polylineAnns).toHaveLength(3);

      const partClasses = polylineAnns
        .map(a => a.attributes?.partClass)
        .sort();
      expect(partClasses).toEqual(['head', 'midpiece', 'tail']);

      const expectedLengths: Record<string, number> = {
        head: 3,
        midpiece: 4,
        tail: 5,
      };
      for (const ann of polylineAnns) {
        expect(ann.attributes?.geometry).toBe('polyline');
        expect(ann.attributes?.instanceId).toBe('sperm_1');
        expect(ann.area).toBe(0);
        const part = ann.attributes?.partClass as keyof typeof expectedLengths;
        expect(ann.attributes?.length).toBeCloseTo(expectedLengths[part]);
      }
    });

    it('skips polylines with missing partClass and warns once with sample imageIds', async () => {
      const converter = new FormatConverter();
      const orphan: Polygon = {
        ...spermHead,
        id: 'orphan-no-part',
        partClass: undefined,
      };
      const data = buildImageData([closedPolygon, orphan]);

      const coco = await converter.convertToCOCO([data]);

      const spermAnns = coco.annotations.filter(a => a.category_id === 2);
      expect(spermAnns).toHaveLength(0);
      expect(coco.categories.find(c => c.name === 'sperm')).toBeUndefined();
      expect(mockedLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('missing or invalid partClass'),
        'FormatConverter',
        expect.objectContaining({
          totalSkipped: 1,
          sampleImageIds: ['img1'],
          expected: ['head', 'midpiece', 'tail'],
        })
      );
    });

    it('rejects polylines whose partClass is outside the whitelist', async () => {
      const converter = new FormatConverter();
      const typo: Polygon = {
        ...spermHead,
        partClass: 'flagellum' as never,
      };
      const data = buildImageData([typo]);

      const coco = await converter.convertToCOCO([data]);

      expect(coco.annotations.filter(a => a.category_id === 2)).toHaveLength(0);
      expect(mockedLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('missing or invalid partClass'),
        'FormatConverter',
        expect.objectContaining({ totalSkipped: 1 })
      );
    });

    it('keeps annotation IDs unique across multiple images', async () => {
      const converter = new FormatConverter();
      const data1 = buildImageData([closedPolygon, spermHead], {
        id: 'img1',
        filename: 'a.png',
      });
      const data2 = buildImageData([closedPolygon, spermMidpiece], {
        id: 'img2',
        filename: 'b.png',
      });

      const coco = await converter.convertToCOCO([data1, data2]);

      const ids = coco.annotations.map(a => a.id);
      expect(new Set(ids).size).toBe(ids.length);
      expect(coco.annotations.length).toBe(4);
    });
  });

  describe('convertToYOLO', () => {
    it('returns { content, warnings } with warning when polylines present', async () => {
      const converter = new FormatConverter();
      const polygonsJson = JSON.stringify([
        closedPolygon,
        spermHead,
        spermMidpiece,
        spermTail,
      ]);

      const result = await converter.convertToYOLO(polygonsJson, 100, 100);
      const lines = result.content
        .split('\n')
        .filter(l => l && !l.startsWith('#'));

      expect(lines).toHaveLength(1);
      expect(lines[0]).toMatch(/^0 /);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toContain(
        'YOLO format does not support open polylines'
      );
      expect(result.warnings[0]).toContain('skipped 3');
    });

    it('returns empty warnings array when no polylines present', async () => {
      const converter = new FormatConverter();
      const polygonsJson = JSON.stringify([closedPolygon]);

      const result = await converter.convertToYOLO(polygonsJson, 100, 100);

      expect(result.warnings).toEqual([]);
      expect(mockedLogger.warn).not.toHaveBeenCalled();
    });

    it('produces empty content but warns for pure-polyline input', async () => {
      const converter = new FormatConverter();
      const polygonsJson = JSON.stringify([spermHead, spermMidpiece]);

      const result = await converter.convertToYOLO(polygonsJson, 100, 100);

      expect(result.content).toBe('');
      expect(result.warnings).toHaveLength(1);
    });

    it('throws on malformed JSON', async () => {
      const converter = new FormatConverter();

      await expect(
        converter.convertToYOLO('not-json', 100, 100)
      ).rejects.toThrow(/Invalid polygon data format/);
    });
  });

  describe('convertToJSON', () => {
    it('keeps polygon-only output backward compatible (no polylines field)', async () => {
      const converter = new FormatConverter();
      const data = buildImageData([closedPolygon]);

      const out = await converter.convertToJSON([data]);
      const seg = out.images[0]?.segmentation;

      expect(seg?.polygons.external).toHaveLength(1);
      expect(seg?.polylines).toBeUndefined();
      expect(seg?.spermInstances).toBeUndefined();
      expect(seg?.statistics.totalPolylines).toBeUndefined();
      expect(seg?.statistics.orphanPolylineCount).toBeUndefined();
    });

    it('emits polylines and spermInstances with exact lengths', async () => {
      const converter = new FormatConverter();
      const data = buildImageData([
        closedPolygon,
        spermHead,
        spermMidpiece,
        spermTail,
      ]);

      const out = await converter.convertToJSON([data]);
      const seg = out.images[0]?.segmentation;

      expect(seg?.polygons.external).toHaveLength(1);
      expect(seg?.polylines).toHaveLength(3);
      expect(seg?.spermInstances).toHaveLength(1);

      const inst = seg?.spermInstances?.[0];
      expect(inst?.instanceId).toBe('sperm_1');
      expect(inst?.parts.head?.length).toBeCloseTo(3);
      expect(inst?.parts.midpiece?.length).toBeCloseTo(4);
      expect(inst?.parts.tail?.length).toBeCloseTo(5);
      expect(inst?.totalLength).toBeCloseTo(12);

      expect(seg?.statistics.totalPolylines).toBe(3);
      expect(seg?.statistics.totalSpermInstances).toBe(1);
      expect(seg?.statistics.orphanPolylineCount).toBeUndefined();
    });

    it('logs orphan polylines and reports orphanPolylineCount in statistics', async () => {
      const converter = new FormatConverter();
      const orphan: Polygon = {
        ...spermHead,
        id: 'orphan',
        instanceId: undefined,
      };
      const data = buildImageData([orphan]);

      const out = await converter.convertToJSON([data]);
      const seg = out.images[0]?.segmentation;

      expect(seg?.polylines).toHaveLength(1);
      expect(seg?.spermInstances).toBeUndefined();
      expect(seg?.statistics.orphanPolylineCount).toBe(1);
      expect(mockedLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('without instanceId'),
        'FormatConverter',
        expect.objectContaining({
          totalOrphans: 1,
          sampleImageIds: ['img1'],
        })
      );
    });

    it('handles a pure-polyline image with no closed polygons', async () => {
      const converter = new FormatConverter();
      const data = buildImageData([spermHead, spermMidpiece, spermTail]);

      const out = await converter.convertToJSON([data]);
      const seg = out.images[0]?.segmentation;

      expect(seg?.polygons.external).toHaveLength(0);
      expect(seg?.polygons.internal).toHaveLength(0);
      expect(seg?.polylines).toHaveLength(3);
      expect(seg?.spermInstances).toHaveLength(1);
      expect(seg?.statistics.totalArea).toBe(0);
    });

    it('skips invalid partClass in polylinesData but keeps the polyline entry', async () => {
      const converter = new FormatConverter();
      const typo: Polygon = {
        ...spermHead,
        partClass: 'midpeice' as never,
      };
      const data = buildImageData([typo]);

      const out = await converter.convertToJSON([data]);
      const polylines = out.images[0]?.segmentation?.polylines;

      expect(polylines).toHaveLength(1);
      expect(polylines?.[0]?.partClass).toBeUndefined();
    });

  });

  describe('annotation ID stability', () => {
    it('keeps IDs unique within a single image with mixed polygons and polylines', async () => {
      const data = buildImageData([
        closedPolygon,
        spermHead,
        spermMidpiece,
        spermTail,
      ]);

      const coco = await new FormatConverter().convertToCOCO([data]);
      const ids = coco.annotations.map(a => a.id);
      expect(new Set(ids).size).toBe(ids.length);
      expect(ids).toEqual([1, 2, 3, 4]);
    });
  });
});
