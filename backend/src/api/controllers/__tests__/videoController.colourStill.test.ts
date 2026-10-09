/**
 * A single-page colour TIFF POSTed to /videos is stored as a still image.
 *
 * The file behind this: one 4104 x 2174 RGB brightfield frame, 26.8 MB. Over
 * the 20 MB still-image cap the browser sends any `.tif` here, and the stack
 * extractor answered `Cannot interpret TIFF axes='YXS' shape=(2174, 4104, 3)`.
 *
 * What is tested is the WIRING — which of the two storage paths a file
 * reaches, with which arguments, and who deletes the temp file. The rule that
 * decides "colour photograph" is Python and has its own suite
 * (`test_extract_tiff_classify.py`); here it is a mock that says one thing or
 * the other. The real `colourStillTiff` module runs, so its gate on the file
 * name, its size ceiling and its handling of a failed probe are covered too.
 *
 * Mocked surface: prisma (authz), fs/promises, the Python bridge, ImageService,
 * videoUploadService, websocketService.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const {
  uploadVideoFromFileMock,
  uploadImagesMock,
  classifyTiffMock,
  openMock,
  closeMock,
  statMock,
  readFileMock,
  rmMock,
  prismaUserFindUnique,
  prismaProjectFindFirst,
} = vi.hoisted(() => ({
  uploadVideoFromFileMock: vi.fn(),
  uploadImagesMock: vi.fn(),
  classifyTiffMock: vi.fn(),
  openMock: vi.fn(),
  closeMock: vi.fn(),
  statMock: vi.fn(),
  readFileMock: vi.fn(),
  rmMock: vi.fn(),
  prismaUserFindUnique: vi.fn(),
  prismaProjectFindFirst: vi.fn(),
}));

vi.mock('fs/promises', () => ({
  default: { access: vi.fn(), rm: rmMock, open: openMock },
  access: vi.fn(),
  rm: rmMock,
  open: openMock,
}));

vi.mock('../../../db/prismaClient', () => ({
  prisma: {
    image: { findUnique: vi.fn(), update: vi.fn() },
    user: { findUnique: prismaUserFindUnique },
    project: { findFirst: prismaProjectFindFirst },
  },
}));

vi.mock('../../../utils/config', () => ({
  config: { UPLOAD_DIR: '/tmp/test-uploads' },
}));

vi.mock('../../../config/videoUploadTmpDir', () => ({
  VIDEO_UPLOAD_TMP_DIR: '/tmp/test-uploads',
}));

vi.mock('../../../utils/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../../../services/videoUploadService', () => ({
  uploadVideoFromFile: uploadVideoFromFileMock,
}));

vi.mock('../../../services/video/videoExtractor', () => ({
  isVideoFilename: () => true,
}));

vi.mock('../../../services/video/pythonExtractor', () => ({
  classifyTiff: classifyTiffMock,
}));

vi.mock('../../../services/imageService', () => ({
  ImageService: class {
    uploadImages = uploadImagesMock;
  },
}));

vi.mock('../../../services/websocketService', () => ({
  WebSocketService: { getInstance: () => ({ emitToUser: vi.fn() }) },
}));

import { VideoController } from '../videoController';
import { COLOUR_STILL_MAX_BYTES } from '../../../services/colourStillTiff';

const UPLOADER = 'u-1';
const TMP = '/tmp/test-uploads/tmp-upload.tif';
const BYTES = Buffer.from('the tiff bytes');

function buildApp(originalname: string) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as unknown as { user: { id: string } }).user = { id: UPLOADER };
    (req as unknown as { file: unknown }).file = {
      originalname,
      mimetype: 'image/tiff',
      path: TMP,
    };
    next();
  });
  app.post('/projects/:id/videos', (req, res) =>
    VideoController.upload(req, res)
  );
  return app;
}

const post = (name: string) =>
  request(buildApp(name)).post('/projects/proj-1/videos').send();

const COLOUR = {
  kind: 'colour_still',
  axes: 'YXS',
  shape: [2174, 4104, 3],
  photometric: 2,
};
const STACK = { kind: 'stack', axes: 'TYX', shape: [5, 64, 64], photometric: 1 };

describe('VideoController.upload — a colour photograph is not a video', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaUserFindUnique.mockResolvedValue({ email: 'u@example.com' });
    prismaProjectFindFirst.mockResolvedValue({ id: 'proj-1' });
    uploadVideoFromFileMock.mockResolvedValue({
      containerId: 'video-1',
      frameCount: 5,
      channels: [],
      positionCount: 1,
      containerIds: ['video-1'],
    });
    uploadImagesMock.mockResolvedValue([{ id: 'img-1' }]);
    statMock.mockResolvedValue({ size: BYTES.length });
    readFileMock.mockResolvedValue(BYTES);
    closeMock.mockResolvedValue(undefined);
    openMock.mockResolvedValue({
      stat: statMock,
      readFile: readFileMock,
      close: closeMock,
    });
    rmMock.mockResolvedValue(undefined);
  });

  it('stores a single-page colour TIFF through the image path', async () => {
    classifyTiffMock.mockResolvedValue(COLOUR);

    const res = await post('test.tif');

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ storedAs: 'image', imageId: 'img-1' });
    expect(classifyTiffMock).toHaveBeenCalledWith(TMP);
    expect(openMock).toHaveBeenCalledWith(TMP, 'r');
    expect(closeMock).toHaveBeenCalledTimes(1);
    expect(uploadImagesMock).toHaveBeenCalledTimes(1);
    expect(uploadImagesMock).toHaveBeenCalledWith('proj-1', UPLOADER, [
      {
        originalname: 'test.tif',
        buffer: BYTES,
        mimetype: 'image/tiff',
        size: BYTES.length,
      },
    ]);
    expect(
      uploadVideoFromFileMock,
      'the extractor has no branch for colour and would fail the upload'
    ).not.toHaveBeenCalled();
  });

  it('removes the temp file once the image is stored', async () => {
    classifyTiffMock.mockResolvedValue(COLOUR);

    await post('test.tif');

    // uploadVideoFromFile would have owned it; nobody else will.
    expect(rmMock).toHaveBeenCalledWith(TMP, { force: true });
  });

  it('accepts the .tiff spelling and any letter case', async () => {
    classifyTiffMock.mockResolvedValue(COLOUR);

    await post('PHOTO.TIFF');

    expect(uploadImagesMock).toHaveBeenCalledTimes(1);
    expect(uploadVideoFromFileMock).not.toHaveBeenCalled();
  });

  it('leaves a stack to the extractor, temp file included', async () => {
    classifyTiffMock.mockResolvedValue(STACK);

    const res = await post('stack.tif');

    expect(res.status).toBe(200);
    expect(res.body.data.videoContainerId).toBe('video-1');
    expect(uploadVideoFromFileMock).toHaveBeenCalledTimes(1);
    expect(uploadVideoFromFileMock.mock.calls[0][0].tempFilePath).toBe(TMP);
    expect(uploadImagesMock).not.toHaveBeenCalled();
    expect(
      rmMock,
      'the extractor renames this file into place; deleting it first loses the upload'
    ).not.toHaveBeenCalled();
  });

  it('does not probe a file that is not a TIFF', async () => {
    const res = await post('movie.nd2');

    expect(res.status).toBe(200);
    expect(classifyTiffMock).not.toHaveBeenCalled();
    expect(uploadVideoFromFileMock).toHaveBeenCalledTimes(1);
  });

  it('falls back to the extractor when the probe itself fails', async () => {
    classifyTiffMock.mockRejectedValue(new Error('python3: not found'));

    const res = await post('stack.tif');

    expect(res.status).toBe(200);
    expect(uploadVideoFromFileMock).toHaveBeenCalledTimes(1);
    expect(uploadImagesMock).not.toHaveBeenCalled();
  });

  it('refuses a colour image over the in-memory ceiling without reading it', async () => {
    classifyTiffMock.mockResolvedValue(COLOUR);
    statMock.mockResolvedValue({ size: COLOUR_STILL_MAX_BYTES + 1 });

    const res = await post('huge.tif');

    // the client's to fix, so not a 500
    expect(res.status).toBe(413);
    expect(res.body.message ?? res.body.error).toMatch(/huge\.tif.*512 MB/);
    expect(readFileMock).not.toHaveBeenCalled();
    expect(uploadImagesMock).not.toHaveBeenCalled();
    expect(uploadVideoFromFileMock).not.toHaveBeenCalled();
    expect(closeMock, 'the refusal must not leak the descriptor').toHaveBeenCalledTimes(1);
    expect(rmMock).toHaveBeenCalledWith(TMP, { force: true });
  });

  it('takes a file of exactly the ceiling', async () => {
    classifyTiffMock.mockResolvedValue(COLOUR);
    statMock.mockResolvedValue({ size: COLOUR_STILL_MAX_BYTES });

    const res = await post('big.tif');

    expect(res.status).toBe(200);
    expect(uploadImagesMock).toHaveBeenCalledTimes(1);
  });

  it('touches nothing when the temp path is outside the upload temp dir', async () => {
    classifyTiffMock.mockResolvedValue(COLOUR);
    const app = express();
    app.use((req, _res, next) => {
      (req as unknown as { user: { id: string } }).user = { id: UPLOADER };
      (req as unknown as { file: unknown }).file = {
        originalname: 'test.tif',
        mimetype: 'image/tiff',
        // resolves to /etc/passwd.tif — a prefix test on the raw string passes
        path: '/tmp/test-uploads/../../etc/passwd.tif',
      };
      next();
    });
    app.post('/projects/:id/videos', (req, res) =>
      VideoController.upload(req, res)
    );

    const res = await request(app).post('/projects/proj-1/videos').send();

    expect(res.status).toBe(500);
    expect(classifyTiffMock).not.toHaveBeenCalled();
    expect(openMock).not.toHaveBeenCalled();
    expect(uploadImagesMock).not.toHaveBeenCalled();
    expect(uploadVideoFromFileMock).not.toHaveBeenCalled();
  });

  it('reports a failed image store and still removes the temp file', async () => {
    classifyTiffMock.mockResolvedValue(COLOUR);
    uploadImagesMock.mockRejectedValue(new Error('disk full'));

    const res = await post('test.tif');

    expect(res.status).toBe(500);
    expect(uploadVideoFromFileMock).not.toHaveBeenCalled();
    expect(closeMock).toHaveBeenCalledTimes(1);
    expect(rmMock).toHaveBeenCalledWith(TMP, { force: true });
  });
});
