/**
 * videoController.test.ts
 *
 * Tests VideoController.upload() and VideoController.getVideoFrames()
 * against real Express routing (supertest), fully mocking:
 *
 *  - prismaClient (user + project + image lookups)
 *  - videoUploadService (uploadVideoFromFile)
 *  - video/videoExtractor (isVideoFilename)
 *  - fs/promises (rm for tmp-file cleanup)
 *  - utils/logger, utils/config  ← critical: config parse calls process.exit(1)
 *  - utils/response  ← ResponseHelper.success / .error
 *
 * Covered paths:
 *  upload():
 *    - 401 when no req.user (assertProjectAccess fails — no userId)
 *    - 401 when DB user not found
 *    - 403 when project not accessible
 *    - 400 when no file uploaded
 *    - 400 when filename is not a recognised video format (isVideoFilename=false)
 *    - 200 happy path: correct {videoContainerId, frameCount, channels} shape
 *    - 500 when uploadVideoFromFile throws
 *    - tmp file cleanup is attempted on validation failures + errors
 *
 *  getVideoFrames():
 *    - 404 when image row not found
 *    - 403 when user has no project access
 *    - 404 when image is not a video container
 *    - 200 happy path: container metadata + frames array
 *    - 500 on Prisma error
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express, { Express } from 'express';

// ---------------------------------------------------------------------------
// Hoisted mocks — must be declared before vi.mock() factories use them
// ---------------------------------------------------------------------------

const {
  prismaUserFindUnique,
  prismaProjectFindFirst,
  prismaImageFindUnique,
  prismaImageFindMany,
  prismaImageUpdate,
  uploadVideoFromFileMock,
  isVideoFilenameMock,
  fsRmMock,
  responseSuccessMock,
  responseErrorMock,
} = vi.hoisted(() => ({
  prismaUserFindUnique: vi.fn(),
  prismaProjectFindFirst: vi.fn(),
  prismaImageFindUnique: vi.fn(),
  prismaImageFindMany: vi.fn(),
  prismaImageUpdate: vi.fn(),
  uploadVideoFromFileMock: vi.fn(),
  isVideoFilenameMock: vi.fn(),
  fsRmMock: vi.fn(),
  responseSuccessMock: vi.fn(),
  responseErrorMock: vi.fn(),
}));

vi.mock('../../db/prismaClient', () => ({
  prisma: {
    user: { findUnique: prismaUserFindUnique },
    project: { findFirst: prismaProjectFindFirst },
    image: {
      findUnique: prismaImageFindUnique,
      findMany: prismaImageFindMany,
      update: prismaImageUpdate,
    },
  },
}));

vi.mock('../../services/videoUploadService', () => ({
  uploadVideoFromFile: uploadVideoFromFileMock,
}));

vi.mock('../../services/video/videoExtractor', () => ({
  isVideoFilename: isVideoFilenameMock,
}));

vi.mock('fs/promises', () => ({
  rm: fsRmMock,
  access: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../utils/logger');

// Prevent config from calling process.exit(1) during module init
vi.mock('../../utils/config', () => ({
  config: {
    UPLOAD_DIR: '/tmp/test-uploads',
    NODE_ENV: 'test',
  },
}));

// Mock ResponseHelper so we can assert on its calls and control the response
// without needing real response formatting + logger wiring.
vi.mock('../../utils/response', () => ({
  ResponseHelper: {
    success: responseSuccessMock.mockImplementation(
      (res: express.Response, data: unknown) => {
        res.status(200).json({ success: true, data });
      }
    ),
    error: responseErrorMock.mockImplementation(
      (res: express.Response, _msg: unknown, statusCode = 400) => {
        res.status(statusCode).json({ success: false });
      }
    ),
  },
}));

// Import AFTER all mocks are registered
import { VideoController } from '../../api/controllers/videoController';

// ---------------------------------------------------------------------------
// App factory — injects req.user so we can test auth-vs-no-auth
// ---------------------------------------------------------------------------

function buildApp(opts: { userId?: string } = {}): Express {
  const app = express();
  app.use(express.json());

  // Simulate auth middleware outcome
  app.use((req: express.Request & { user?: { id: string } }, _res, next) => {
    if (opts.userId) req.user = { id: opts.userId };
    next();
  });

  app.post('/projects/:id/videos', (req, res) =>
    VideoController.upload(req, res)
  );
  app.get('/images/:imageId/video-frames', (req, res) =>
    VideoController.getVideoFrames(req, res)
  );

  return app;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const MOCK_USER = { id: 'user-1', email: 'user@test.com' };
const MOCK_PROJECT = { id: 'proj-1' };
const MOCK_CONTAINER = {
  id: 'video-1',
  projectId: 'proj-1',
  originalPath: 'projects/proj-1/images/video-1/original.mp4',
  isVideoContainer: true,
  parentVideoId: null,
  frameIndex: null,
  channels: [],
  name: 'test.mp4',
  width: 1920,
  height: 1080,
  frameCount: 5,
  videoDurationMs: 5000,
};
const MOCK_UPLOAD_RESULT = {
  containerId: 'video-1',
  frameCount: 5,
  channels: [{ name: 'BF', isSegmentationSource: true }],
};

// ---------------------------------------------------------------------------
describe('VideoController.upload()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fsRmMock.mockResolvedValue(undefined);
    // ResponseHelper re-wired after clearAllMocks
    responseSuccessMock.mockImplementation(
      (res: express.Response, data: unknown) => {
        res.status(200).json({ success: true, data });
      }
    );
    responseErrorMock.mockImplementation(
      (res: express.Response, _msg: unknown, statusCode = 400) => {
        res.status(statusCode).json({ success: false });
      }
    );
  });

  // -------------------------------------------------------------------------
  describe('assertProjectAccess failures', () => {
    it('returns 401 when there is no authenticated user (no req.user)', async () => {
      const app = buildApp(); // no userId → req.user undefined
      await request(app).post('/projects/proj-1/videos').expect(401);
      expect(responseErrorMock).toHaveBeenCalledWith(
        expect.anything(),
        'Unauthorized',
        401
      );
    });

    it('returns 401 when the DB user row is not found', async () => {
      prismaUserFindUnique.mockResolvedValueOnce(null);
      const app = buildApp({ userId: 'ghost' });
      await request(app).post('/projects/proj-1/videos').expect(401);
    });

    it('returns 403 when the user has no access to the project', async () => {
      prismaUserFindUnique.mockResolvedValueOnce(MOCK_USER);
      prismaProjectFindFirst.mockResolvedValueOnce(null); // no access
      const app = buildApp({ userId: 'user-1' });
      await request(app).post('/projects/proj-1/videos').expect(403);
      expect(responseErrorMock).toHaveBeenCalledWith(
        expect.anything(),
        'Access denied to this project',
        403
      );
    });
  });

  // -------------------------------------------------------------------------
  describe('file validation', () => {
    beforeEach(() => {
      prismaUserFindUnique.mockResolvedValue(MOCK_USER);
      prismaProjectFindFirst.mockResolvedValue(MOCK_PROJECT);
    });

    it('returns 400 when no file is attached (req.file absent)', async () => {
      const app = buildApp({ userId: 'user-1' });
      // No multipart body → multer does not set req.file
      await request(app).post('/projects/proj-1/videos').expect(400);
      expect(responseErrorMock).toHaveBeenCalledWith(
        expect.anything(),
        'No file uploaded',
        400
      );
    });

    it('returns 400 and cleans up tmp file when isVideoFilename returns false', async () => {
      isVideoFilenameMock.mockReturnValueOnce(false);
      const app = buildApp({ userId: 'user-1' });

      // Manually patch multer by hooking into the request at the middleware level.
      // Since supertest can't easily upload via multer diskStorage in unit tests,
      // we test this by mounting a custom middleware that injects req.file.
      const testApp = express();
      testApp.use(express.json());
      testApp.use(
        (
          req: express.Request & {
            user?: { id: string };
            file?: Express.Multer.File;
          },
          _res,
          next
        ) => {
          req.user = { id: 'user-1' };
          req.file = {
            fieldname: 'video',
            originalname: 'bad.txt',
            encoding: '7bit',
            mimetype: 'text/plain',
            path: '/tmp/upload-bad.txt',
            size: 100,
            destination: '/tmp',
            filename: 'upload-bad.txt',
            buffer: Buffer.alloc(0),
            stream: null as unknown as NodeJS.ReadableStream,
          };
          next();
        }
      );
      testApp.post('/projects/:id/videos', VideoController.upload);

      await request(testApp).post('/projects/proj-1/videos').expect(400);
      expect(responseErrorMock).toHaveBeenCalledWith(
        expect.anything(),
        expect.stringContaining('recognised video format'),
        400
      );
      // Tmp file must be cleaned up
      expect(fsRmMock).toHaveBeenCalledWith('/tmp/upload-bad.txt', {
        force: true,
      });
    });
  });

  // -------------------------------------------------------------------------
  describe('happy path', () => {
    beforeEach(() => {
      prismaUserFindUnique.mockResolvedValue(MOCK_USER);
      prismaProjectFindFirst.mockResolvedValue(MOCK_PROJECT);
      isVideoFilenameMock.mockReturnValue(true);
      uploadVideoFromFileMock.mockResolvedValue(MOCK_UPLOAD_RESULT);
    });

    it('returns 200 with {videoContainerId, frameCount, channels} on success', async () => {
      const testApp = express();
      testApp.use(
        (
          req: express.Request & {
            user?: { id: string };
            file?: Express.Multer.File;
          },
          _res,
          next
        ) => {
          req.user = { id: 'user-1' };
          req.file = {
            fieldname: 'video',
            originalname: 'clip.mp4',
            encoding: '7bit',
            mimetype: 'video/mp4',
            path: '/tmp/clip.mp4',
            size: 2048,
            destination: '/tmp',
            filename: 'clip.mp4',
            buffer: Buffer.alloc(0),
            stream: null as unknown as NodeJS.ReadableStream,
          };
          next();
        }
      );
      testApp.post('/projects/:id/videos', VideoController.upload);

      await request(testApp).post('/projects/proj-1/videos').expect(200);

      expect(responseSuccessMock).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          videoContainerId: MOCK_UPLOAD_RESULT.containerId,
          frameCount: MOCK_UPLOAD_RESULT.frameCount,
          channels: MOCK_UPLOAD_RESULT.channels,
        })
      );
      // uploadVideoFromFile receives projectId + original name + temp path
      expect(uploadVideoFromFileMock).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: 'proj-1',
          originalName: 'clip.mp4',
          tempFilePath: '/tmp/clip.mp4',
        })
      );
    });
  });

  // -------------------------------------------------------------------------
  describe('service error path', () => {
    beforeEach(() => {
      prismaUserFindUnique.mockResolvedValue(MOCK_USER);
      prismaProjectFindFirst.mockResolvedValue(MOCK_PROJECT);
      isVideoFilenameMock.mockReturnValue(true);
    });

    it('returns 500 and attempts tmp cleanup when uploadVideoFromFile throws', async () => {
      uploadVideoFromFileMock.mockRejectedValueOnce(
        new Error('extraction failed')
      );
      const testApp = express();
      testApp.use(
        (
          req: express.Request & {
            user?: { id: string };
            file?: Express.Multer.File;
          },
          _res,
          next
        ) => {
          req.user = { id: 'user-1' };
          req.file = {
            fieldname: 'video',
            originalname: 'clip.mp4',
            encoding: '7bit',
            mimetype: 'video/mp4',
            path: '/tmp/clip-err.mp4',
            size: 1024,
            destination: '/tmp',
            filename: 'clip-err.mp4',
            buffer: Buffer.alloc(0),
            stream: null as unknown as NodeJS.ReadableStream,
          };
          next();
        }
      );
      testApp.post('/projects/:id/videos', VideoController.upload);

      await request(testApp).post('/projects/proj-1/videos').expect(500);
      expect(responseErrorMock).toHaveBeenCalledWith(
        expect.anything(),
        'extraction failed',
        500
      );
      // Best-effort tmp cleanup must fire
      expect(fsRmMock).toHaveBeenCalledWith('/tmp/clip-err.mp4', {
        force: true,
      });
    });
  });
});

// ---------------------------------------------------------------------------
describe('VideoController.getVideoFrames()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    responseSuccessMock.mockImplementation(
      (res: express.Response, data: unknown) => {
        res.status(200).json({ success: true, data });
      }
    );
    responseErrorMock.mockImplementation(
      (res: express.Response, _msg: unknown, statusCode = 400) => {
        res.status(statusCode).json({ success: false });
      }
    );
  });

  const buildFramesApp = (userId?: string): Express => {
    const app = express();
    app.use((req: express.Request & { user?: { id: string } }, _res, next) => {
      if (userId) req.user = { id: userId };
      next();
    });
    app.get('/images/:imageId/video-frames', VideoController.getVideoFrames);
    return app;
  };

  it('returns 404 when the image row does not exist', async () => {
    prismaImageFindUnique.mockResolvedValueOnce(null);
    const app = buildFramesApp('user-1');
    await request(app).get('/images/no-such-id/video-frames').expect(404);
  });

  it('returns 401 when there is no authenticated user', async () => {
    prismaImageFindUnique.mockResolvedValueOnce(MOCK_CONTAINER);
    const app = buildFramesApp(); // no userId
    await request(app).get('/images/video-1/video-frames').expect(401);
  });

  it('returns 403 when the user has no project access', async () => {
    prismaImageFindUnique.mockResolvedValueOnce(MOCK_CONTAINER);
    prismaUserFindUnique.mockResolvedValueOnce(MOCK_USER);
    prismaProjectFindFirst.mockResolvedValueOnce(null); // no access
    const app = buildFramesApp('user-1');
    await request(app).get('/images/video-1/video-frames').expect(403);
  });

  it('returns 404 when the image is not a video container', async () => {
    const nonContainer = { ...MOCK_CONTAINER, isVideoContainer: false };
    prismaImageFindUnique.mockResolvedValueOnce(nonContainer);
    prismaUserFindUnique.mockResolvedValueOnce(MOCK_USER);
    prismaProjectFindFirst.mockResolvedValueOnce(MOCK_PROJECT);
    const app = buildFramesApp('user-1');
    await request(app).get('/images/video-1/video-frames').expect(404);
    expect(responseErrorMock).toHaveBeenCalledWith(
      expect.anything(),
      'Not a video container',
      404
    );
  });

  it('returns 200 with container metadata and ordered frames array', async () => {
    const frames = [
      { id: 'frame-0', frameIndex: 0, segmentationStatus: 'not_started' },
      { id: 'frame-1', frameIndex: 1, segmentationStatus: 'segmented' },
    ];
    prismaImageFindUnique.mockResolvedValueOnce(MOCK_CONTAINER);
    prismaUserFindUnique.mockResolvedValueOnce(MOCK_USER);
    prismaProjectFindFirst.mockResolvedValueOnce(MOCK_PROJECT);
    prismaImageFindMany.mockResolvedValueOnce(frames);

    const app = buildFramesApp('user-1');
    await request(app).get('/images/video-1/video-frames').expect(200);

    expect(prismaImageFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { parentVideoId: 'video-1' },
        orderBy: { frameIndex: 'asc' },
      })
    );
    expect(responseSuccessMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        id: 'video-1',
        frameCount: 5,
        frames,
      })
    );
  });

  it('returns 500 on unexpected Prisma error', async () => {
    prismaImageFindUnique.mockRejectedValueOnce(new Error('DB timeout'));
    const app = buildFramesApp('user-1');
    await request(app).get('/images/bad-id/video-frames').expect(500);
  });
});
