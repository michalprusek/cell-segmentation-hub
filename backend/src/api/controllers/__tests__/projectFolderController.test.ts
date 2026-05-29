/**
 * ProjectFolderController tests — 0% covered, full behavioral suite.
 *
 * Tests: success paths, auth guard (401), FolderError code mapping
 * (404/409/400/207), and service arg pass-through.
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

// Mock the FolderService functions but keep the REAL FolderError class so
// instanceof checks in handleFolderError() work correctly.
vi.mock('../../../services/projectFolderService', async importOriginal => {
  const real =
    await importOriginal<
      typeof import('../../../services/projectFolderService')
    >();
  return {
    ...real,
    listUserFolders: vi.fn(),
    createFolder: vi.fn(),
    updateFolder: vi.fn(),
    deleteFolder: vi.fn(),
    getFolderContentsPreview: vi.fn(),
    moveProjectsToFolder: vi.fn(),
  };
});

import * as FolderService from '../../../services/projectFolderService';
import { FolderError } from '../../../services/projectFolderService';
import {
  listFolders,
  createFolder,
  updateFolder,
  deleteFolder,
  previewFolder,
  moveProjectsToFolder,
} from '../projectFolderController';

const MockedFolderService = vi.mocked(FolderService, true);

// ── Helpers ────────────────────────────────────────────────────────────────

const USER = { id: 'user-uuid-1', email: 'user@test.com' };
const FOLDER_ID = 'folder-uuid-1';
const PROJECT_ID = 'project-uuid-1';

const FOLDER_DTO = {
  id: FOLDER_ID,
  name: 'My Folder',
  userId: USER.id,
  parentId: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

function buildApp(
  handler: express.RequestHandler,
  authenticated = true,
  paramName?: string
) {
  const app = express();
  app.use(express.json());
  if (authenticated) {
    app.use((req: express.Request & { user?: unknown }, _res, next) => {
      req.user = USER;
      next();
    });
  }
  const path = paramName ? `/:${paramName}` : '/';
  // Wire all verbs so we can use any HTTP method in tests
  app.get(path, handler);
  app.post(path, handler);
  app.put(path, handler);
  app.patch(path, handler);
  app.delete(path, handler);
  return app;
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('ProjectFolderController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── listFolders ───────────────────────────────────────────────────────────

  describe('listFolders', () => {
    it('returns 401 when unauthenticated', async () => {
      const app = buildApp(listFolders, false);
      const res = await request(app).get('/').expect(401);
      expect(res.body.success).toBe(false);
    });

    it('returns 200 with folder list on success', async () => {
      MockedFolderService.listUserFolders.mockResolvedValue([
        FOLDER_DTO as any,
      ]);

      const app = buildApp(listFolders);
      const res = await request(app).get('/').expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].id).toBe(FOLDER_ID);
      expect(MockedFolderService.listUserFolders).toHaveBeenCalledWith(USER.id);
    });

    it('returns 500 on unexpected service error', async () => {
      MockedFolderService.listUserFolders.mockRejectedValue(
        new Error('DB connection lost')
      );

      const app = buildApp(listFolders);
      const res = await request(app).get('/').expect(500);
      expect(res.body.success).toBe(false);
    });
  });

  // ── createFolder ──────────────────────────────────────────────────────────

  describe('createFolder', () => {
    it('returns 401 when unauthenticated', async () => {
      const app = buildApp(createFolder, false);
      const res = await request(app)
        .post('/')
        .send({ name: 'New Folder' })
        .expect(401);
      expect(res.body.success).toBe(false);
    });

    it('returns 201 with the created folder', async () => {
      MockedFolderService.createFolder.mockResolvedValue(FOLDER_DTO as any);

      const app = buildApp(createFolder);
      const res = await request(app)
        .post('/')
        .send({ name: 'My Folder' })
        .expect(201);

      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe(FOLDER_ID);
      expect(MockedFolderService.createFolder).toHaveBeenCalledWith(
        USER.id,
        expect.objectContaining({ name: 'My Folder' })
      );
    });

    it('returns 400 when name is invalid (INVALID_INPUT)', async () => {
      MockedFolderService.createFolder.mockRejectedValue(
        new FolderError('INVALID_INPUT', 'Název složky je povinný')
      );

      const app = buildApp(createFolder);
      const res = await request(app).post('/').send({ name: '' }).expect(400);
      expect(res.body.success).toBe(false);
    });

    it('returns 409 when name is duplicate (DUPLICATE_NAME)', async () => {
      MockedFolderService.createFolder.mockRejectedValue(
        new FolderError(
          'DUPLICATE_NAME',
          'Folder with this name already exists'
        )
      );

      const app = buildApp(createFolder);
      const res = await request(app)
        .post('/')
        .send({ name: 'Existing Folder' })
        .expect(409);
      expect(res.body.success).toBe(false);
    });

    it('returns 404 when parent folder is not found (PARENT_NOT_FOUND)', async () => {
      MockedFolderService.createFolder.mockRejectedValue(
        new FolderError('PARENT_NOT_FOUND', 'Parent folder not found')
      );

      const app = buildApp(createFolder);
      const res = await request(app)
        .post('/')
        .send({ name: 'Child', parentId: 'non-existent' })
        .expect(404);
      expect(res.body.success).toBe(false);
    });
  });

  // ── updateFolder ──────────────────────────────────────────────────────────

  describe('updateFolder', () => {
    it('returns 401 when unauthenticated', async () => {
      const app = buildApp(updateFolder, false, 'id');
      const res = await request(app)
        .put(`/${FOLDER_ID}`)
        .send({ name: 'Renamed' })
        .expect(401);
      expect(res.body.success).toBe(false);
    });

    it('returns 200 with updated folder on success', async () => {
      const updated = { ...FOLDER_DTO, name: 'Renamed' };
      MockedFolderService.updateFolder.mockResolvedValue(updated as any);

      const app = buildApp(updateFolder, true, 'id');
      const res = await request(app)
        .put(`/${FOLDER_ID}`)
        .send({ name: 'Renamed' })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.name).toBe('Renamed');
      expect(MockedFolderService.updateFolder).toHaveBeenCalledWith(
        USER.id,
        FOLDER_ID,
        expect.objectContaining({ name: 'Renamed' })
      );
    });

    it('returns 404 when folder is not found (NOT_FOUND)', async () => {
      MockedFolderService.updateFolder.mockRejectedValue(
        new FolderError('NOT_FOUND', 'Folder not found')
      );

      const app = buildApp(updateFolder, true, 'id');
      const res = await request(app)
        .put(`/${FOLDER_ID}`)
        .send({ name: 'X' })
        .expect(404);
      expect(res.body.success).toBe(false);
    });

    it('returns 400 when move would create a cycle (CYCLE)', async () => {
      MockedFolderService.updateFolder.mockRejectedValue(
        new FolderError('CYCLE', 'Cannot move folder into itself')
      );

      const app = buildApp(updateFolder, true, 'id');
      const res = await request(app)
        .put(`/${FOLDER_ID}`)
        .send({ parentId: FOLDER_ID })
        .expect(400);
      expect(res.body.success).toBe(false);
    });
  });

  // ── deleteFolder ──────────────────────────────────────────────────────────

  describe('deleteFolder', () => {
    it('returns 401 when unauthenticated', async () => {
      const app = buildApp(deleteFolder, false, 'id');
      const res = await request(app).delete(`/${FOLDER_ID}`).expect(401);
      expect(res.body.success).toBe(false);
    });

    it('returns 200 when folder is deleted successfully', async () => {
      MockedFolderService.deleteFolder.mockResolvedValue({
        folderDeleted: true,
        projectsDeleted: 2,
        projectsFailed: 0,
        failedProjectIds: [],
      } as any);

      const app = buildApp(deleteFolder, true, 'id');
      const res = await request(app).delete(`/${FOLDER_ID}`).expect(200);

      expect(res.body.success).toBe(true);
      expect(MockedFolderService.deleteFolder).toHaveBeenCalledWith(
        USER.id,
        FOLDER_ID
      );
    });

    it('returns 207 when some projects could not be deleted (partial failure)', async () => {
      MockedFolderService.deleteFolder.mockResolvedValue({
        folderDeleted: false,
        projectsDeleted: 1,
        projectsFailed: 1,
        failedProjectIds: [PROJECT_ID],
      } as any);

      const app = buildApp(deleteFolder, true, 'id');
      const res = await request(app).delete(`/${FOLDER_ID}`).expect(207);

      expect(res.body.success).toBe(false);
      expect(res.body.code).toBe('PARTIAL_FAILURE');
      expect(res.body.data.failedProjectIds).toContain(PROJECT_ID);
    });

    it('returns 404 when folder is not found', async () => {
      MockedFolderService.deleteFolder.mockRejectedValue(
        new FolderError('NOT_FOUND', 'Složka nebyla nalezena')
      );

      const app = buildApp(deleteFolder, true, 'id');
      const res = await request(app).delete(`/${FOLDER_ID}`).expect(404);
      expect(res.body.success).toBe(false);
    });
  });

  // ── previewFolder ─────────────────────────────────────────────────────────

  describe('previewFolder', () => {
    it('returns 401 when unauthenticated', async () => {
      const app = buildApp(previewFolder, false, 'id');
      const res = await request(app).get(`/${FOLDER_ID}`).expect(401);
      expect(res.body.success).toBe(false);
    });

    it('returns 200 with folder contents preview', async () => {
      const preview = { projectCount: 3, subFolderCount: 1 };
      MockedFolderService.getFolderContentsPreview.mockResolvedValue(
        preview as any
      );

      const app = buildApp(previewFolder, true, 'id');
      const res = await request(app).get(`/${FOLDER_ID}`).expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.projectCount).toBe(3);
      expect(MockedFolderService.getFolderContentsPreview).toHaveBeenCalledWith(
        USER.id,
        FOLDER_ID
      );
    });

    it('returns 404 when folder is not found', async () => {
      MockedFolderService.getFolderContentsPreview.mockRejectedValue(
        new FolderError('NOT_FOUND', 'Složka nebyla nalezena')
      );

      const app = buildApp(previewFolder, true, 'id');
      const res = await request(app).get(`/${FOLDER_ID}`).expect(404);
      expect(res.body.success).toBe(false);
    });
  });

  // ── moveProjectsToFolder ──────────────────────────────────────────────────

  describe('moveProjectsToFolder', () => {
    it('returns 401 when unauthenticated', async () => {
      const app = buildApp(moveProjectsToFolder, false, 'id');
      const res = await request(app)
        .post(`/${FOLDER_ID}`)
        .send({ projectIds: [PROJECT_ID] })
        .expect(401);
      expect(res.body.success).toBe(false);
    });

    it('returns 200 with move result when target is a folder', async () => {
      const result = { moved: 1, skipped: 0 };
      MockedFolderService.moveProjectsToFolder.mockResolvedValue(result as any);

      const app = buildApp(moveProjectsToFolder, true, 'id');
      const res = await request(app)
        .post(`/${FOLDER_ID}`)
        .send({ projectIds: [PROJECT_ID] })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(MockedFolderService.moveProjectsToFolder).toHaveBeenCalledWith(
        USER.id,
        FOLDER_ID, // non-root: folderId passed as-is
        [PROJECT_ID]
      );
    });

    it('passes null as folderId when target is "root"', async () => {
      const result = { moved: 1, skipped: 0 };
      MockedFolderService.moveProjectsToFolder.mockResolvedValue(result as any);

      const app = buildApp(moveProjectsToFolder, true, 'id');
      await request(app)
        .post('/root')
        .send({ projectIds: [PROJECT_ID] })
        .expect(200);

      expect(MockedFolderService.moveProjectsToFolder).toHaveBeenCalledWith(
        USER.id,
        null, // 'root' → null
        [PROJECT_ID]
      );
    });

    it('returns 404 when destination folder is not found (NOT_FOUND)', async () => {
      MockedFolderService.moveProjectsToFolder.mockRejectedValue(
        new FolderError('NOT_FOUND', 'Destination folder not found')
      );

      const app = buildApp(moveProjectsToFolder, true, 'id');
      const res = await request(app)
        .post(`/${FOLDER_ID}`)
        .send({ projectIds: [PROJECT_ID] })
        .expect(404);
      expect(res.body.success).toBe(false);
    });

    it('returns 400 when project is not accessible (PROJECT_NOT_ACCESSIBLE)', async () => {
      MockedFolderService.moveProjectsToFolder.mockRejectedValue(
        new FolderError('PROJECT_NOT_ACCESSIBLE', 'Project is not yours')
      );

      const app = buildApp(moveProjectsToFolder, true, 'id');
      const res = await request(app)
        .post(`/${FOLDER_ID}`)
        .send({ projectIds: [PROJECT_ID] })
        .expect(400);
      expect(res.body.success).toBe(false);
    });

    it('returns 500 on unexpected service error', async () => {
      MockedFolderService.moveProjectsToFolder.mockRejectedValue(
        new Error('Unexpected DB failure')
      );

      const app = buildApp(moveProjectsToFolder, true, 'id');
      const res = await request(app)
        .post(`/${FOLDER_ID}`)
        .send({ projectIds: [PROJECT_ID] })
        .expect(500);
      expect(res.body.success).toBe(false);
    });
  });
});
