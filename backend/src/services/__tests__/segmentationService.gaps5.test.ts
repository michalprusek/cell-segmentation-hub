/**
 * segmentationService.gaps5.test.ts
 *
 * Covers branches still uncovered after gaps, gaps3, gaps4, crossFrame,
 * concurrent, sperm, resolveChannelPath, batch-fix tests:
 *
 *  A. requestSegmentation — Axios interceptor paths + HTTP error branches
 *     - HTTP 400 error → "Invalid image or segmentation parameters"
 *     - HTTP 500 error → "Segmentation service error"
 *     - ECONNREFUSED → "ML service unavailable"
 *     - ETIMEDOUT → "ML service not responding"
 *     - Generic error → "Segmentation error: <message>"
 *     - Image not found (getImageById returns null) → "Image not found"
 *     - Model incompatible with project type → throws with allowed models
 *     - updateSegmentationStatus throws during error handler (logged, not re-thrown)
 *
 *  B. batchProcess
 *     - all images succeed → successful count correct
 *     - one image fails → failed count incremented, error recorded
 *
 *  C. getProjectSegmentationStats
 *     - project not found → throws "Project not found or no access"
 *     - confidence all zero → averageConfidence = 0
 *     - model usage map built correctly
 *
 *  D. requestBatchSegmentation — error branches
 *     - Axios isAxiosError=true path → returns failed results for all images
 *     - Non-axios error → returns failed results for all images
 *     - Invalid response (no data.results) → throws "Invalid response from ML service"
 *     - resultIndex >= validImageIndices.length → warns and breaks
 *
 *  E. getSegmentationResults
 *     - image not found → returns null
 *     - no segmentation data → returns null
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../utils/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../../utils/config', () => ({
  config: {
    SEGMENTATION_SERVICE_URL: 'http://localhost:8000',
    STORAGE_TYPE: 'local',
    UPLOAD_DIR: '/tmp/uploads',
    NODE_ENV: 'test',
  },
}));

vi.mock('../../storage', () => ({
  getStorageProvider: vi.fn(() => ({
    getBuffer: vi.fn().mockResolvedValue(Buffer.from('fake-image-data')),
    store: vi.fn(),
  })),
}));

vi.mock('../segmentationThumbnailService', () => ({
  SegmentationThumbnailService: vi.fn().mockImplementation(function (
    this: Record<string, unknown>
  ) {
    this.generateSegmentationThumbnail = vi.fn().mockResolvedValue(undefined);
  }),
}));

vi.mock('../thumbnailManager', () => ({
  ThumbnailManager: vi.fn().mockImplementation(function (
    this: Record<string, unknown>
  ) {
    this.generateAllThumbnails = vi.fn().mockResolvedValue(undefined);
  }),
}));

vi.mock('../imageService');

// ─── Axios mock — must be hoisted ─────────────────────────────────────────────

const { mockHttpClientPost, mockHttpClientGet } = vi.hoisted(() => {
  const post = vi.fn();
  const get = vi.fn();
  return { mockHttpClientPost: post, mockHttpClientGet: get };
});

const mockHttpClient = {
  get: mockHttpClientGet,
  post: mockHttpClientPost,
  interceptors: {
    request: { use: vi.fn() },
    response: { use: vi.fn() },
  },
};

vi.mock('axios', () => ({
  default: {
    create: vi.fn(() => mockHttpClient),
  },
}));

import { SegmentationService } from '../segmentationService';

// ─── Prisma / helper factories ────────────────────────────────────────────────

function makePrisma() {
  return {
    segmentation: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      upsert: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      deleteMany: vi.fn(),
      aggregate: vi.fn(),
      groupBy: vi.fn(),
    },
    image: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      count: vi.fn(),
    },
    project: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
    },
    $transaction: vi.fn((ops: unknown[]) => Promise.all(ops)),
    $queryRaw: vi.fn(),
  };
}

// getProjectSegmentationStats now uses server-side aggregation
// (segmentation.aggregate + segmentation.groupBy + a $queryRaw polygon count).
// Derive those mock returns from a flat array of segmentation rows.
function mockSegStatsFromRows(
  prisma: ReturnType<typeof makePrisma>,
  rows: Array<{
    polygons?: string;
    confidence?: number | null;
    model?: string | null;
  }>
) {
  const count = rows.length;
  // Prisma's _avg ignores NULLs: average only the non-null confidences (and
  // return null when there are none). Dividing by all rows would diverge from
  // the real nullable-field aggregate and could hide bugs.
  const confidences = rows
    .map(r => r.confidence)
    .filter((c): c is number => c != null);
  const avgConfidence = confidences.length
    ? confidences.reduce((s, c) => s + c, 0) / confidences.length
    : null;
  prisma.segmentation.aggregate.mockResolvedValue({
    _avg: { confidence: avgConfidence },
    _count: { _all: count },
  });

  const modelCounts = new Map<string, number>();
  for (const r of rows) {
    if (r.model) {
      modelCounts.set(r.model, (modelCounts.get(r.model) ?? 0) + 1);
    }
  }
  prisma.segmentation.groupBy.mockResolvedValue(
    [...modelCounts].map(([model, c]) => ({ model, _count: { _all: c } }))
  );

  const totalPolygons = rows.reduce((s, r) => {
    try {
      const parsed = JSON.parse(r.polygons ?? '[]');
      return s + (Array.isArray(parsed) ? parsed.length : 0);
    } catch {
      return s;
    }
  }, 0);
  prisma.$queryRaw.mockResolvedValue([{ total: BigInt(totalPolygons) }]);
}

function makeImageService() {
  return {
    getImageById: vi.fn(),
    updateSegmentationStatus: vi.fn().mockResolvedValue(undefined),
  };
}

function makeImage(overrides: Record<string, unknown> = {}) {
  return {
    id: 'img-1',
    name: 'test.jpg',
    originalPath: 'projects/p1/images/img-1/original.jpg',
    mimeType: 'image/jpeg',
    width: 100,
    height: 100,
    projectId: 'proj-1',
    parentVideoId: null,
    ...overrides,
  };
}

function makeSegResult(overrides: Record<string, unknown> = {}) {
  return {
    success: true,
    polygons: [
      {
        id: 'p1',
        points: [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
          { x: 0, y: 10 },
        ],
        type: 'external',
        confidence: 0.9,
        area: 50,
      },
    ],
    polylines: [],
    model_used: 'hrnet',
    threshold_used: 0.5,
    confidence: 0.9,
    processing_time: 200,
    image_size: { width: 100, height: 100 },
    ...overrides,
  };
}

function makeService(
  prisma = makePrisma(),
  imageService = makeImageService()
): {
  svc: SegmentationService;
  prisma: ReturnType<typeof makePrisma>;
  imageService: ReturnType<typeof makeImageService>;
} {
  const svc = new SegmentationService(prisma as never, imageService as never);
  return { svc, prisma, imageService };
}

// ─── A. requestSegmentation error branches ────────────────────────────────────

describe('SegmentationService — requestSegmentation HTTP error branches', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('throws "Image not found" when getImageById returns null', async () => {
    const { svc, imageService } = makeService();
    imageService.getImageById.mockResolvedValueOnce(null);

    await expect(
      svc.requestSegmentation({
        imageId: 'img-missing',
        model: 'hrnet',
        threshold: 0.5,
        userId: 'user-1',
      })
    ).rejects.toThrow('Image not found or no access');
  });

  it('throws model incompatibility error when model not allowed for project type', async () => {
    const { svc, imageService, prisma } = makeService();
    imageService.getImageById.mockResolvedValueOnce(makeImage());
    prisma.project.findUnique.mockResolvedValueOnce({ type: 'wound' });

    await expect(
      svc.requestSegmentation({
        imageId: 'img-1',
        model: 'sperm' as never,
        threshold: 0.5,
        userId: 'user-1',
      })
    ).rejects.toThrow(/not compatible with project type/);
  });

  it('throws "ML service unavailable" on ECONNREFUSED', async () => {
    const { svc, imageService, prisma } = makeService();
    imageService.getImageById.mockResolvedValueOnce(makeImage());
    prisma.project.findUnique.mockResolvedValueOnce({ type: 'spheroid' });

    const err = Object.assign(new Error('connection refused'), {
      code: 'ECONNREFUSED',
      isAxiosError: true,
      response: undefined,
      config: {},
    });
    mockHttpClientPost.mockRejectedValueOnce(err);

    await expect(
      svc.requestSegmentation({
        imageId: 'img-1',
        model: 'hrnet',
        threshold: 0.5,
        userId: 'user-1',
      })
    ).rejects.toThrow('ML service unavailable');
  });

  it('throws "ML service not responding" on ETIMEDOUT', async () => {
    const { svc, imageService, prisma } = makeService();
    imageService.getImageById.mockResolvedValueOnce(makeImage());
    prisma.project.findUnique.mockResolvedValueOnce({ type: 'spheroid' });

    const err = Object.assign(new Error('timed out'), {
      code: 'ETIMEDOUT',
      isAxiosError: true,
      response: undefined,
      config: {},
    });
    mockHttpClientPost.mockRejectedValueOnce(err);

    await expect(
      svc.requestSegmentation({
        imageId: 'img-1',
        model: 'hrnet',
        threshold: 0.5,
        userId: 'user-1',
      })
    ).rejects.toThrow('ML service not responding');
  });

  it('throws "Invalid image" for HTTP 400', async () => {
    const { svc, imageService, prisma } = makeService();
    imageService.getImageById.mockResolvedValueOnce(makeImage());
    prisma.project.findUnique.mockResolvedValueOnce({ type: 'spheroid' });

    const err = Object.assign(new Error('bad request'), {
      isAxiosError: true,
      response: {
        status: 400,
        statusText: 'Bad Request',
        data: { detail: 'bad image format' },
      },
      config: {},
    });
    mockHttpClientPost.mockRejectedValueOnce(err);

    await expect(
      svc.requestSegmentation({
        imageId: 'img-1',
        model: 'hrnet',
        threshold: 0.5,
        userId: 'user-1',
      })
    ).rejects.toThrow('Invalid image or segmentation parameters');
  });

  it('throws "Segmentation service error" for HTTP 500', async () => {
    const { svc, imageService, prisma } = makeService();
    imageService.getImageById.mockResolvedValueOnce(makeImage());
    prisma.project.findUnique.mockResolvedValueOnce({ type: 'spheroid' });

    const err = Object.assign(new Error('internal error'), {
      isAxiosError: true,
      response: {
        status: 500,
        statusText: 'Internal Server Error',
        data: { detail: 'oops' },
      },
      config: {},
    });
    mockHttpClientPost.mockRejectedValueOnce(err);

    await expect(
      svc.requestSegmentation({
        imageId: 'img-1',
        model: 'hrnet',
        threshold: 0.5,
        userId: 'user-1',
      })
    ).rejects.toThrow('Segmentation service error');
  });

  it('throws generic "Segmentation error" for unknown error', async () => {
    const { svc, imageService, prisma } = makeService();
    imageService.getImageById.mockResolvedValueOnce(makeImage());
    prisma.project.findUnique.mockResolvedValueOnce({ type: 'spheroid' });

    const err = Object.assign(new Error('weird failure'), {
      isAxiosError: false,
      response: undefined,
      config: {},
    });
    mockHttpClientPost.mockRejectedValueOnce(err);

    await expect(
      svc.requestSegmentation({
        imageId: 'img-1',
        model: 'hrnet',
        threshold: 0.5,
        userId: 'user-1',
      })
    ).rejects.toThrow('Segmentation error: weird failure');
  });

  it('logs error but does not re-throw when updateSegmentationStatus fails inside error handler', async () => {
    const { svc, imageService, prisma } = makeService();
    imageService.getImageById.mockResolvedValueOnce(makeImage());
    prisma.project.findUnique.mockResolvedValueOnce({ type: 'spheroid' });
    // updateSegmentationStatus throws on the second call (inside catch → failed)
    imageService.updateSegmentationStatus
      .mockResolvedValueOnce(undefined) // first call: 'processing'
      .mockRejectedValueOnce(new Error('WS down')); // second call: 'failed' inside catch

    const err = Object.assign(new Error('weird failure'), {
      isAxiosError: false,
      response: undefined,
      config: {},
    });
    mockHttpClientPost.mockRejectedValueOnce(err);

    // Should still throw the original segmentation error, not the WS error
    await expect(
      svc.requestSegmentation({
        imageId: 'img-1',
        model: 'hrnet',
        threshold: 0.5,
        userId: 'user-1',
      })
    ).rejects.toThrow('Segmentation error');
  });
});

// ─── B. batchProcess ──────────────────────────────────────────────────────────

describe('SegmentationService — batchProcess', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('all images succeed → correct successful count', async () => {
    const { svc, imageService, prisma } = makeService();
    imageService.getImageById.mockResolvedValue(makeImage());
    prisma.project.findUnique.mockResolvedValue({ type: 'spheroid' });
    mockHttpClientPost.mockResolvedValue({ data: makeSegResult() });
    prisma.segmentation.upsert.mockResolvedValue({
      id: 's1',
      imageId: 'img-1',
      polygons: '[]',
      model: 'hrnet',
      threshold: 0.5,
      confidence: 0.9,
      imageWidth: 100,
      imageHeight: 100,
      createdAt: new Date(),
      updatedAt: new Date(),
      processingTime: 200,
    });

    const result = await svc.batchProcess(
      ['img-1', 'img-2'],
      'hrnet',
      0.5,
      'user-1'
    );
    expect(result.successful).toBe(2);
    expect(result.failed).toBe(0);
    expect(result.results).toHaveLength(2);
    expect(result.results[0].success).toBe(true);
  });

  it('one image fails → failed count incremented', async () => {
    const { svc, imageService, prisma } = makeService();
    imageService.getImageById
      .mockResolvedValueOnce(makeImage())
      .mockResolvedValueOnce(null); // second image not found
    prisma.project.findUnique.mockResolvedValue({ type: 'spheroid' });
    mockHttpClientPost.mockResolvedValue({ data: makeSegResult() });
    prisma.segmentation.upsert.mockResolvedValue({
      id: 's1',
      imageId: 'img-1',
      polygons: '[]',
      model: 'hrnet',
      threshold: 0.5,
      confidence: 0.9,
      imageWidth: 100,
      imageHeight: 100,
      createdAt: new Date(),
      updatedAt: new Date(),
      processingTime: 200,
    });

    const result = await svc.batchProcess(
      ['img-1', 'img-2'],
      'hrnet',
      0.5,
      'user-1'
    );
    expect(result.successful).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.results[1].success).toBe(false);
    expect(result.results[1].error).toMatch(/Image not found/);
  });
});

// ─── C. getProjectSegmentationStats ──────────────────────────────────────────

describe('SegmentationService — getProjectSegmentationStats', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('throws when project not found', async () => {
    const { svc, prisma } = makeService();
    prisma.project.findFirst.mockResolvedValueOnce(null);

    await expect(
      svc.getProjectSegmentationStats('proj-missing', 'user-1')
    ).rejects.toThrow('Project not found or no access');
  });

  it('returns averageConfidence = 0 when segmentation data is empty', async () => {
    const { svc, prisma } = makeService();
    prisma.project.findFirst.mockResolvedValueOnce({ id: 'proj-1' });
    prisma.image.count.mockResolvedValueOnce(5);
    mockSegStatsFromRows(prisma, []);

    const stats = await svc.getProjectSegmentationStats('proj-1', 'user-1');
    expect(stats.averageConfidence).toBe(0);
    expect(stats.totalPolygons).toBe(0);
    expect(stats.processedImages).toBe(0);
  });

  it('builds model usage map correctly', async () => {
    const { svc, prisma } = makeService();
    prisma.project.findFirst.mockResolvedValueOnce({ id: 'proj-1' });
    prisma.image.count.mockResolvedValueOnce(3);
    mockSegStatsFromRows(prisma, [
      { polygons: '[]', confidence: 0.8, model: 'hrnet' },
      { polygons: '[]', confidence: 0.9, model: 'hrnet' },
      { polygons: '[]', confidence: 0.7, model: 'resunet_advanced' },
    ]);

    const stats = await svc.getProjectSegmentationStats('proj-1', 'user-1');
    expect(stats.models['hrnet']).toBe(2);
    expect(
        (stats.models as Record<string, number>)['resunet_advanced']
      ).toBe(1);
    expect(stats.processedImages).toBe(3);
  });
});

// ─── D. requestBatchSegmentation error branches ───────────────────────────────

describe('SegmentationService — requestBatchSegmentation errors', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns failed results for all images on Axios error', async () => {
    const { svc } = makeService();
    const images = [
      makeImage({ id: 'img-1', originalPath: 'p.jpg' }),
      makeImage({ id: 'img-2', originalPath: 'p2.jpg' }),
    ];
    const err = Object.assign(new Error('network error'), {
      isAxiosError: true,
      response: undefined,
      config: {},
    });
    mockHttpClientPost.mockRejectedValueOnce(err);

    const results = await svc.requestBatchSegmentation(
      images as never[],
      'hrnet',
      0.5,
      true
    );
    expect(results).toHaveLength(2);
    expect(results[0].success).toBe(false);
    expect(results[1].success).toBe(false);
    expect(results[0].error).toBeDefined();
  });

  it('returns failed results on non-axios error', async () => {
    const { svc } = makeService();
    const images = [makeImage({ id: 'img-1', originalPath: 'p.jpg' })];
    mockHttpClientPost.mockRejectedValueOnce(new Error('generic fail'));

    const results = await svc.requestBatchSegmentation(
      images as never[],
      'hrnet',
      0.5,
      true
    );
    expect(results[0].success).toBe(false);
  });

  it('returns failed results when data.results is missing (internal throw caught)', async () => {
    const { svc } = makeService();
    const images = [makeImage({ id: 'img-1', originalPath: 'p.jpg' })];
    mockHttpClientPost.mockResolvedValueOnce({
      data: { notResults: true },
      status: 200,
    });

    // The throw on line 1145 is caught by the outer try/catch which returns
    // failed results for all images rather than propagating.
    const results = await svc.requestBatchSegmentation(
      images as never[],
      'hrnet',
      0.5,
      true
    );
    expect(results).toHaveLength(1);
    expect(results[0].success).toBe(false);
    expect(results[0].error).toBeDefined();
  });

  it('warns and breaks when resultIndex >= validImageIndices.length', async () => {
    const { svc } = makeService();
    const images = [makeImage({ id: 'img-1', originalPath: 'p.jpg' })];
    // ML returns 2 results but only 1 valid image
    mockHttpClientPost.mockResolvedValueOnce({
      data: {
        results: [
          {
            success: true,
            polygons: [
              {
                id: 'p1',
                points: [
                  { x: 0, y: 0 },
                  { x: 1, y: 0 },
                  { x: 0, y: 1 },
                ],
                type: 'external',
              },
            ],
            model_used: 'hrnet',
            threshold_used: 0.5,
            confidence: 0.9,
            processing_time: 100,
            image_size: { width: 100, height: 100 },
          },
          {
            success: true,
            polygons: [],
            model_used: 'hrnet',
            threshold_used: 0.5,
            confidence: 0.9,
            processing_time: 100,
            image_size: { width: 100, height: 100 },
          }, // extra
        ],
        processing_time: 200,
      },
    });

    // Should not throw — just warn and break
    const results = await svc.requestBatchSegmentation(
      images as never[],
      'hrnet',
      0.5,
      true
    );
    expect(results).toHaveLength(1);
  });
});

// ─── E. getSegmentationResults ────────────────────────────────────────────────

describe('SegmentationService — getSegmentationResults', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null when image not found', async () => {
    const { svc, imageService } = makeService();
    imageService.getImageById.mockResolvedValueOnce(null);

    const result = await svc.getSegmentationResults('img-missing', 'user-1');
    expect(result).toBeNull();
  });

  it('returns null when no segmentation data exists', async () => {
    const { svc, imageService, prisma } = makeService();
    imageService.getImageById.mockResolvedValueOnce(makeImage());
    prisma.segmentation.findUnique.mockResolvedValueOnce(null);

    const result = await svc.getSegmentationResults('img-1', 'user-1');
    expect(result).toBeNull();
  });
});
