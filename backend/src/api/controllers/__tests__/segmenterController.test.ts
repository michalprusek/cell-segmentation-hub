/**
 * SegmenterController tests — 0% covered, full behavioral suite.
 *
 * Tests: success paths, auth guard (401), SegmenterError code mapping
 * (404/400/500 default), service arg pass-through, the uploadImages
 * "no files" 400 branch, and serveImageFile's header-setting +
 * sanitized-filename branch.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';

// ── CRITICAL: config mock must come before any module that imports it ──────
vi.mock('../../../utils/config', () => ({
  config: {
    NODE_ENV: 'test',
    PORT: 3001,
    HOST: 'localhost',
    DATABASE_URL: 'file:./test.db',
    JWT_ACCESS_SECRET: 'test-access-secret-for-testing-only-32-characters-long',
    JWT_REFRESH_SECRET:
      'test-refresh-secret-for-testing-only-32-characters-long',
    JWT_ACCESS_EXPIRY: '15m',
    JWT_REFRESH_EXPIRY: '7d',
    JWT_REFRESH_EXPIRY_REMEMBER: '30d',
    ALLOWED_ORIGINS: 'http://localhost:3000',
    WS_ALLOWED_ORIGINS: 'http://localhost:3000',
    UPLOAD_DIR: './test-uploads',
    MAX_FILE_SIZE: 10485760,
    STORAGE_TYPE: 'local',
    SESSION_SECRET: 'test-session-secret',
    REDIS_URL: 'redis://localhost:6379',
    SEGMENTATION_SERVICE_URL: 'http://localhost:8000',
    FROM_EMAIL: 'test@example.com',
    FROM_NAME: 'Test Platform',
    EMAIL_SERVICE: 'none',
    REQUIRE_EMAIL_VERIFICATION: false,
  },
  isDevelopment: false,
  isProduction: false,
  isTest: true,
  getOrigins: () => ['http://localhost:3000'],
}));

vi.mock('../../../utils/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

// Mock the SegmenterService functions but keep the REAL SegmenterError class
// so instanceof checks in handleSegmenterError() work correctly.
vi.mock('../../../services/segmenterService', async importOriginal => {
  const real =
    await importOriginal<typeof import('../../../services/segmenterService')>();
  return {
    ...real,
    createDataset: vi.fn(),
    listDatasets: vi.fn(),
    getDataset: vi.fn(),
    deleteDataset: vi.fn(),
    uploadImages: vi.fn(),
    deleteImage: vi.fn(),
    listClasses: vi.fn(),
    createClass: vi.fn(),
    updateClass: vi.fn(),
    deleteClass: vi.fn(),
    getImageFile: vi.fn(),
    getAnnotation: vi.fn(),
    upsertAnnotation: vi.fn(),
  };
});

import * as SegmenterService from '../../../services/segmenterService';
import { SegmenterError } from '../../../services/segmenterService';
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
  serveImageFile,
} from '../segmenterController';

const MockedSegmenterService = vi.mocked(SegmenterService, true);

// ── Helpers ────────────────────────────────────────────────────────────────

const USER = { id: 'user-uuid-1', email: 'user@test.com' };
const DATASET_ID = 'dataset-uuid-1';
const IMAGE_ID = 'image-uuid-1';
const CLASS_ID = 'class-uuid-1';

const DATASET_DTO = {
  id: DATASET_ID,
  userId: USER.id,
  name: 'My Dataset',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const CLASS_DTO = {
  id: CLASS_ID,
  datasetId: DATASET_ID,
  name: 'Cell',
  color: '#ff0000',
  createdAt: new Date().toISOString(),
};

function buildApp(
  handler: express.RequestHandler,
  path: string,
  authenticated = true
) {
  const app = express();
  app.use(express.json());
  if (authenticated) {
    app.use((req: express.Request & { user?: unknown }, _res, next) => {
      req.user = USER;
      next();
    });
  }
  // Wire all verbs so we can use any HTTP method in tests
  app.get(path, handler);
  app.post(path, handler);
  app.put(path, handler);
  app.delete(path, handler);
  return app;
}

/** Dedicated builder for uploadImages — injects `req.files` directly instead
 *  of running real multer, mirroring how the route wires multer output. */
function buildUploadApp(
  files: unknown,
  authenticated = true
) {
  const app = express();
  app.use(express.json());
  if (authenticated) {
    app.use((req: express.Request & { user?: unknown }, _res, next) => {
      req.user = USER;
      next();
    });
  }
  app.post(
    '/datasets/:id/images',
    (req: express.Request & { files?: unknown }, _res, next) => {
      req.files = files;
      next();
    },
    uploadImages
  );
  return app;
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('SegmenterController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── createDataset ──────────────────────────────────────────────────────

  describe('createDataset', () => {
    it('returns 401 when unauthenticated', async () => {
      const app = buildApp(createDataset, '/datasets', false);
      const res = await request(app)
        .post('/datasets')
        .send({ name: 'New Dataset' })
        .expect(401);
      expect(res.body.success).toBe(false);
      expect(MockedSegmenterService.createDataset).not.toHaveBeenCalled();
    });

    it('returns 201 with the created dataset on success', async () => {
      MockedSegmenterService.createDataset.mockResolvedValue(
        DATASET_DTO as any
      );

      const app = buildApp(createDataset, '/datasets');
      const res = await request(app)
        .post('/datasets')
        .send({ name: 'My Dataset' })
        .expect(201);

      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe(DATASET_ID);
      expect(MockedSegmenterService.createDataset).toHaveBeenCalledWith(
        USER.id,
        'My Dataset'
      );
    });

    it('returns 400 when name is invalid (INVALID_INPUT)', async () => {
      MockedSegmenterService.createDataset.mockRejectedValue(
        new SegmenterError('INVALID_INPUT', 'Název datasetu je povinný')
      );

      const app = buildApp(createDataset, '/datasets');
      const res = await request(app)
        .post('/datasets')
        .send({ name: '' })
        .expect(400);
      expect(res.body.success).toBe(false);
    });

    it('returns 500 on unexpected service error', async () => {
      MockedSegmenterService.createDataset.mockRejectedValue(
        new Error('DB connection lost')
      );

      const app = buildApp(createDataset, '/datasets');
      const res = await request(app)
        .post('/datasets')
        .send({ name: 'X' })
        .expect(500);
      expect(res.body.success).toBe(false);
    });
  });

  // ── listDatasets ───────────────────────────────────────────────────────

  describe('listDatasets', () => {
    it('returns 401 when unauthenticated', async () => {
      const app = buildApp(listDatasets, '/datasets', false);
      const res = await request(app).get('/datasets').expect(401);
      expect(res.body.success).toBe(false);
    });

    it('returns 200 with the dataset list on success', async () => {
      MockedSegmenterService.listDatasets.mockResolvedValue([
        { ...DATASET_DTO, imageCount: 3 } as any,
      ]);

      const app = buildApp(listDatasets, '/datasets');
      const res = await request(app).get('/datasets').expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].imageCount).toBe(3);
      expect(MockedSegmenterService.listDatasets).toHaveBeenCalledWith(
        USER.id
      );
    });

    it('returns 500 on unexpected service error', async () => {
      MockedSegmenterService.listDatasets.mockRejectedValue(
        new Error('DB connection lost')
      );

      const app = buildApp(listDatasets, '/datasets');
      const res = await request(app).get('/datasets').expect(500);
      expect(res.body.success).toBe(false);
    });
  });

  // ── getDataset ─────────────────────────────────────────────────────────

  describe('getDataset', () => {
    it('returns 401 when unauthenticated', async () => {
      const app = buildApp(getDataset, '/datasets/:id', false);
      const res = await request(app)
        .get(`/datasets/${DATASET_ID}`)
        .expect(401);
      expect(res.body.success).toBe(false);
    });

    it('returns 200 with the dataset detail on success', async () => {
      MockedSegmenterService.getDataset.mockResolvedValue({
        ...DATASET_DTO,
        images: [],
        classes: [],
      } as any);

      const app = buildApp(getDataset, '/datasets/:id');
      const res = await request(app)
        .get(`/datasets/${DATASET_ID}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe(DATASET_ID);
      expect(MockedSegmenterService.getDataset).toHaveBeenCalledWith(
        USER.id,
        DATASET_ID
      );
    });

    it('returns 404 when dataset is not found (NOT_FOUND)', async () => {
      MockedSegmenterService.getDataset.mockRejectedValue(
        new SegmenterError('NOT_FOUND', 'Dataset nebyl nalezen')
      );

      const app = buildApp(getDataset, '/datasets/:id');
      const res = await request(app)
        .get(`/datasets/${DATASET_ID}`)
        .expect(404);
      expect(res.body.success).toBe(false);
    });
  });

  // ── deleteDataset ──────────────────────────────────────────────────────

  describe('deleteDataset', () => {
    it('returns 401 when unauthenticated', async () => {
      const app = buildApp(deleteDataset, '/datasets/:id', false);
      const res = await request(app)
        .delete(`/datasets/${DATASET_ID}`)
        .expect(401);
      expect(res.body.success).toBe(false);
    });

    it('returns 200 when dataset is deleted successfully', async () => {
      MockedSegmenterService.deleteDataset.mockResolvedValue(undefined);

      const app = buildApp(deleteDataset, '/datasets/:id');
      const res = await request(app)
        .delete(`/datasets/${DATASET_ID}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(MockedSegmenterService.deleteDataset).toHaveBeenCalledWith(
        USER.id,
        DATASET_ID
      );
    });

    it('returns 404 when dataset is not found (NOT_FOUND)', async () => {
      MockedSegmenterService.deleteDataset.mockRejectedValue(
        new SegmenterError('NOT_FOUND', 'Dataset nebyl nalezen')
      );

      const app = buildApp(deleteDataset, '/datasets/:id');
      const res = await request(app)
        .delete(`/datasets/${DATASET_ID}`)
        .expect(404);
      expect(res.body.success).toBe(false);
    });
  });

  // ── uploadImages ───────────────────────────────────────────────────────

  describe('uploadImages', () => {
    it('returns 401 when unauthenticated', async () => {
      const app = buildUploadApp(
        [{ originalname: 'a.png', buffer: Buffer.from('x'), mimetype: 'image/png', size: 1 }],
        false
      );
      const res = await request(app)
        .post(`/datasets/${DATASET_ID}/images`)
        .expect(401);
      expect(res.body.success).toBe(false);
      expect(MockedSegmenterService.uploadImages).not.toHaveBeenCalled();
    });

    it('returns 400 when req.files is undefined (no files field)', async () => {
      const app = buildUploadApp(undefined);
      const res = await request(app)
        .post(`/datasets/${DATASET_ID}/images`)
        .expect(400);
      expect(res.body.success).toBe(false);
      expect(MockedSegmenterService.uploadImages).not.toHaveBeenCalled();
    });

    it('returns 400 when req.files is an empty array', async () => {
      const app = buildUploadApp([]);
      const res = await request(app)
        .post(`/datasets/${DATASET_ID}/images`)
        .expect(400);
      expect(res.body.success).toBe(false);
      expect(MockedSegmenterService.uploadImages).not.toHaveBeenCalled();
    });

    it('returns 201 with the upload result on success', async () => {
      MockedSegmenterService.uploadImages.mockResolvedValue({
        images: [
          {
            id: 'img-1',
            datasetId: DATASET_ID,
            name: 'a.png',
            storagePath: 'projects/segmenter/x/images/img-1/original.png',
            thumbnailPath: null,
            width: 100,
            height: 100,
            createdAt: new Date(),
            hasAnnotation: false,
          },
        ],
        failedCount: 0,
        failedNames: [],
      } as any);

      const files = [
        {
          originalname: 'a.png',
          buffer: Buffer.from('image-bytes'),
          mimetype: 'image/png',
          size: 11,
        },
      ];
      const app = buildUploadApp(files);
      const res = await request(app)
        .post(`/datasets/${DATASET_ID}/images`)
        .expect(201);

      expect(res.body.success).toBe(true);
      expect(res.body.data.failedCount).toBe(0);
      expect(MockedSegmenterService.uploadImages).toHaveBeenCalledWith(
        USER.id,
        DATASET_ID,
        [
          {
            originalname: 'a.png',
            buffer: files[0].buffer,
            mimetype: 'image/png',
            size: 11,
          },
        ]
      );
    });

    it('returns 404 when dataset is not found (NOT_FOUND)', async () => {
      MockedSegmenterService.uploadImages.mockRejectedValue(
        new SegmenterError('NOT_FOUND', 'Dataset nebyl nalezen')
      );

      const files = [
        {
          originalname: 'a.png',
          buffer: Buffer.from('image-bytes'),
          mimetype: 'image/png',
          size: 11,
        },
      ];
      const app = buildUploadApp(files);
      const res = await request(app)
        .post(`/datasets/${DATASET_ID}/images`)
        .expect(404);
      expect(res.body.success).toBe(false);
    });
  });

  // ── deleteImage ────────────────────────────────────────────────────────

  describe('deleteImage', () => {
    it('returns 401 when unauthenticated', async () => {
      const app = buildApp(deleteImage, '/images/:imageId', false);
      const res = await request(app)
        .delete(`/images/${IMAGE_ID}`)
        .expect(401);
      expect(res.body.success).toBe(false);
    });

    it('returns 200 when image is deleted successfully', async () => {
      MockedSegmenterService.deleteImage.mockResolvedValue(undefined);

      const app = buildApp(deleteImage, '/images/:imageId');
      const res = await request(app)
        .delete(`/images/${IMAGE_ID}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(MockedSegmenterService.deleteImage).toHaveBeenCalledWith(
        USER.id,
        IMAGE_ID
      );
    });

    it('returns 404 when image is not found (NOT_FOUND)', async () => {
      MockedSegmenterService.deleteImage.mockRejectedValue(
        new SegmenterError('NOT_FOUND', 'Obrázek nebyl nalezen')
      );

      const app = buildApp(deleteImage, '/images/:imageId');
      const res = await request(app)
        .delete(`/images/${IMAGE_ID}`)
        .expect(404);
      expect(res.body.success).toBe(false);
    });
  });

  // ── listClasses ────────────────────────────────────────────────────────

  describe('listClasses', () => {
    it('returns 401 when unauthenticated', async () => {
      const app = buildApp(listClasses, '/datasets/:id/classes', false);
      const res = await request(app)
        .get(`/datasets/${DATASET_ID}/classes`)
        .expect(401);
      expect(res.body.success).toBe(false);
    });

    it('returns 200 with the class list on success', async () => {
      MockedSegmenterService.listClasses.mockResolvedValue([
        CLASS_DTO as any,
      ]);

      const app = buildApp(listClasses, '/datasets/:id/classes');
      const res = await request(app)
        .get(`/datasets/${DATASET_ID}/classes`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.classes).toHaveLength(1);
      expect(MockedSegmenterService.listClasses).toHaveBeenCalledWith(
        USER.id,
        DATASET_ID
      );
    });

    it('returns 404 when dataset is not found (NOT_FOUND)', async () => {
      MockedSegmenterService.listClasses.mockRejectedValue(
        new SegmenterError('NOT_FOUND', 'Dataset nebyl nalezen')
      );

      const app = buildApp(listClasses, '/datasets/:id/classes');
      const res = await request(app)
        .get(`/datasets/${DATASET_ID}/classes`)
        .expect(404);
      expect(res.body.success).toBe(false);
    });
  });

  // ── createClass ────────────────────────────────────────────────────────

  describe('createClass', () => {
    it('returns 401 when unauthenticated', async () => {
      const app = buildApp(createClass, '/datasets/:id/classes', false);
      const res = await request(app)
        .post(`/datasets/${DATASET_ID}/classes`)
        .send({ name: 'Cell', color: '#ff0000' })
        .expect(401);
      expect(res.body.success).toBe(false);
    });

    it('returns 201 with the updated class list on success', async () => {
      MockedSegmenterService.createClass.mockResolvedValue([
        CLASS_DTO as any,
      ]);

      const app = buildApp(createClass, '/datasets/:id/classes');
      const res = await request(app)
        .post(`/datasets/${DATASET_ID}/classes`)
        .send({ name: 'Cell', color: '#ff0000' })
        .expect(201);

      expect(res.body.success).toBe(true);
      expect(res.body.data.classes).toHaveLength(1);
      expect(MockedSegmenterService.createClass).toHaveBeenCalledWith(
        USER.id,
        DATASET_ID,
        { name: 'Cell', color: '#ff0000' }
      );
    });

    it('returns 404 when dataset is not found (NOT_FOUND)', async () => {
      MockedSegmenterService.createClass.mockRejectedValue(
        new SegmenterError('NOT_FOUND', 'Dataset nebyl nalezen')
      );

      const app = buildApp(createClass, '/datasets/:id/classes');
      const res = await request(app)
        .post(`/datasets/${DATASET_ID}/classes`)
        .send({ name: 'Cell', color: '#ff0000' })
        .expect(404);
      expect(res.body.success).toBe(false);
    });
  });

  // ── updateClass ────────────────────────────────────────────────────────

  describe('updateClass', () => {
    const path = '/datasets/:id/classes/:classId';
    const url = `/datasets/${DATASET_ID}/classes/${CLASS_ID}`;

    it('returns 401 when unauthenticated', async () => {
      const app = buildApp(updateClass, path, false);
      const res = await request(app)
        .put(url)
        .send({ name: 'Renamed' })
        .expect(401);
      expect(res.body.success).toBe(false);
    });

    it('returns 200 with the updated class list on success', async () => {
      MockedSegmenterService.updateClass.mockResolvedValue([
        { ...CLASS_DTO, name: 'Renamed' } as any,
      ]);

      const app = buildApp(updateClass, path);
      const res = await request(app)
        .put(url)
        .send({ name: 'Renamed' })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.classes[0].name).toBe('Renamed');
      expect(MockedSegmenterService.updateClass).toHaveBeenCalledWith(
        USER.id,
        DATASET_ID,
        CLASS_ID,
        { name: 'Renamed' }
      );
    });

    it('returns 404 when class is not found (NOT_FOUND)', async () => {
      MockedSegmenterService.updateClass.mockRejectedValue(
        new SegmenterError('NOT_FOUND', 'Třída nebyla nalezena')
      );

      const app = buildApp(updateClass, path);
      const res = await request(app)
        .put(url)
        .send({ name: 'Renamed' })
        .expect(404);
      expect(res.body.success).toBe(false);
    });
  });

  // ── deleteClass ────────────────────────────────────────────────────────

  describe('deleteClass', () => {
    const path = '/datasets/:id/classes/:classId';
    const url = `/datasets/${DATASET_ID}/classes/${CLASS_ID}`;

    it('returns 401 when unauthenticated', async () => {
      const app = buildApp(deleteClass, path, false);
      const res = await request(app).delete(url).expect(401);
      expect(res.body.success).toBe(false);
    });

    it('returns 200 with the surviving class list on success', async () => {
      MockedSegmenterService.deleteClass.mockResolvedValue({
        classes: [],
        imagesCleaned: 2,
      } as any);

      const app = buildApp(deleteClass, path);
      const res = await request(app).delete(url).expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.imagesCleaned).toBe(2);
      expect(MockedSegmenterService.deleteClass).toHaveBeenCalledWith(
        USER.id,
        DATASET_ID,
        CLASS_ID
      );
    });

    it('returns 404 when class is not found (NOT_FOUND)', async () => {
      MockedSegmenterService.deleteClass.mockRejectedValue(
        new SegmenterError('NOT_FOUND', 'Třída nebyla nalezena')
      );

      const app = buildApp(deleteClass, path);
      const res = await request(app).delete(url).expect(404);
      expect(res.body.success).toBe(false);
    });
  });

  // ── getAnnotation ──────────────────────────────────────────────────────

  describe('getAnnotation', () => {
    const path = '/images/:imageId/annotations';
    const url = `/images/${IMAGE_ID}/annotations`;

    it('returns 401 when unauthenticated', async () => {
      const app = buildApp(getAnnotation, path, false);
      const res = await request(app).get(url).expect(401);
      expect(res.body.success).toBe(false);
    });

    it('returns 200 with the annotation on success', async () => {
      MockedSegmenterService.getAnnotation.mockResolvedValue({
        polygons: [],
        imageWidth: 800,
        imageHeight: 600,
      });

      const app = buildApp(getAnnotation, path);
      const res = await request(app).get(url).expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.imageWidth).toBe(800);
      expect(MockedSegmenterService.getAnnotation).toHaveBeenCalledWith(
        USER.id,
        IMAGE_ID
      );
    });

    it('returns 404 when image is not found (NOT_FOUND)', async () => {
      MockedSegmenterService.getAnnotation.mockRejectedValue(
        new SegmenterError('NOT_FOUND', 'Obrázek nebyl nalezen')
      );

      const app = buildApp(getAnnotation, path);
      const res = await request(app).get(url).expect(404);
      expect(res.body.success).toBe(false);
    });
  });

  // ── upsertAnnotation ───────────────────────────────────────────────────

  describe('upsertAnnotation', () => {
    const path = '/images/:imageId/annotations';
    const url = `/images/${IMAGE_ID}/annotations`;
    const body = {
      polygons: [{ id: 'p1', points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }] }],
      imageWidth: 800,
      imageHeight: 600,
    };

    it('returns 401 when unauthenticated', async () => {
      const app = buildApp(upsertAnnotation, path, false);
      const res = await request(app).put(url).send(body).expect(401);
      expect(res.body.success).toBe(false);
    });

    it('returns 200 with the saved annotation on success', async () => {
      MockedSegmenterService.upsertAnnotation.mockResolvedValue({
        polygons: body.polygons as any,
        imageWidth: body.imageWidth,
        imageHeight: body.imageHeight,
      });

      const app = buildApp(upsertAnnotation, path);
      const res = await request(app).put(url).send(body).expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.polygons).toHaveLength(1);
      expect(MockedSegmenterService.upsertAnnotation).toHaveBeenCalledWith(
        USER.id,
        IMAGE_ID,
        {
          polygons: body.polygons,
          imageWidth: body.imageWidth,
          imageHeight: body.imageHeight,
        }
      );
    });

    it('returns 404 when image is not found (NOT_FOUND)', async () => {
      MockedSegmenterService.upsertAnnotation.mockRejectedValue(
        new SegmenterError('NOT_FOUND', 'Obrázek nebyl nalezen')
      );

      const app = buildApp(upsertAnnotation, path);
      const res = await request(app).put(url).send(body).expect(404);
      expect(res.body.success).toBe(false);
    });
  });

  // ── serveImageFile ─────────────────────────────────────────────────────

  describe('serveImageFile', () => {
    const path = '/images/:imageId/file';
    const url = `/images/${IMAGE_ID}/file`;

    it('returns 401 when unauthenticated', async () => {
      const app = buildApp(serveImageFile, path, false);
      const res = await request(app).get(url).expect(401);
      expect(res.body.success).toBe(false);
    });

    it('sets Content-Type/Content-Disposition/ETag and sends the buffer on success', async () => {
      const buffer = Buffer.from('fake-png-bytes');
      MockedSegmenterService.getImageFile.mockResolvedValue({
        buffer,
        mimeType: 'image/png',
        filename: 'photo.png',
      });

      const app = buildApp(serveImageFile, path);
      const res = await request(app).get(url).expect(200);

      expect(res.headers['content-type']).toBe('image/png');
      expect(res.headers['content-length']).toBe(String(buffer.length));
      expect(res.headers['etag']).toBe(`"${IMAGE_ID}"`);
      expect(res.headers['content-disposition']).toBe(
        'inline; filename="photo.png"'
      );
      expect(MockedSegmenterService.getImageFile).toHaveBeenCalledWith(
        USER.id,
        IMAGE_ID
      );
    });

    it('strips quote/CR/LF characters from the filename before use in Content-Disposition', async () => {
      const buffer = Buffer.from('fake-png-bytes');
      MockedSegmenterService.getImageFile.mockResolvedValue({
        buffer,
        mimeType: 'image/png',
        filename: 'weird"name\r\n.png',
      });

      const app = buildApp(serveImageFile, path);
      const res = await request(app).get(url).expect(200);

      expect(res.headers['content-disposition']).toBe(
        'inline; filename="weird_name__.png"'
      );
    });

    it('returns 404 when image is not found (NOT_FOUND)', async () => {
      MockedSegmenterService.getImageFile.mockRejectedValue(
        new SegmenterError('NOT_FOUND', 'Obrázek nebyl nalezen')
      );

      const app = buildApp(serveImageFile, path);
      const res = await request(app).get(url).expect(404);
      expect(res.body.success).toBe(false);
    });
  });
});
