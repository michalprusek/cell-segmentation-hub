/**
 * SP2 extensibility refactor — polygon-field SSOT property tests.
 *
 * These assert the *refactor goal*: a polygon carrying every optional metadata
 * field survives the data-path round-trips unchanged, `_embedding` round-trips
 * internally but is stripped at the serve boundary, parentIds<->parent_id
 * converts both directions, and the untrusted-input validator still drops junk.
 *
 * If these pass, adding a new optional field requires only:
 *   1. one entry in OPTIONAL_POLYGON_FIELDS (validator SSOT)
 *   2. the explicit field on the two typed SegmentationPolygon contracts
 * — the three service mappers spread and need no edits.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SegmentationService } from '../segmentationService';
import type { SegmentationPolygon } from '../segmentationService';
import {
  PolygonValidator,
  OPTIONAL_POLYGON_FIELDS,
} from '../../utils/polygonValidation';

// Mirror the mock set of the sibling segmentationService.*.test.ts files so
// this file is independently runnable. `../../utils/config` is load-bearing:
// its parseConfig calls process.exit(1) when env vars are absent, which aborts
// the whole suite at import time when this file runs in isolation.
vi.mock('../../utils/config', () => ({
  config: {
    SEGMENTATION_SERVICE_URL: 'http://localhost:8000',
    STORAGE_TYPE: 'local',
    STORAGE_LOCAL_PATH: '/tmp/test-storage',
    UPLOAD_DIR: '/tmp/uploads',
    NODE_ENV: 'test',
  },
}));
vi.mock('../../utils/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../../storage');
vi.mock('../imageService');
vi.mock('../../storage/index', () => ({
  getStorageProvider: vi.fn(() => ({
    getBuffer: vi.fn(),
    saveBuffer: vi.fn(),
    delete: vi.fn(),
    exists: vi.fn(),
  })),
}));
// Explicit class mocks: SegmentationService's constructor does
// `new ThumbnailManager(...)`, and the update path calls
// `.generateAllThumbnails(id).catch(...)` (no await), so the method must
// return a real resolved promise — a bare auto-mock returns undefined and the
// .catch() throws.
vi.mock('../segmentationThumbnailService', () => ({
  SegmentationThumbnailService: class {
    generateThumbnail = vi.fn().mockResolvedValue(undefined);
  },
}));
vi.mock('../thumbnailManager', () => ({
  ThumbnailManager: class {
    generateAllThumbnails = vi.fn().mockResolvedValue(undefined);
  },
}));

const IMAGE_ID = 'img-1';
const USER_ID = 'user-1';

/** A polygon carrying every optional field plus an _embedding blob. */
const fullPolygon = (): Record<string, unknown> => ({
  id: 'poly-1',
  points: [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
  ],
  type: 'external',
  area: 42,
  confidence: 0.9,
  geometry: 'polyline',
  partClass: 'head',
  instanceId: 'sperm-7',
  trackId: 'track-99',
  name: 'Tail A',
  // Server-only blob — must round-trip through DB but be stripped at serve.
  _embedding: [
    [1, 2, 3],
    [4, 5, 6],
  ],
});

describe('polygon-field SSOT round-trip', () => {
  let prisma: any;
  let imageService: any;

  const makeService = () => new SegmentationService(prisma, imageService);

  beforeEach(() => {
    vi.clearAllMocks();
    prisma = {
      segmentation: {
        findUnique: vi.fn(),
        upsert: vi.fn(),
        update: vi.fn(() => ({ __op: 'update' })),
        create: vi.fn(),
        findMany: vi.fn(),
      },
      image: { findMany: vi.fn().mockResolvedValue([]) },
      $transaction: vi.fn(),
    };

    imageService = {
      getImageById: vi.fn().mockResolvedValue({
        id: IMAGE_ID,
        projectId: 'proj-1',
        parentVideoId: null,
        originalPath: '/x.png',
      }),
      updateSegmentationStatus: vi.fn().mockResolvedValue(undefined),
    };
  });

  it('OPTIONAL_POLYGON_FIELDS registers all metadata fields and NOT _embedding', () => {
    const keys = OPTIONAL_POLYGON_FIELDS.map(f => f.key);
    expect(keys).toEqual(
      expect.arrayContaining(['partClass', 'instanceId', 'trackId', 'name'])
    );
    expect(keys).not.toContain('_embedding');
  });

  it('save -> getSegmentationResults preserves every optional field and strips _embedding', async () => {
    let storedJson = '';
    prisma.segmentation.upsert.mockImplementation(async (args: any) => {
      storedJson = args.create.polygons;
      return { id: 'seg-1' };
    });

    const service = makeService();
    await service.saveSegmentationResults(
      IMAGE_ID,
      [fullPolygon() as unknown as SegmentationPolygon],
      'sperm',
      0.5,
      null,
      1000,
      640,
      480,
      USER_ID,
      false
    );

    // The DB JSON must carry the optional fields AND _embedding (server-side).
    const stored = JSON.parse(storedJson) as Array<Record<string, unknown>>;
    expect(stored).toHaveLength(1);
    expect(stored[0].partClass).toBe('head');
    expect(stored[0].instanceId).toBe('sperm-7');
    expect(stored[0].trackId).toBe('track-99');
    expect(stored[0].name).toBe('Tail A');
    expect(stored[0].geometry).toBe('polyline');
    expect(stored[0]._embedding).toEqual([
      [1, 2, 3],
      [4, 5, 6],
    ]);

    // Now serve it back: optional fields survive, _embedding is stripped.
    prisma.segmentation.findUnique.mockResolvedValue({
      polygons: storedJson,
      model: 'sperm',
      threshold: 0.5,
      confidence: 0.9,
      processingTime: 1000,
      imageWidth: 640,
      imageHeight: 480,
      updatedAt: new Date(),
    });

    const served = await service.getSegmentationResults(IMAGE_ID, USER_ID);
    expect(served).not.toBeNull();
    const p = served!.polygons[0] as Record<string, unknown>;
    expect(p.partClass).toBe('head');
    expect(p.instanceId).toBe('sperm-7');
    expect(p.trackId).toBe('track-99');
    expect(p.name).toBe('Tail A');
    expect(p.geometry).toBe('polyline');
    expect(p._embedding).toBeUndefined();
  });

  it('updateSegmentationResults -> getSegmentationResults round-trips fields, converts parentIds, strips _embedding', async () => {
    let updatedJson = '';
    prisma.segmentation.findUnique.mockResolvedValue({
      id: 'seg-1',
      polygons: '[]',
      model: 'manual',
      threshold: 0.5,
    });
    prisma.segmentation.update.mockImplementation((args: any) => {
      updatedJson = args.data.polygons;
      return { __op: 'update' };
    });
    prisma.$transaction.mockImplementation(async (ops: any[]) =>
      ops.map(() => ({
        id: 'seg-1',
        imageId: IMAGE_ID,
        model: 'manual',
        threshold: 0.5,
        confidence: 0.9,
        imageWidth: 640,
        imageHeight: 480,
        createdAt: new Date(),
        updatedAt: new Date(),
      }))
    );

    // Input is the wire shape: internal polygon with parentIds[].
    const wirePoly = {
      ...fullPolygon(),
      type: 'internal',
      parentIds: ['parent-xyz'],
    };

    const service = makeService();
    await service.updateSegmentationResults(
      IMAGE_ID,
      [wirePoly as unknown as SegmentationPolygon],
      USER_ID,
      640,
      480
    );

    // DB JSON: parentIds[] collapsed to parent_id, fields + _embedding kept.
    const stored = JSON.parse(updatedJson) as Array<Record<string, unknown>>;
    expect(stored[0].parent_id).toBe('parent-xyz');
    expect(stored[0].parentIds).toBeUndefined();
    expect(stored[0].partClass).toBe('head');
    expect(stored[0].trackId).toBe('track-99');
    expect(stored[0].name).toBe('Tail A');
    expect(stored[0]._embedding).toBeDefined();

    // Serve it: parent_id -> parentIds[], _embedding stripped.
    prisma.segmentation.findUnique.mockResolvedValue({
      polygons: updatedJson,
      model: 'manual',
      threshold: 0.5,
      confidence: 0.9,
      processingTime: null,
      imageWidth: 640,
      imageHeight: 480,
      updatedAt: new Date(),
    });

    const served = await service.getSegmentationResults(IMAGE_ID, USER_ID);
    const p = served!.polygons[0] as Record<string, unknown>;
    expect(p.parentIds).toEqual(['parent-xyz']);
    expect(p.partClass).toBe('head');
    expect(p.trackId).toBe('track-99');
    expect(p.name).toBe('Tail A');
    expect((p as { parent_id?: unknown }).parent_id).toBeUndefined();
    expect(p._embedding).toBeUndefined();
  });

  it('validator drops unknown/junk fields from untrusted input (security boundary)', () => {
    const dirty = {
      points: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 1, y: 1 },
      ],
      type: 'external',
      trackId: 'keep-me',
      arbitraryJunk: { nested: true },
      // _embedding must NOT be admitted through the untrusted validate path.
      _embedding: [[9, 9, 9]],
    };
    const result = PolygonValidator.validateSinglePolygon(dirty, 0) as Record<
      string,
      unknown
    >;
    expect(result).not.toBeNull();
    expect(result.trackId).toBe('keep-me');
    expect(result.arbitraryJunk).toBeUndefined();
    expect(result._embedding).toBeUndefined();
  });
});
