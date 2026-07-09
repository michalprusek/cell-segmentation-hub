import { describe, it, expect, beforeEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks — keeps the factory referencing the same object that
// vi.mock() uses (Vitest hoists vi.mock above imports). Pattern mirrors
// projectFolderService.test.ts.
// ---------------------------------------------------------------------------

const { prismaMock } = vi.hoisted(() => {
  const mock = {
    segmenterDataset: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
    },
    segmenterImage: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
    },
    segmenterClass: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    segmenterAnnotation: {
      findMany: vi.fn(),
      upsert: vi.fn(),
      update: vi.fn(),
    },
    $transaction: vi.fn(),
  };
  return { prismaMock: mock };
});

const { storageMock } = vi.hoisted(() => {
  const mock = {
    upload: vi.fn(),
    delete: vi.fn(),
    getUrl: vi.fn(),
    exists: vi.fn(),
    getMetadata: vi.fn(),
    getBuffer: vi.fn(),
  };
  return { storageMock: mock };
});

vi.mock('../../db', () => ({ prisma: prismaMock }));

vi.mock('../../utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../storage/index', () => ({
  getStorageProvider: () => storageMock,
}));

// ---------------------------------------------------------------------------
// Imports AFTER mocks
// ---------------------------------------------------------------------------

import {
  createDataset,
  listDatasets,
  getDataset,
  deleteDataset,
  uploadImages,
  deleteImage,
  listClasses,
  createClass,
  updateClass,
  deleteClass,
  getAnnotation,
  upsertAnnotation,
  sanitizeAnnotationPolygons,
  SegmenterError,
} from '../segmenterService';
import type { SegmenterImageUploadInput } from '../segmenterService';

const USER_ID = 'user-1';
const OTHER_USER_ID = 'user-2';
const DATASET_ID = 'dataset-1';
const IMAGE_ID = 'image-1';
const CLASS_ID = 'class-1';

const makeDataset = (overrides?: Partial<Record<string, unknown>>) => ({
  id: DATASET_ID,
  userId: USER_ID,
  name: 'My Dataset',
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-02'),
  ...overrides,
});

const makeImage = (overrides?: Partial<Record<string, unknown>>) => ({
  id: IMAGE_ID,
  datasetId: DATASET_ID,
  name: 'cell.png',
  storagePath: `projects/segmenter/${DATASET_ID}/images/${IMAGE_ID}/original.png`,
  thumbnailPath: null,
  width: 512,
  height: 512,
  createdAt: new Date('2026-01-01'),
  ...overrides,
});

const makeClass = (overrides?: Partial<Record<string, unknown>>) => ({
  id: CLASS_ID,
  datasetId: DATASET_ID,
  name: 'Nucleus',
  color: '#ff0000',
  createdAt: new Date('2026-01-01'),
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  // Sequential array-form $transaction (the only form segmenterService uses):
  // execute the already-created PrismaPromises and resolve with their results.
  prismaMock.$transaction.mockImplementation((ops: unknown[]) =>
    Promise.all(ops)
  );
  prismaMock.segmenterAnnotation.update.mockResolvedValue({});
});

// ===========================================================================
// Owner-scoping
// ===========================================================================

describe('owner-scoping', () => {
  it('createDataset persists under the calling user', async () => {
    prismaMock.segmenterDataset.create.mockResolvedValue(makeDataset());
    await createDataset(USER_ID, 'My Dataset');
    expect(prismaMock.segmenterDataset.create).toHaveBeenCalledWith({
      data: { userId: USER_ID, name: 'My Dataset' },
    });
  });

  it('createDataset rejects a blank name without touching the DB', async () => {
    await expect(createDataset(USER_ID, '   ')).rejects.toMatchObject({
      name: 'SegmenterError',
      code: 'INVALID_INPUT',
    });
    expect(prismaMock.segmenterDataset.create).not.toHaveBeenCalled();
  });

  it('getDataset scopes the lookup to (id, userId) and 404s for another owner', async () => {
    prismaMock.segmenterDataset.findFirst.mockResolvedValue(null);

    await expect(getDataset(OTHER_USER_ID, DATASET_ID)).rejects.toMatchObject({
      name: 'SegmenterError',
      code: 'NOT_FOUND',
    });

    expect(prismaMock.segmenterDataset.findFirst).toHaveBeenCalledWith({
      where: { id: DATASET_ID, userId: OTHER_USER_ID },
    });
  });

  it('getDataset returns images + classes for the owning user', async () => {
    prismaMock.segmenterDataset.findFirst.mockResolvedValue(makeDataset());
    prismaMock.segmenterImage.findMany.mockResolvedValue([
      { ...makeImage(), annotation: null },
    ]);
    prismaMock.segmenterClass.findMany.mockResolvedValue([makeClass()]);

    const result = await getDataset(USER_ID, DATASET_ID);

    expect(result.id).toBe(DATASET_ID);
    expect(result.images).toHaveLength(1);
    expect(result.images[0].hasAnnotation).toBe(false);
    expect(result.classes).toEqual([makeClass()]);
  });

  it('deleteDataset 404s when the dataset is not owned by the caller', async () => {
    prismaMock.segmenterDataset.findFirst.mockResolvedValue(null);
    await expect(
      deleteDataset(OTHER_USER_ID, DATASET_ID)
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(prismaMock.segmenterDataset.delete).not.toHaveBeenCalled();
  });

  it('listClasses 404s for a dataset owned by someone else', async () => {
    prismaMock.segmenterDataset.findFirst.mockResolvedValue(null);
    await expect(listClasses(OTHER_USER_ID, DATASET_ID)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(prismaMock.segmenterClass.findMany).not.toHaveBeenCalled();
  });

  it('uploadImages 404s for a dataset owned by someone else and never touches storage', async () => {
    prismaMock.segmenterDataset.findFirst.mockResolvedValue(null);
    const files: SegmenterImageUploadInput[] = [
      {
        originalname: 'a.png',
        buffer: Buffer.from('x'),
        mimetype: 'image/png',
        size: 1,
      },
    ];
    await expect(
      uploadImages(OTHER_USER_ID, DATASET_ID, files)
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(storageMock.upload).not.toHaveBeenCalled();
  });

  it("deleteImage 404s when the image belongs to another user's dataset", async () => {
    // Ownership is joined through the dataset: findFirst({ where: { id, dataset: { userId } } })
    prismaMock.segmenterImage.findFirst.mockResolvedValue(null);
    await expect(deleteImage(OTHER_USER_ID, IMAGE_ID)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(prismaMock.segmenterImage.findFirst).toHaveBeenCalledWith({
      where: { id: IMAGE_ID, dataset: { userId: OTHER_USER_ID } },
      select: { id: true, datasetId: true, storagePath: true },
    });
    expect(prismaMock.segmenterImage.delete).not.toHaveBeenCalled();
  });

  it("getAnnotation 404s for an image belonging to another user's dataset", async () => {
    prismaMock.segmenterImage.findFirst.mockResolvedValue(null);
    await expect(getAnnotation(OTHER_USER_ID, IMAGE_ID)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('upsertAnnotation 404s for an image belonging to another user and never writes', async () => {
    prismaMock.segmenterImage.findFirst.mockResolvedValue(null);
    await expect(
      upsertAnnotation(OTHER_USER_ID, IMAGE_ID, {
        polygons: [],
        imageWidth: 100,
        imageHeight: 100,
      })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(prismaMock.segmenterAnnotation.upsert).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// listDatasets — image counts
// ===========================================================================

describe('listDatasets', () => {
  it('flattens the Prisma _count wrapper into imageCount', async () => {
    prismaMock.segmenterDataset.findMany.mockResolvedValue([
      { ...makeDataset(), _count: { images: 3 } },
    ]);
    const result = await listDatasets(USER_ID);
    expect(result).toEqual([{ ...makeDataset(), imageCount: 3 }]);
  });
});

// ===========================================================================
// Class registry — update/delete + reference cleanup
// ===========================================================================

describe('class registry', () => {
  beforeEach(() => {
    prismaMock.segmenterDataset.findFirst.mockResolvedValue(makeDataset());
  });

  it('createClass persists then returns the full list', async () => {
    prismaMock.segmenterClass.create.mockResolvedValue(makeClass());
    prismaMock.segmenterClass.findMany.mockResolvedValue([makeClass()]);

    const result = await createClass(USER_ID, DATASET_ID, {
      name: '  Nucleus  ',
      color: '#FF0000',
    });

    expect(prismaMock.segmenterClass.create).toHaveBeenCalledWith({
      data: { datasetId: DATASET_ID, name: 'Nucleus', color: '#FF0000' },
    });
    expect(result).toEqual([makeClass()]);
  });

  it('updateClass 404s when the class does not belong to the dataset', async () => {
    prismaMock.segmenterClass.findFirst.mockResolvedValue(null);
    await expect(
      updateClass(USER_ID, DATASET_ID, CLASS_ID, { name: 'x' })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(prismaMock.segmenterClass.update).not.toHaveBeenCalled();
  });

  it('deleteClass removes the row and nulls classId references in every annotation of the dataset', async () => {
    prismaMock.segmenterClass.findFirst.mockResolvedValue(makeClass());
    prismaMock.segmenterClass.findMany.mockResolvedValue([]);

    const overlapping = [
      {
        id: 'p1',
        points: [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
          { x: 10, y: 10 },
        ],
        classId: CLASS_ID,
      },
      {
        id: 'p2',
        points: [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
          { x: 10, y: 10 },
        ],
        classId: 'other-class',
      },
    ];
    prismaMock.segmenterAnnotation.findMany.mockResolvedValue([
      { id: 'ann-1', polygons: JSON.stringify(overlapping) },
    ]);

    const result = await deleteClass(USER_ID, DATASET_ID, CLASS_ID);

    expect(prismaMock.segmenterClass.delete).toHaveBeenCalledWith({
      where: { id: CLASS_ID },
    });
    expect(result.imagesCleaned).toBe(1);

    // The transaction should have rewritten annotation "ann-1" with p1's
    // classId stripped but p2's classId (a different class) untouched.
    expect(prismaMock.segmenterAnnotation.update).toHaveBeenCalledTimes(1);
    const updateArg = prismaMock.segmenterAnnotation.update.mock.calls[0][0];
    expect(updateArg.where).toEqual({ id: 'ann-1' });
    const rewritten = JSON.parse(updateArg.data.polygons);
    expect(rewritten).toHaveLength(2);
    expect(rewritten[0].classId).toBeUndefined();
    expect(rewritten[1].classId).toBe('other-class');
  });

  it('deleteClass is a no-op cleanup when no annotation references the class', async () => {
    prismaMock.segmenterClass.findFirst.mockResolvedValue(makeClass());
    prismaMock.segmenterClass.findMany.mockResolvedValue([]);
    prismaMock.segmenterAnnotation.findMany.mockResolvedValue([
      {
        id: 'ann-1',
        polygons: JSON.stringify([
          { id: 'p1', points: [], classId: 'unrelated' },
        ]),
      },
    ]);

    const result = await deleteClass(USER_ID, DATASET_ID, CLASS_ID);

    expect(result.imagesCleaned).toBe(0);
    expect(prismaMock.segmenterAnnotation.update).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// sanitizeAnnotationPolygons — shape validation + overlap preservation
// ===========================================================================

describe('sanitizeAnnotationPolygons', () => {
  it('keeps two fully overlapping same-class polygons (no dedupe)', () => {
    const square = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ];
    const raw = [
      { id: 'a', points: square, classId: 'cls-1', instanceId: 'inst-1' },
      { id: 'b', points: square, classId: 'cls-1', instanceId: 'inst-2' },
    ];
    const result = sanitizeAnnotationPolygons(raw);
    expect(result).toHaveLength(2);
    expect(result[0].points).toEqual(square);
    expect(result[1].points).toEqual(square);
    expect(result[0].classId).toBe('cls-1');
    expect(result[1].classId).toBe('cls-1');
    expect(result[0].instanceId).toBe('inst-1');
    expect(result[1].instanceId).toBe('inst-2');
  });

  it('keeps overlapping polygons of DIFFERENT classes intact', () => {
    const square = [
      { x: 0, y: 0 },
      { x: 5, y: 0 },
      { x: 5, y: 5 },
    ];
    const result = sanitizeAnnotationPolygons([
      { id: 'a', points: square, classId: 'cls-1' },
      { id: 'b', points: square, classId: 'cls-2' },
    ]);
    expect(result.map(p => p.classId)).toEqual(['cls-1', 'cls-2']);
  });

  it('drops a polygon with fewer than 3 valid points', () => {
    const result = sanitizeAnnotationPolygons([
      {
        id: 'a',
        points: [
          { x: 0, y: 0 },
          { x: 1, y: 1 },
        ],
      },
    ]);
    expect(result).toEqual([]);
  });

  it('drops non-finite / non-numeric points but keeps the polygon if enough valid ones remain', () => {
    const result = sanitizeAnnotationPolygons([
      {
        id: 'a',
        points: [
          { x: 0, y: 0 },
          { x: NaN, y: 1 }, // dropped
          { x: 1, y: 1 },
          { x: 2, y: 2 },
        ],
      },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].points).toHaveLength(3);
  });

  it('generates a fresh id when missing or empty', () => {
    const result = sanitizeAnnotationPolygons([
      {
        points: [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
          { x: 1, y: 1 },
        ],
      },
      {
        id: '',
        points: [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
          { x: 1, y: 1 },
        ],
      },
    ]);
    expect(result[0].id).toMatch(/^[0-9a-f-]{36}$/);
    expect(result[1].id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('drops classId/instanceId when not a non-empty string', () => {
    const result = sanitizeAnnotationPolygons([
      {
        id: 'a',
        points: [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
          { x: 1, y: 1 },
        ],
        classId: 42,
        instanceId: '',
      },
    ]);
    expect(result[0].classId).toBeUndefined();
    expect(result[0].instanceId).toBeUndefined();
  });

  it('returns [] for non-array input', () => {
    expect(sanitizeAnnotationPolygons(null)).toEqual([]);
    expect(sanitizeAnnotationPolygons('garbage')).toEqual([]);
    expect(sanitizeAnnotationPolygons(undefined)).toEqual([]);
  });
});

// ===========================================================================
// Annotation upsert + overlapping-polygon round trip
// ===========================================================================

describe('annotation upsert + round trip', () => {
  beforeEach(() => {
    prismaMock.segmenterImage.findFirst.mockResolvedValue({
      id: IMAGE_ID,
      datasetId: DATASET_ID,
      storagePath: makeImage().storagePath,
    });
  });

  it('upserts on imageId and stores the sanitized polygons as a JSON string', async () => {
    prismaMock.segmenterAnnotation.upsert.mockResolvedValue({});

    const square = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
    ];
    const result = await upsertAnnotation(USER_ID, IMAGE_ID, {
      polygons: [
        { id: 'p1', points: square, classId: 'cls-1' },
        { id: 'p2', points: square, classId: 'cls-1' }, // fully overlapping, same class
      ],
      imageWidth: 800,
      imageHeight: 600,
    });

    expect(prismaMock.segmenterAnnotation.upsert).toHaveBeenCalledWith({
      where: { imageId: IMAGE_ID },
      create: {
        imageId: IMAGE_ID,
        polygons: JSON.stringify(result.polygons),
        imageWidth: 800,
        imageHeight: 600,
      },
      update: {
        polygons: JSON.stringify(result.polygons),
        imageWidth: 800,
        imageHeight: 600,
      },
    });
    expect(result.polygons).toHaveLength(2);
  });

  it('round-trips overlapping polygons through upsert → get unchanged', async () => {
    prismaMock.segmenterAnnotation.upsert.mockResolvedValue({});

    const square = [
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      { x: 20, y: 20 },
      { x: 0, y: 20 },
    ];
    const input = [
      { id: 'p1', points: square, classId: 'cls-a', instanceId: 'inst-1' },
      { id: 'p2', points: square, classId: 'cls-a', instanceId: 'inst-2' }, // same class, same geometry
      { id: 'p3', points: square, classId: 'cls-b' }, // different class, same geometry
    ];

    const saved = await upsertAnnotation(USER_ID, IMAGE_ID, {
      polygons: input,
      imageWidth: 1024,
      imageHeight: 768,
    });

    // Capture exactly what was persisted, then feed it back through a GET —
    // this is the round-trip: what's read back must equal what was sanitized
    // and stored, with all 3 overlapping polygons intact.
    const persistedJson = prismaMock.segmenterAnnotation.upsert.mock.calls[0][0]
      .create.polygons as string;

    prismaMock.segmenterImage.findFirst.mockResolvedValue({
      id: IMAGE_ID,
      width: 1024,
      height: 768,
      annotation: {
        polygons: persistedJson,
        imageWidth: 1024,
        imageHeight: 768,
      },
    });

    const reloaded = await getAnnotation(USER_ID, IMAGE_ID);

    expect(reloaded.polygons).toEqual(saved.polygons);
    expect(reloaded.polygons).toHaveLength(3);
    expect(reloaded.polygons.every(p => p.points.length === 4)).toBe(true);
    expect(reloaded.polygons[0].classId).toBe('cls-a');
    expect(reloaded.polygons[1].classId).toBe('cls-a');
    expect(reloaded.polygons[2].classId).toBe('cls-b');
    expect(reloaded.imageWidth).toBe(1024);
    expect(reloaded.imageHeight).toBe(768);
  });

  it('getAnnotation returns an empty polygon set + the image dims when no annotation exists yet', async () => {
    prismaMock.segmenterImage.findFirst.mockResolvedValue({
      id: IMAGE_ID,
      width: 640,
      height: 480,
      annotation: null,
    });
    const result = await getAnnotation(USER_ID, IMAGE_ID);
    expect(result).toEqual({ polygons: [], imageWidth: 640, imageHeight: 480 });
  });
});

// ===========================================================================
// Image upload — storage key + partial-failure tolerance
// ===========================================================================

describe('uploadImages', () => {
  beforeEach(() => {
    prismaMock.segmenterDataset.findFirst.mockResolvedValue(makeDataset());
  });

  it('builds a dataset/image-scoped storage key and persists the DB row', async () => {
    storageMock.upload.mockResolvedValue({
      originalPath: 'ignored-by-assertion',
      fileSize: 123,
      mimeType: 'image/png',
      width: 100,
      height: 200,
    });
    prismaMock.segmenterImage.create.mockImplementation(({ data }) =>
      Promise.resolve({ ...data })
    );

    const files: SegmenterImageUploadInput[] = [
      {
        originalname: 'cell.png',
        buffer: Buffer.from('x'),
        mimetype: 'image/png',
        size: 1,
      },
    ];
    const [uploaded] = await uploadImages(USER_ID, DATASET_ID, files);

    const [, key] = storageMock.upload.mock.calls[0];
    expect(key).toMatch(
      new RegExp(
        `^projects/segmenter/${DATASET_ID}/images/[0-9a-f-]{36}/original\\.png$`
      )
    );
    expect(uploaded.name).toBe('cell.png');
    expect(uploaded.width).toBe(100);
    expect(uploaded.height).toBe(200);
    expect(uploaded.hasAnnotation).toBe(false);
  });

  it('tolerates a per-file failure and still returns the successful uploads', async () => {
    storageMock.upload
      .mockRejectedValueOnce(new Error('disk full'))
      .mockResolvedValueOnce({
        originalPath: 'ok',
        fileSize: 1,
        mimeType: 'image/png',
      });
    prismaMock.segmenterImage.create.mockImplementation(({ data }) =>
      Promise.resolve({ ...data })
    );

    const files: SegmenterImageUploadInput[] = [
      {
        originalname: 'bad.png',
        buffer: Buffer.from('x'),
        mimetype: 'image/png',
        size: 1,
      },
      {
        originalname: 'good.png',
        buffer: Buffer.from('x'),
        mimetype: 'image/png',
        size: 1,
      },
    ];
    const uploaded = await uploadImages(USER_ID, DATASET_ID, files);

    expect(uploaded).toHaveLength(1);
    expect(uploaded[0].name).toBe('good.png');
  });

  it('throws INVALID_INPUT when every file fails', async () => {
    storageMock.upload.mockRejectedValue(new Error('disk full'));
    const files: SegmenterImageUploadInput[] = [
      {
        originalname: 'bad.png',
        buffer: Buffer.from('x'),
        mimetype: 'image/png',
        size: 1,
      },
    ];
    await expect(
      uploadImages(USER_ID, DATASET_ID, files)
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });
});

// ===========================================================================
// Deletion cleans up storage best-effort
// ===========================================================================

describe('deletion storage cleanup', () => {
  it('deleteImage deletes the DB row even if storage.delete fails', async () => {
    prismaMock.segmenterImage.findFirst.mockResolvedValue(makeImage());
    prismaMock.segmenterImage.delete.mockResolvedValue({});
    storageMock.delete.mockRejectedValue(new Error('ENOENT'));

    await expect(deleteImage(USER_ID, IMAGE_ID)).resolves.toBeUndefined();
    expect(prismaMock.segmenterImage.delete).toHaveBeenCalledWith({
      where: { id: IMAGE_ID },
    });
  });

  it('deleteDataset removes the DB row and best-effort deletes every image file', async () => {
    prismaMock.segmenterDataset.findFirst.mockResolvedValue(makeDataset());
    prismaMock.segmenterImage.findMany.mockResolvedValue([
      { storagePath: 'p1' },
      { storagePath: 'p2' },
    ]);
    prismaMock.segmenterDataset.delete.mockResolvedValue({});
    storageMock.delete.mockResolvedValue(undefined);

    await deleteDataset(USER_ID, DATASET_ID);

    expect(prismaMock.segmenterDataset.delete).toHaveBeenCalledWith({
      where: { id: DATASET_ID },
    });
    expect(storageMock.delete).toHaveBeenCalledWith('p1');
    expect(storageMock.delete).toHaveBeenCalledWith('p2');
  });
});
