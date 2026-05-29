/**
 * Behavioral tests for cocoConverter.ts
 *
 * The module converts an internal SegmentationResult (imageSrc + polygons)
 * to COCO JSON format.  All behaviour tested here is exercised through the
 * public `convertToCOCO` function — no mocking of geometry helpers needed
 * because they are pure math and their results are observable in the output.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { convertToCOCO } from '../cocoConverter';
import type { Polygon } from '@/lib/segmentation';

// ---------------------------------------------------------------------------
// Minimal SegmentationResult shape accepted by convertToCOCO.
// The real type is `SegmentationResult` from `@/lib/segmentation` (which
// re-exports it from `@/types`).  We cast to `any` to avoid coupling tests
// to the type import path, which has drifted in the codebase.
// ---------------------------------------------------------------------------

const makeSegmentation = (
  polygons: Polygon[],
  imageSrc?: string
): Parameters<typeof convertToCOCO>[0] =>
  ({ polygons, imageSrc }) as Parameters<typeof convertToCOCO>[0];

// Simple unit square — vertices go counter-clockwise
const UNIT_SQUARE: Polygon = {
  id: 'p1',
  type: 'external',
  geometry: 'polygon',
  points: [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
  ],
};

// Small hole (internal polygon) that sits inside UNIT_SQUARE
const INNER_SQUARE: Polygon = {
  id: 'p2',
  type: 'internal',
  geometry: 'polygon',
  points: [
    { x: 2, y: 2 },
    { x: 4, y: 2 },
    { x: 4, y: 4 },
    { x: 2, y: 4 },
  ],
};

// Internal polygon that is OUTSIDE UNIT_SQUARE — must not be attached
const OUTER_INTERNAL: Polygon = {
  id: 'p3',
  type: 'internal',
  geometry: 'polygon',
  points: [
    { x: 100, y: 100 },
    { x: 102, y: 100 },
    { x: 102, y: 102 },
    { x: 100, y: 102 },
  ],
};

// Valid sperm polyline (partClass = 'head')
const SPERM_HEAD: Polygon = {
  id: 'sp1',
  type: 'external',
  geometry: 'polyline',
  partClass: 'head',
  instanceId: 'sperm_1',
  points: [
    { x: 5, y: 5 },
    { x: 15, y: 5 },
    { x: 15, y: 15 },
  ],
};

// Invalid sperm polyline (partClass = 'core' — not a sperm part)
const INVALID_POLYLINE: Polygon = {
  id: 'sp2',
  type: 'external',
  geometry: 'polyline',
  partClass: 'core',
  points: [
    { x: 1, y: 1 },
    { x: 2, y: 2 },
  ],
};

// Polyline without partClass — also invalid for sperm
const POLYLINE_NO_CLASS: Polygon = {
  id: 'sp3',
  type: 'external',
  geometry: 'polyline',
  points: [
    { x: 0, y: 0 },
    { x: 5, y: 5 },
  ],
};

const parse = (json: string) => JSON.parse(json);

// ---------------------------------------------------------------------------
describe('convertToCOCO', () => {
  // ---- Top-level JSON structure -------------------------------------------

  describe('output structure', () => {
    it('returns valid JSON string', () => {
      const result = convertToCOCO(makeSegmentation([]));
      expect(() => JSON.parse(result)).not.toThrow();
    });

    it('always contains info, images, annotations, categories keys', () => {
      const coco = parse(convertToCOCO(makeSegmentation([])));
      expect(coco).toHaveProperty('info');
      expect(coco).toHaveProperty('images');
      expect(coco).toHaveProperty('annotations');
      expect(coco).toHaveProperty('categories');
    });

    it('info contains description, version, year', () => {
      const { info } = parse(convertToCOCO(makeSegmentation([])));
      expect(info.description).toBe('Spheroid segmentation dataset');
      expect(info.version).toBe('1.0');
      expect(info.year).toBe(new Date().getFullYear());
      expect(typeof info.date_created).toBe('string');
    });

    it('images array always has exactly one entry with id=1', () => {
      const { images } = parse(convertToCOCO(makeSegmentation([])));
      expect(images).toHaveLength(1);
      expect(images[0].id).toBe(1);
      expect(images[0].width).toBe(800);
      expect(images[0].height).toBe(600);
    });
  });

  // ---- imageSrc → file_name extraction ------------------------------------

  describe('file_name extraction from imageSrc', () => {
    it('extracts filename from path with slashes', () => {
      const { images } = parse(
        convertToCOCO(makeSegmentation([], '/projects/abc/images/photo.png'))
      );
      expect(images[0].file_name).toBe('photo.png');
    });

    it('falls back to "image.png" when imageSrc is undefined', () => {
      const { images } = parse(convertToCOCO(makeSegmentation([])));
      expect(images[0].file_name).toBe('image.png');
    });

    it('falls back to "image.png" when imageSrc is empty string', () => {
      const { images } = parse(convertToCOCO(makeSegmentation([], '')));
      expect(images[0].file_name).toBe('image.png');
    });
  });

  // ---- Empty input --------------------------------------------------------

  describe('empty polygon list', () => {
    it('produces no annotations', () => {
      const { annotations } = parse(convertToCOCO(makeSegmentation([])));
      expect(annotations).toHaveLength(0);
    });

    it('produces only the spheroid category (no sperm category)', () => {
      const { categories } = parse(convertToCOCO(makeSegmentation([])));
      expect(categories).toHaveLength(1);
      expect(categories[0]).toMatchObject({
        id: 1,
        name: 'spheroid',
        supercategory: 'cell',
      });
    });
  });

  // ---- External (closed) polygon annotation -------------------------------

  describe('external polygon annotation', () => {
    let coco: ReturnType<typeof parse>;

    beforeEach(() => {
      coco = parse(convertToCOCO(makeSegmentation([UNIT_SQUARE])));
    });

    it('creates exactly one annotation', () => {
      expect(coco.annotations).toHaveLength(1);
    });

    it('assigns sequential id starting at 1', () => {
      expect(coco.annotations[0].id).toBe(1);
    });

    it('uses image_id=1 and category_id=1', () => {
      const ann = coco.annotations[0];
      expect(ann.image_id).toBe(1);
      expect(ann.category_id).toBe(1);
    });

    it('iscrowd is 0', () => {
      expect(coco.annotations[0].iscrowd).toBe(0);
    });

    it('segmentation is array of one flat-point array', () => {
      const { segmentation } = coco.annotations[0];
      expect(Array.isArray(segmentation)).toBe(true);
      expect(segmentation).toHaveLength(1);
      // 4 points × 2 coords = 8 numbers
      expect(segmentation[0]).toHaveLength(8);
    });

    it('flattened segmentation matches input points', () => {
      const flat = coco.annotations[0].segmentation[0];
      // UNIT_SQUARE: (0,0),(10,0),(10,10),(0,10)
      expect(flat).toEqual([0, 0, 10, 0, 10, 10, 0, 10]);
    });

    it('bbox is [minX, minY, width, height]', () => {
      const { bbox } = coco.annotations[0];
      expect(bbox).toEqual([0, 0, 10, 10]);
    });

    it('area is a positive number', () => {
      expect(coco.annotations[0].area).toBeGreaterThan(0);
    });

    it('attributes.type is "external" and geometry is "polygon"', () => {
      const { attributes } = coco.annotations[0];
      expect(attributes.type).toBe('external');
      expect(attributes.geometry).toBe('polygon');
    });

    it('attributes.has_holes is false when no holes', () => {
      expect(coco.annotations[0].attributes.has_holes).toBe(false);
    });
  });

  // ---- Internal polygon (hole) attachment ---------------------------------

  describe('hole attachment', () => {
    it('attaches inner polygon as second segmentation array when inside outer', () => {
      const coco = parse(
        convertToCOCO(makeSegmentation([UNIT_SQUARE, INNER_SQUARE]))
      );
      // Still one annotation for the external polygon
      expect(coco.annotations).toHaveLength(1);
      const { segmentation } = coco.annotations[0];
      // External + 1 hole → 2 entries
      expect(segmentation).toHaveLength(2);
      // Hole points: (2,2),(4,2),(4,4),(2,4) → [2,2,4,2,4,4,2,4]
      expect(segmentation[1]).toEqual([2, 2, 4, 2, 4, 4, 2, 4]);
    });

    it('sets attributes.has_holes to true when hole is present', () => {
      const coco = parse(
        convertToCOCO(makeSegmentation([UNIT_SQUARE, INNER_SQUARE]))
      );
      expect(coco.annotations[0].attributes.has_holes).toBe(true);
    });

    it('does not attach internal polygon that lies outside the external polygon', () => {
      const coco = parse(
        convertToCOCO(makeSegmentation([UNIT_SQUARE, OUTER_INTERNAL]))
      );
      // Outer internal is not a hole of UNIT_SQUARE
      const { segmentation } = coco.annotations[0];
      expect(segmentation).toHaveLength(1);
      expect(coco.annotations[0].attributes.has_holes).toBe(false);
    });

    it('standalone internal polygon (no parent external) creates no annotation', () => {
      // No external polygon — internal should be silently dropped
      const coco = parse(convertToCOCO(makeSegmentation([INNER_SQUARE])));
      expect(coco.annotations).toHaveLength(0);
    });
  });

  // ---- Annotation ID sequencing -------------------------------------------

  describe('annotation id sequencing', () => {
    it('assigns incrementing ids for multiple external polygons', () => {
      const second: Polygon = {
        ...UNIT_SQUARE,
        id: 'p_second',
        points: [
          { x: 20, y: 20 },
          { x: 30, y: 20 },
          { x: 30, y: 30 },
          { x: 20, y: 30 },
        ],
      };
      const coco = parse(
        convertToCOCO(makeSegmentation([UNIT_SQUARE, second]))
      );
      expect(coco.annotations[0].id).toBe(1);
      expect(coco.annotations[1].id).toBe(2);
    });

    it('sperm annotations continue the id sequence after polygon annotations', () => {
      const coco = parse(
        convertToCOCO(makeSegmentation([UNIT_SQUARE, SPERM_HEAD]))
      );
      // polygon = id 1, sperm polyline = id 2
      expect(coco.annotations[0].id).toBe(1);
      expect(coco.annotations[1].id).toBe(2);
    });
  });

  // ---- Sperm polyline annotations -----------------------------------------

  describe('sperm polyline annotation', () => {
    let coco: ReturnType<typeof parse>;

    beforeEach(() => {
      coco = parse(convertToCOCO(makeSegmentation([SPERM_HEAD])));
    });

    it('creates one annotation for a valid sperm polyline', () => {
      expect(coco.annotations).toHaveLength(1);
    });

    it('uses category_id=2 for sperm', () => {
      expect(coco.annotations[0].category_id).toBe(2);
    });

    it('area is 0 for polylines', () => {
      expect(coco.annotations[0].area).toBe(0);
    });

    it('segmentation contains flattened points', () => {
      const flat = coco.annotations[0].segmentation[0];
      // (5,5),(15,5),(15,15) → [5,5,15,5,15,15]
      expect(flat).toEqual([5, 5, 15, 5, 15, 15]);
    });

    it('attributes include partClass and geometry=polyline', () => {
      const { attributes } = coco.annotations[0];
      expect(attributes.geometry).toBe('polyline');
      expect(attributes.partClass).toBe('head');
    });

    it('attributes include instanceId when set', () => {
      expect(coco.annotations[0].attributes.instanceId).toBe('sperm_1');
    });

    it('attributes include non-zero length', () => {
      expect(coco.annotations[0].attributes.length).toBeGreaterThan(0);
    });

    it('bbox reflects polyline bounding box [minX, minY, w, h]', () => {
      const { bbox } = coco.annotations[0];
      // Points: (5,5),(15,5),(15,15) → minX=5, minY=5, w=10, h=10
      expect(bbox).toEqual([5, 5, 10, 10]);
    });
  });

  // ---- Category list ------------------------------------------------------

  describe('categories', () => {
    it('only spheroid category when no valid polylines', () => {
      const { categories } = parse(
        convertToCOCO(makeSegmentation([UNIT_SQUARE]))
      );
      expect(categories).toHaveLength(1);
      expect(categories[0].name).toBe('spheroid');
    });

    it('adds sperm category when at least one valid sperm polyline exists', () => {
      const { categories } = parse(
        convertToCOCO(makeSegmentation([SPERM_HEAD]))
      );
      expect(categories).toHaveLength(2);
      expect(categories[1]).toMatchObject({
        id: 2,
        name: 'sperm',
        supercategory: 'biological',
      });
    });

    it('does not add sperm category for invalid partClass polylines', () => {
      const { categories } = parse(
        convertToCOCO(makeSegmentation([INVALID_POLYLINE]))
      );
      expect(categories).toHaveLength(1);
    });

    it('does not add sperm category for polylines without partClass', () => {
      const { categories } = parse(
        convertToCOCO(makeSegmentation([POLYLINE_NO_CLASS]))
      );
      expect(categories).toHaveLength(1);
    });
  });

  // ---- Filtering: invalid partClass polylines are silently excluded --------

  describe('polyline filtering', () => {
    it('excludes polylines with non-sperm partClass from annotations', () => {
      const { annotations } = parse(
        convertToCOCO(makeSegmentation([INVALID_POLYLINE]))
      );
      expect(annotations).toHaveLength(0);
    });

    it('excludes polylines without partClass from annotations', () => {
      const { annotations } = parse(
        convertToCOCO(makeSegmentation([POLYLINE_NO_CLASS]))
      );
      expect(annotations).toHaveLength(0);
    });

    it('includes all three sperm part classes: head, midpiece, tail', () => {
      const mkPolyline = (
        partClass: 'head' | 'midpiece' | 'tail'
      ): Polygon => ({
        id: partClass,
        type: 'external',
        geometry: 'polyline',
        partClass,
        points: [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
        ],
      });

      for (const cls of ['head', 'midpiece', 'tail'] as const) {
        const { annotations } = parse(
          convertToCOCO(makeSegmentation([mkPolyline(cls)]))
        );
        expect(annotations).toHaveLength(1);
        expect(annotations[0].attributes.partClass).toBe(cls);
      }
    });
  });

  // ---- Mixed polygons + polylines -----------------------------------------

  describe('mixed input', () => {
    it('produces annotations for both external polygons and valid polylines', () => {
      const coco = parse(
        convertToCOCO(makeSegmentation([UNIT_SQUARE, SPERM_HEAD]))
      );
      expect(coco.annotations).toHaveLength(2);
      // First is the polygon (category 1), second is the polyline (category 2)
      expect(coco.annotations[0].category_id).toBe(1);
      expect(coco.annotations[1].category_id).toBe(2);
    });
  });

  // ---- Polyline without instanceId ----------------------------------------

  describe('polyline without instanceId', () => {
    it('omits instanceId key from attributes when not present', () => {
      const noInstance: Polygon = {
        id: 'sp_noinst',
        type: 'external',
        geometry: 'polyline',
        partClass: 'tail',
        points: [
          { x: 0, y: 0 },
          { x: 5, y: 5 },
        ],
      };
      const { annotations } = parse(
        convertToCOCO(makeSegmentation([noInstance]))
      );
      expect(annotations[0].attributes).not.toHaveProperty('instanceId');
    });
  });
});
