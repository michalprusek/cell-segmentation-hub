import { describe, it, expect, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { SegmentationService } from '../segmentationService';
import { ImageService } from '../imageService';

vi.mock('../../utils/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../../utils/config', () => ({
  config: {
    SEGMENTATION_SERVICE_URL: 'http://localhost:8000',
    STORAGE_TYPE: 'local',
    STORAGE_LOCAL_PATH: '/tmp/test-storage',
  },
}));

vi.mock('../../storage');
vi.mock('../segmentationThumbnailService');
// Plain constructor inside factory: not a vi.fn(), so restoreMocks: true cannot
// wipe the body between tests. metricsCalculator.sperm.test.ts has the same fix.
vi.mock('../thumbnailManager', () => ({
  ThumbnailManager: function MockThumbnailManager(this: any) {
    this.generateAllThumbnails = vi.fn().mockResolvedValue(undefined);
  },
}));
vi.mock('../imageService');

interface SpermPolygonInput {
  id?: string;
  points: { x: number; y: number }[];
  type: 'external' | 'internal';
  area?: number;
  confidence?: number;
  geometry?: 'polygon' | 'polyline';
  partClass?: 'head' | 'midpiece' | 'tail' | 'core';
  instanceId?: string;
}

const headPolyline: SpermPolygonInput = {
  id: 'pl-head-1',
  type: 'external',
  geometry: 'polyline',
  partClass: 'head',
  instanceId: 'sperm_1',
  points: [
    { x: 0, y: 0 },
    { x: 3, y: 0 },
  ],
  area: 0,
  confidence: 0.92,
};

const midpiecePolyline: SpermPolygonInput = {
  id: 'pl-mid-1',
  type: 'external',
  geometry: 'polyline',
  partClass: 'midpiece',
  instanceId: 'sperm_1',
  points: [
    { x: 3, y: 0 },
    { x: 3, y: 4 },
  ],
  area: 0,
  confidence: 0.88,
};

const tailPolyline: SpermPolygonInput = {
  id: 'pl-tail-1',
  type: 'external',
  geometry: 'polyline',
  partClass: 'tail',
  instanceId: 'sperm_1',
  points: [
    { x: 3, y: 4 },
    { x: 3, y: 9 },
  ],
  area: 0,
  confidence: 0.79,
};

describe('SegmentationService — sperm polyline roundtrip preservation', () => {
  let segmentationService: SegmentationService;
  let prismaMock: any;
  let imageServiceMock: any;

  // The simulated DB: keyed by imageId, holds the JSON string that
  // upsert would have written. findMany serves it back unchanged.
  const dbStore = new Map<string, string>();

  beforeEach(() => {
    dbStore.clear();

    prismaMock = {
      segmentation: {
        findMany: vi.fn(async ({ where }: any) => {
          const ids: string[] = where?.imageId?.in ?? [];
          return ids
            .filter(id => dbStore.has(id))
            .map(id => ({
              id: `seg-${id}`,
              imageId: id,
              polygons: dbStore.get(id),
              model: 'sperm',
              threshold: 0.5,
              confidence: 0.85,
              processingTime: 200,
              imageWidth: 100,
              imageHeight: 100,
            }));
        }),
        findUnique: vi.fn(),
        upsert: vi.fn(async ({ where, create }: any) => {
          // Capture the JSON string the service tried to write so the round-trip
          // can read it back. Both `update` and `create` carry the same JSON.
          dbStore.set(where.imageId, create.polygons);
          return { id: `seg-${where.imageId}`, ...create };
        }),
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
        deleteMany: vi.fn(),
      },
      image: {
        findMany: vi.fn(async ({ where }: any) => {
          const ids: string[] = where?.id?.in ?? [];
          return ids.map(id => ({ id }));
        }),
        findUnique: vi.fn(),
        count: vi.fn(),
      },
      project: { findFirst: vi.fn() },
    };

    imageServiceMock = {
      getImageById: vi.fn(),
      updateSegmentationStatus: vi.fn().mockResolvedValue(undefined),
    };

    segmentationService = new SegmentationService(
      prismaMock as PrismaClient,
      imageServiceMock as ImageService
    );
  });

  const saveSpermResults = async (
    imageId: string,
    polygons: SpermPolygonInput[]
  ) =>
    segmentationService.saveSegmentationResults(
      imageId,
      polygons as any,
      'sperm',
      0.5,
      0.85,
      200,
      100,
      100,
      'user-1'
    );

  it('preserves geometry/partClass/instanceId on a single polyline through save→load', async () => {
    await saveSpermResults('img-1', [headPolyline]);

    const result = await segmentationService.getBatchSegmentationResults(
      ['img-1'],
      'user-1'
    );

    const loaded = (result['img-1'] as any).polygons;
    expect(loaded).toHaveLength(1);
    expect(loaded[0]).toMatchObject({
      geometry: 'polyline',
      partClass: 'head',
      instanceId: 'sperm_1',
      type: 'external',
    });
    expect(loaded[0].points).toEqual(headPolyline.points);
  });

  it('preserves all three sperm parts with shared instanceId in a roundtrip', async () => {
    await saveSpermResults('img-1', [
      headPolyline,
      midpiecePolyline,
      tailPolyline,
    ]);

    const result = await segmentationService.getBatchSegmentationResults(
      ['img-1'],
      'user-1'
    );

    const loaded = (result['img-1'] as any).polygons;
    expect(loaded).toHaveLength(3);

    const byPart: Record<string, any> = {};
    for (const p of loaded) {
      byPart[p.partClass] = p;
    }

    expect(byPart.head?.instanceId).toBe('sperm_1');
    expect(byPart.midpiece?.instanceId).toBe('sperm_1');
    expect(byPart.tail?.instanceId).toBe('sperm_1');
    expect(byPart.head?.geometry).toBe('polyline');
    expect(byPart.midpiece?.geometry).toBe('polyline');
    expect(byPart.tail?.geometry).toBe('polyline');
  });

  it('keeps multiple sperm instances distinguishable by instanceId', async () => {
    const sperm1Head = { ...headPolyline, id: 'h1', instanceId: 'sperm_1' };
    const sperm2Head = { ...headPolyline, id: 'h2', instanceId: 'sperm_2' };
    const sperm2Tail = {
      ...tailPolyline,
      id: 't2',
      instanceId: 'sperm_2',
    };

    await saveSpermResults('img-1', [sperm1Head, sperm2Head, sperm2Tail]);

    const result = await segmentationService.getBatchSegmentationResults(
      ['img-1'],
      'user-1'
    );

    const loaded = (result['img-1'] as any).polygons;
    const instanceIds = loaded.map((p: any) => p.instanceId).sort();
    expect(instanceIds).toEqual(['sperm_1', 'sperm_2', 'sperm_2']);
  });

  it('does not add geometry/partClass/instanceId to closed polygons', async () => {
    const closedPolygon: SpermPolygonInput = {
      id: 'p1',
      type: 'external',
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
        { x: 0, y: 10 },
      ],
      area: 100,
      confidence: 0.9,
    };

    await saveSpermResults('img-1', [closedPolygon]);

    const result = await segmentationService.getBatchSegmentationResults(
      ['img-1'],
      'user-1'
    );

    const loaded = (result['img-1'] as any).polygons;
    expect(loaded).toHaveLength(1);
    expect(loaded[0].geometry).toBeUndefined();
    expect(loaded[0].partClass).toBeUndefined();
    expect(loaded[0].instanceId).toBeUndefined();
  });

  it('drops invalid partClass during validation but keeps the polyline geometry', async () => {
    // PolygonValidator only preserves partClass if it's in the valid set.
    // A typo like "haed" should be silently dropped on the read path.
    const typoed: SpermPolygonInput = {
      ...headPolyline,
      partClass: 'haed' as any,
    };

    await saveSpermResults('img-1', [typoed]);

    const result = await segmentationService.getBatchSegmentationResults(
      ['img-1'],
      'user-1'
    );

    const loaded = (result['img-1'] as any).polygons;
    expect(loaded).toHaveLength(1);
    expect(loaded[0].geometry).toBe('polyline');
    expect(loaded[0].partClass).toBeUndefined();
    expect(loaded[0].instanceId).toBe('sperm_1');
  });

  it('persists JSON exactly once per save (upsert is the only write path)', async () => {
    await saveSpermResults('img-1', [headPolyline]);

    expect(prismaMock.segmentation.upsert).toHaveBeenCalledTimes(1);

    const upsertArg = prismaMock.segmentation.upsert.mock.calls[0]?.[0];
    const writtenJson = upsertArg.create.polygons as string;
    const parsed = JSON.parse(writtenJson);
    expect(parsed[0]).toMatchObject({
      geometry: 'polyline',
      partClass: 'head',
      instanceId: 'sperm_1',
    });
  });
});
