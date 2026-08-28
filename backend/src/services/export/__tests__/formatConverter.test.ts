import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../utils/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { readFileSync } from 'fs';
import path from 'path';

import {
  FormatConverter,
  buildYoloClassMap,
  buildYoloClassesFile,
  buildYoloDataYaml,
  type ImageData,
  type Polygon,
  type YOLOConversionResult,
} from '../formatConverter';
import { logger } from '../../../utils/logger';

const mockedLogger = logger as Mocked<typeof logger>;

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

      const { data: coco } = await converter.convertToCOCO([data], 'sperm');

      expect(coco.categories).toEqual([
        expect.objectContaining({ id: 1, name: 'cell' }),
      ]);
      expect(coco.categories.find(c => c.name === 'sperm')).toBeUndefined();
    });

    it('adds sperm category when polylines are present', async () => {
      const converter = new FormatConverter();
      const data = buildImageData([closedPolygon, spermHead]);

      const { data: coco } = await converter.convertToCOCO([data], 'sperm');

      expect(coco.categories).toEqual([
        expect.objectContaining({ id: 1, name: 'cell' }),
        expect.objectContaining({ id: 2, name: 'sperm' }),
      ]);
    });

    it('writes closed polygons under category 1 with exact area', async () => {
      const converter = new FormatConverter();
      const data = buildImageData([closedPolygon]);

      const { data: coco } = await converter.convertToCOCO([data], 'sperm');

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

      const { data: coco } = await converter.convertToCOCO([data], 'sperm');

      const polylineAnns = coco.annotations.filter(a => a.category_id === 2);
      expect(polylineAnns).toHaveLength(3);

      const partClasses = polylineAnns.map(a => a.attributes?.partClass).sort();
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

      const { data: coco } = await converter.convertToCOCO([data], 'sperm');

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

      const { data: coco } = await converter.convertToCOCO([data], 'sperm');

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

      const { data: coco } = await converter.convertToCOCO([data1, data2], 'sperm');

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

      const { data: out } = await converter.convertToJSON([data], 'sperm');
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

      const { data: out } = await converter.convertToJSON([data], 'sperm');
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

      const { data: out } = await converter.convertToJSON([data], 'sperm');
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

    it('keeps multiple sperm instances separate within one image', async () => {
      const converter = new FormatConverter();
      const sperm1Head = { ...spermHead, instanceId: 'sperm_1', id: 's1h' };
      const sperm1Tail = { ...spermTail, instanceId: 'sperm_1', id: 's1t' };
      const sperm2Head = { ...spermHead, instanceId: 'sperm_2', id: 's2h' };
      const sperm2Mid = {
        ...spermMidpiece,
        instanceId: 'sperm_2',
        id: 's2m',
      };
      const data = buildImageData([
        sperm1Head,
        sperm2Head,
        sperm1Tail,
        sperm2Mid,
      ]);

      const { data: out } = await converter.convertToJSON([data], 'sperm');
      const seg = out.images[0]?.segmentation;

      expect(seg?.spermInstances).toHaveLength(2);
      const s1 = seg?.spermInstances?.find(s => s.instanceId === 'sperm_1');
      const s2 = seg?.spermInstances?.find(s => s.instanceId === 'sperm_2');
      expect(s1?.parts.head).toBeDefined();
      expect(s1?.parts.tail).toBeDefined();
      expect(s1?.parts.midpiece).toBeUndefined();
      expect(s2?.parts.head).toBeDefined();
      expect(s2?.parts.midpiece).toBeDefined();
      expect(s2?.parts.tail).toBeUndefined();
    });

    it('handles a pure-polyline image with no closed polygons', async () => {
      const converter = new FormatConverter();
      const data = buildImageData([spermHead, spermMidpiece, spermTail]);

      const { data: out } = await converter.convertToJSON([data], 'sperm');
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

      const { data: out } = await converter.convertToJSON([data], 'sperm');
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

      const { data: coco } = await new FormatConverter().convertToCOCO([data], 'sperm');
      const ids = coco.annotations.map(a => a.id);
      expect(new Set(ids).size).toBe(ids.length);
      expect(ids).toEqual([1, 2, 3, 4]);
    });
  });

  describe('missing image dimensions', () => {
    // Regression: Sharp can fail to extract metadata on upload (BMP, unusual
    // variants), leaving Image.width/height NULL. The export used to silently
    // emit COCO/JSON headers of 800x600 while polygons were already in the
    // real PIL coordinate space — producing annotations that lie about the
    // canvas size and extend outside the declared bounding box.
    const largePolygon: Polygon = {
      id: 'p-big',
      type: 'external',
      points: [
        { x: 0, y: 0 },
        { x: 1286, y: 0 },
        { x: 1286, y: 1293 },
        { x: 0, y: 1293 },
      ],
    };

    it('COCO infers header dimensions from polygon extents when width/height are 0', async () => {
      const data = buildImageData([largePolygon], { width: 0, height: 0 });

      const { data: coco } = await new FormatConverter().convertToCOCO([data], 'sperm');

      expect(coco.images).toHaveLength(1);
      expect(coco.images[0].width).toBeGreaterThanOrEqual(1286);
      expect(coco.images[0].height).toBeGreaterThanOrEqual(1293);
      expect(coco.images[0].width).not.toBe(800);
      expect(coco.images[0].height).not.toBe(600);
      expect(mockedLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('missing width/height'),
        'FormatConverter'
      );
    });

    it('JSON infers header dimensions from polygon extents when width/height are 0', async () => {
      const data = buildImageData([largePolygon], { width: 0, height: 0 });

      const { data: json } = await new FormatConverter().convertToJSON([data], 'sperm');

      expect(json.images[0].dimensions.width).toBeGreaterThanOrEqual(1286);
      expect(json.images[0].dimensions.height).toBeGreaterThanOrEqual(1293);
      expect(json.images[0].dimensions.width).not.toBe(800);
      expect(json.images[0].dimensions.height).not.toBe(600);
    });

    it('uses provided width/height verbatim when present', async () => {
      const data = buildImageData([closedPolygon], {
        width: 2048,
        height: 1536,
      });

      const { data: coco } = await new FormatConverter().convertToCOCO([data], 'sperm');

      expect(coco.images[0].width).toBe(2048);
      expect(coco.images[0].height).toBe(1536);
    });

    it('preserves a known axis when only the other is missing', async () => {
      const data = buildImageData([largePolygon], { width: 1286, height: 0 });

      const { data: coco } = await new FormatConverter().convertToCOCO([data], 'sperm');

      // Known width is kept verbatim; only height is inferred from extents.
      expect(coco.images[0].width).toBe(1286);
      expect(coco.images[0].height).toBeGreaterThanOrEqual(1293);
    });

    it('logs error (not warn) when no polygons and dims are missing', async () => {
      const data = buildImageData([], { width: 0, height: 0 });

      const { data: coco } = await new FormatConverter().convertToCOCO([data], 'sperm');

      expect(coco.images[0].width).toBe(0);
      expect(coco.images[0].height).toBe(0);
      expect(mockedLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('no usable'),
        expect.any(Error),
        'FormatConverter'
      );
      expect(mockedLogger.warn).not.toHaveBeenCalledWith(
        expect.stringContaining('inferred'),
        'FormatConverter'
      );
    });

    it('RLE mask path uses inferred dimensions when dims are missing', async () => {
      // External square 0..100 with an internal hole 20..40 → triggers the
      // createBinaryMask/encodeMaskToRLE path which previously received the
      // hardcoded 800x600 mask buffer.
      const external: Polygon = {
        id: 'ext',
        type: 'external',
        points: [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
          { x: 100, y: 100 },
          { x: 0, y: 100 },
        ],
      };
      const hole: Polygon = {
        id: 'hole',
        type: 'internal',
        points: [
          { x: 20, y: 20 },
          { x: 40, y: 20 },
          { x: 40, y: 40 },
          { x: 20, y: 40 },
        ],
      };
      const data = buildImageData([external, hole], { width: 0, height: 0 });

      const { data: coco } = await new FormatConverter().convertToCOCO([data], 'sperm');

      const ann = coco.annotations[0];
      expect(ann.iscrowd).toBe(1);
      const rle = ann.segmentation as { size: [number, number] };
      // RLE size = [height, width]; inferred from extents ~ 101x101.
      expect(rle.size[0]).toBe(coco.images[0].height);
      expect(rle.size[1]).toBe(coco.images[0].width);
      expect(rle.size[0]).toBeGreaterThanOrEqual(101);
      expect(rle.size[1]).toBeGreaterThanOrEqual(101);
    });
  });
});

// A polyline is a generic primitive — the converter must NOT assume sperm for a
// microtubule (or any non-sperm) project. These lock the project-type-driven
// category + the absence of sperm-only fields.
describe('FormatConverter — neuron classes (neurite / soma)', () => {
  const neurite: Polygon = {
    ...closedPolygon,
    id: 'poly-neurite',
    partClass: 'neurite',
  };
  const soma: Polygon = { ...closedPolygon, id: 'poly-soma', partClass: 'soma' };

  it('gives each neuron class its own COCO category, not the generic cell', async () => {
    // A standard COCO reader takes `category_id` as THE class. Folding both
    // classes into `cell` would present a two-class dataset as one class.
    const { data: coco } = await new FormatConverter().convertToCOCO(
      [buildImageData([neurite, soma])],
      'neurite'
    );
    const byId = Object.fromEntries(coco.categories.map(c => [c.id, c.name]));
    expect(byId[3]).toBe('neurite');
    expect(byId[4]).toBe('soma');
    expect(coco.annotations.map(a => a.category_id).sort()).toEqual([3, 4]);
  });

  it('also carries the class as an attribute (CVAT surfaces attributes)', async () => {
    const { data: coco } = await new FormatConverter().convertToCOCO(
      [buildImageData([neurite])],
      'neurite'
    );
    expect(coco.annotations[0].attributes?.partClass).toBe('neurite');
  });

  it('lists only the classes actually present', async () => {
    const { data: coco } = await new FormatConverter().convertToCOCO(
      [buildImageData([neurite])],
      'neurite'
    );
    expect(coco.categories.map(c => c.name)).toEqual(['cell', 'neurite']);
  });

  it('leaves a class-free project byte-identical (no stray categories)', async () => {
    const { data: coco } = await new FormatConverter().convertToCOCO(
      [buildImageData([closedPolygon])],
      'spheroid'
    );
    expect(coco.categories.map(c => c.name)).toEqual(['cell']);
    expect(coco.annotations[0].category_id).toBe(1);
    expect(coco.annotations[0].attributes?.partClass).toBeUndefined();
  });

  it('exposes the class in the JSON export too', async () => {
    const { data } = await new FormatConverter().convertToJSON(
      [buildImageData([neurite, soma])],
      'neurite'
    );
    const external = data.images[0].segmentation!.polygons.external;
    expect(external.map(e => e.partClass)).toEqual(['neurite', 'soma']);
  });
});

describe('FormatConverter — non-sperm (generic/microtubule) polylines', () => {
  const mtPolyline: Polygon = {
    id: 'pl-mt',
    type: 'external',
    geometry: 'polyline',
    // No partClass — microtubule polylines never carry head/midpiece/tail.
    instanceId: 'mt_abc12345',
    points: [
      { x: 0, y: 0 },
      { x: 5, y: 0 },
      { x: 5, y: 6 },
    ],
  };

  it('COCO: emits MT polylines under a "microtubule" category with no partClass', async () => {
    const data = buildImageData([closedPolygon, mtPolyline]);
    const { data: coco } = await new FormatConverter().convertToCOCO(
      [data],
      'microtubules'
    );

    const polylineAnns = coco.annotations.filter(a => a.category_id === 2);
    expect(polylineAnns).toHaveLength(1);
    expect(polylineAnns[0].attributes?.partClass).toBeUndefined();
    expect(polylineAnns[0].attributes?.instanceId).toBe('mt_abc12345');
    expect(coco.categories.find(c => c.id === 2)?.name).toBe('microtubule');
    expect(coco.categories.find(c => c.name === 'sperm')).toBeUndefined();
  });

  it('COCO: a non-sperm/non-MT project labels the polyline category "polyline"', async () => {
    const data = buildImageData([mtPolyline]);
    const { data: coco } = await new FormatConverter().convertToCOCO(
      [data],
      'spheroid'
    );
    expect(coco.categories.find(c => c.id === 2)?.name).toBe('polyline');
  });

  it('JSON: MT polylines are emitted flat, never grouped as spermInstances', async () => {
    const data = buildImageData([mtPolyline]);
    const { data: out } = await new FormatConverter().convertToJSON(
      [data],
      'microtubules'
    );
    const seg = out.images[0].segmentation;
    expect(seg?.polylines).toHaveLength(1);
    expect(seg?.polylines?.[0].partClass).toBeUndefined();
    expect(seg?.spermInstances).toBeUndefined();
    expect(seg?.statistics.totalSpermInstances).toBeUndefined();
  });
});

// ─── YOLO class ids ──────────────────────────────────────────────────────────
//
// `convertToYOLO` used to hardcode `0` on every line, so a two-class project
// exported as one undifferentiated class and nothing errored. These tests pin
// both halves of the fix: the ids are real, and a single-class project's bytes
// did not move.
//
// The polygons in `fixtures/yolo_real_polygons.json` are REAL — captured
// read-only from the production database, not hand-written — and
// `fixtures/yolo_real_golden.json` is the output of the PRE-FIX converter over
// them, so the byte-identity assertion compares against what production
// actually shipped.

describe('convertToYOLO class ids', () => {
  const real = JSON.parse(
    readFileSync(
      path.join(__dirname, 'fixtures', 'yolo_real_polygons.json'),
      'utf8'
    )
  ) as Record<
    string,
    {
      projectType: string;
      imageWidth: number;
      imageHeight: number;
      polygons: Polygon[];
    }
  >;
  const golden = JSON.parse(
    readFileSync(
      path.join(__dirname, 'fixtures', 'yolo_real_golden.json'),
      'utf8'
    )
  ) as Record<string, string>;

  const convertReal = async (
    key: string,
    projectTypeOverride?: string,
    polygons?: Polygon[]
  ): Promise<YOLOConversionResult> => {
    const f = real[key];
    return new FormatConverter().convertToYOLO(
      JSON.stringify(polygons ?? f.polygons),
      f.imageWidth,
      f.imageHeight,
      projectTypeOverride ?? f.projectType
    );
  };

  it('leaves a real single-class export byte-identical to the pre-fix output', async () => {
    for (const key of ['spheroidInvasive', 'spheroidWithHole']) {
      const result = await convertReal(key);
      expect(result.content).toBe(golden[key]);
      expect(result.warnings).toEqual([]);
    }
  });

  it('keeps the spheroid `core` class folded into `cell`, as COCO does', async () => {
    // The real spheroid_invasive row carries one plain external and one
    // `partClass: 'core'` external. COCO gives neither its own category, so
    // neither gets its own YOLO id — the two formats must agree on what a
    // class is.
    const f = real.spheroidInvasive;
    expect(f.polygons.map(p => p.partClass)).toEqual([undefined, 'core']);

    const { content } = await convertReal('spheroidInvasive');
    const labelLines = content.split('\n').filter(l => !l.startsWith('#'));
    expect(labelLines).toHaveLength(2);
    expect(labelLines.every(l => l.startsWith('0 '))).toBe(true);
    expect(buildYoloClassMap('spheroid_invasive').names).toEqual(['cell']);
  });

  it('emits a distinct id per neuron class, matching the names it ships', async () => {
    // Real geometry, relabelled: the neurite model landed without production
    // data (PR #371), so the coordinates are real and only the classes are
    // assigned here.
    const [first, second] = real.spheroidInvasive.polygons;
    const polygons: Polygon[] = [
      { ...first, partClass: undefined },
      { ...first, id: 'n1', partClass: 'neurite' },
      { ...second, id: 's1', partClass: 'soma' },
    ];

    const { content, warnings } = await convertReal(
      'spheroidInvasive',
      'neurite',
      polygons
    );
    const ids = content
      .split('\n')
      .filter(l => !l.startsWith('#'))
      .map(l => Number(l.split(' ')[0]));
    expect(ids).toEqual([0, 1, 2]);
    expect(new Set(ids).size).toBe(3);
    expect(warnings).toEqual([]);

    // The comment line carries the same id as its label line.
    const commentIds = content
      .split('\n')
      .filter(l => l.startsWith('# Segmentation:'))
      .map(l => Number(l.split(' ')[2]));
    expect(commentIds).toEqual(ids);

    // …and the ids name the classes the export ships beside the labels.
    const names = buildYoloClassMap('neurite').names;
    expect(names).toEqual(['cell', 'neurite', 'soma']);
    expect(names[ids[1]]).toBe('neurite');
    expect(names[ids[2]]).toBe('soma');
  });

  it('warns instead of silently relabelling a class the project does not declare', async () => {
    const [first] = real.spheroidInvasive.polygons;
    const { content, warnings } = await convertReal(
      'spheroidInvasive',
      'spheroid',
      [{ ...first, partClass: 'soma' }]
    );
    expect(content.split('\n')[0]).toMatch(/^0 /);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('soma');
    expect(warnings[0]).toContain('class 0 (cell)');
  });

  it('orders YOLO ids by COCO category id, skipping the polyline category', async () => {
    // COCO: 1 cell, 2 polyline (no YOLO representation), 3 neurite, 4 soma.
    const { data: coco } = await new FormatConverter().convertToCOCO(
      [
        buildImageData([
          { ...closedPolygon, id: 'c1', partClass: 'neurite' },
          { ...closedPolygon, id: 'c2', partClass: 'soma' },
        ]),
      ],
      'neurite'
    );
    const cocoOrder = [...coco.categories]
      .sort((a, b) => a.id - b.id)
      .map(c => c.name);
    expect(cocoOrder).toEqual(['cell', 'neurite', 'soma']);
    expect(buildYoloClassMap('neurite').names).toEqual(cocoOrder);
  });
});

describe('YOLO class files', () => {
  it('classes.txt lists one name per line, the index being the id', () => {
    const map = buildYoloClassMap('neurite');
    const lines = buildYoloClassesFile(map).split('\n');
    expect(lines).toEqual(['cell', 'neurite', 'soma', '']);
    lines.slice(0, -1).forEach((name, index) => {
      expect(map.idFor(name === 'cell' ? undefined : name)).toBe(index);
    });
  });

  it('classes.txt for a single-class project is just `cell`', () => {
    expect(buildYoloClassesFile(buildYoloClassMap('spheroid'))).toBe('cell\n');
  });

  it('data.yaml names every id and omits `path` so the archive stays portable', () => {
    const yaml = buildYoloDataYaml(buildYoloClassMap('neurite'));
    expect(yaml).toContain('names:\n  0: cell\n  1: neurite\n  2: soma\n');
    expect(yaml).toContain('train: ../../images');
    expect(yaml).toContain('val: ../../images');
    // A relative `path:` would resolve against ultralytics' global datasets
    // directory, not this file — absent is the portable choice.
    expect(yaml.split('\n').some(l => l.startsWith('path:'))).toBe(false);
  });
});
