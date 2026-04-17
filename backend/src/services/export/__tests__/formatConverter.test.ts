import { describe, it, expect, jest } from '@jest/globals';

jest.mock('../../../utils/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

import { FormatConverter, type ImageData, type Polygon } from '../formatConverter';
import { logger } from '../../../utils/logger';

const mockedLogger = logger as jest.Mocked<typeof logger>;

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

const buildImageData = (polygons: Polygon[]): ImageData => ({
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
});

describe('FormatConverter', () => {
  describe('convertToCOCO', () => {
    it('emits a separate sperm category alongside cell', async () => {
      const converter = new FormatConverter();
      const data = buildImageData([closedPolygon]);

      const coco = await converter.convertToCOCO([data]);

      expect(coco.categories).toEqual([
        expect.objectContaining({ id: 1, name: 'cell' }),
        expect.objectContaining({ id: 2, name: 'sperm' }),
      ]);
    });

    it('writes closed polygons under category 1 with geometry=polygon', async () => {
      const converter = new FormatConverter();
      const data = buildImageData([closedPolygon]);

      const coco = await converter.convertToCOCO([data]);

      expect(coco.annotations).toHaveLength(1);
      const ann = coco.annotations[0];
      expect(ann.category_id).toBe(1);
      expect(ann.attributes?.geometry).toBe('polygon');
      expect(ann.area).toBeGreaterThan(0);
    });

    it('writes polylines under category 2 with partClass+instanceId in attributes', async () => {
      const converter = new FormatConverter();
      const data = buildImageData([closedPolygon, spermHead, spermMidpiece, spermTail]);

      const coco = await converter.convertToCOCO([data]);

      const polylineAnns = coco.annotations.filter(a => a.category_id === 2);
      expect(polylineAnns).toHaveLength(3);

      const partClasses = polylineAnns
        .map(a => a.attributes?.partClass)
        .sort();
      expect(partClasses).toEqual(['head', 'midpiece', 'tail']);

      for (const ann of polylineAnns) {
        expect(ann.attributes?.geometry).toBe('polyline');
        expect(ann.attributes?.instanceId).toBe('sperm_1');
        expect(ann.attributes?.length).toBeGreaterThan(0);
        expect(ann.area).toBe(0);
      }
    });

    it('produces stable annotation IDs (no collision between polygons and polylines)', async () => {
      const converter = new FormatConverter();
      const data = buildImageData([closedPolygon, spermHead, spermMidpiece, spermTail]);

      const coco = await converter.convertToCOCO([data]);

      const ids = coco.annotations.map(a => a.id);
      expect(new Set(ids).size).toBe(ids.length);
    });
  });

  describe('convertToYOLO', () => {
    it('skips polylines with a warning log', async () => {
      const converter = new FormatConverter();
      const polygonsJson = JSON.stringify([
        closedPolygon,
        spermHead,
        spermMidpiece,
        spermTail,
      ]);

      const yolo = await converter.convertToYOLO(polygonsJson, 100, 100);
      const lines = yolo.split('\n').filter(l => l && !l.startsWith('#'));

      expect(lines).toHaveLength(1);
      expect(lines[0]).toMatch(/^0 /);
      expect(mockedLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('YOLO format does not support open polylines'),
        'FormatConverter',
        expect.objectContaining({ polylineCount: 3 })
      );
    });

    it('does not warn when there are no polylines', async () => {
      mockedLogger.warn.mockClear();
      const converter = new FormatConverter();
      const polygonsJson = JSON.stringify([closedPolygon]);

      await converter.convertToYOLO(polygonsJson, 100, 100);

      expect(mockedLogger.warn).not.toHaveBeenCalled();
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
    });

    it('emits polylines and spermInstances when polylines exist', async () => {
      const converter = new FormatConverter();
      const data = buildImageData([closedPolygon, spermHead, spermMidpiece, spermTail]);

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
    });

    it('orphan polylines (no instanceId) are exported but not grouped', async () => {
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
    });
  });
});
