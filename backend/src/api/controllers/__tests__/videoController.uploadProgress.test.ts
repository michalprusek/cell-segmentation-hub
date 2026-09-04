/**
 * Regression tests for the server-side half of the video upload progress bar.
 *
 * The bug these exist for was not in the progress machinery — that was fine and
 * fully plumbed. It was that NOBODY SUBSCRIBED. `uploadVideoFromFile` took an
 * `onProgress` callback, built a `reportProgress` helper, and called it at
 * every phase; the HTTP handler simply never passed one, so every event was
 * dropped on the floor. A video POST does not return until extraction has
 * finished, so the browser's own upload-progress events stop at the last byte
 * sent and the user then waits out the whole server-side phase against a full
 * bar — measured at 10 min 21 s on the 3.41 GB / 300-frame ND2 that prompted
 * this.
 *
 * So these test the WIRING, which is where the bug was:
 *
 *  - the handler passes an `onProgress` at all,
 *  - what it passes emits `videoUploadProgress` to the UPLOADING user's room,
 *  - the payload reaching the socket is the service's event, unmangled,
 *  - a socket that is missing or throwing cannot fail an upload whose frames
 *    are already on disk.
 *
 * Mocked surface: prisma (authz), fs/promises, videoUploadService,
 * websocketService. No real socket server.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const {
  uploadVideoFromFileMock,
  emitToUserMock,
  getInstanceMock,
  prismaUserFindUnique,
  prismaProjectFindFirst,
} = vi.hoisted(() => ({
  uploadVideoFromFileMock: vi.fn(),
  emitToUserMock: vi.fn(),
  getInstanceMock: vi.fn(),
  prismaUserFindUnique: vi.fn(),
  prismaProjectFindFirst: vi.fn(),
}));

vi.mock('fs/promises', () => ({
  default: { access: vi.fn(), rm: vi.fn() },
  access: vi.fn(),
  rm: vi.fn(),
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

vi.mock('../../../utils/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../../../services/videoUploadService', () => ({
  uploadVideoFromFile: uploadVideoFromFileMock,
}));

vi.mock('../../../services/video/videoExtractor', () => ({
  isVideoFilename: () => true,
}));

vi.mock('../../../services/websocketService', () => ({
  WebSocketService: { getInstance: getInstanceMock },
}));

import { VideoController } from '../videoController';

const UPLOADER = 'u-1';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as unknown as { user: { id: string } }).user = { id: UPLOADER };
    // The real chain puts multer's file here before the handler runs.
    (req as unknown as { file: unknown }).file = {
      originalname: 'stack.nd2',
      mimetype: 'image/tiff',
      path: '/tmp/test-uploads/tmp-upload',
    };
    next();
  });
  app.post('/projects/:id/videos', (req, res) =>
    VideoController.upload(req, res)
  );
  return app;
}

const OK_RESULT = {
  containerId: 'video-1',
  frameCount: 300,
  channels: [],
  positionCount: 1,
  containerIds: ['video-1'],
};

/** Runs the handler and hands back the `onProgress` it passed to the service. */
async function captureOnProgress(): Promise<
  (e: Record<string, unknown>) => void
> {
  await request(buildApp()).post('/projects/proj-1/videos').send();
  expect(uploadVideoFromFileMock).toHaveBeenCalledTimes(1);
  const onProgress = uploadVideoFromFileMock.mock.calls[0][0].onProgress;
  expect(
    typeof onProgress,
    'the handler must pass an onProgress — without one every phase event the ' +
      'service emits is discarded and the bar sits at 100% for the whole ' +
      'server-side phase'
  ).toBe('function');
  return onProgress;
}

describe('VideoController.upload — server-side progress reaches the browser', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaUserFindUnique.mockResolvedValue({ email: 'u@example.com' });
    prismaProjectFindFirst.mockResolvedValue({ id: 'proj-1' });
    uploadVideoFromFileMock.mockResolvedValue(OK_RESULT);
    getInstanceMock.mockReturnValue({ emitToUser: emitToUserMock });
  });

  it('passes an onProgress to the upload service', async () => {
    await captureOnProgress();
  });

  it('emits videoUploadProgress to the uploading user, payload intact', async () => {
    const onProgress = await captureOnProgress();

    const event = {
      videoContainerId: 'video-1',
      filename: 'stack.nd2',
      phase: 'extracting',
      progress: 0.42,
      message: 'Extracting frames 126/300',
    };
    onProgress(event);

    expect(emitToUserMock).toHaveBeenCalledTimes(1);
    const [userId, eventName, payload] = emitToUserMock.mock.calls[0];
    // The uploader's own room — not the project room. A share recipient
    // watching the same project did not start this upload and has no card.
    expect(userId).toBe(UPLOADER);
    expect(eventName).toBe('videoUploadProgress');
    // Unmangled: the browser computes the bar from `progress` and prints
    // `message` verbatim, so a controller that reshaped either would break
    // the card while every unit below it still passed.
    expect(payload).toEqual(event);
  });

  it('forwards every phase the service reports, in order', async () => {
    const onProgress = await captureOnProgress();
    const phases = ['saving', 'extracting', 'persisting', 'completed'];
    for (const phase of phases) {
      onProgress({
        videoContainerId: 'video-1',
        filename: 'stack.nd2',
        phase,
        progress: 0.5,
      });
    }
    expect(
      emitToUserMock.mock.calls.map(
        c => (c[2] as { phase: string }).phase
      )
    ).toEqual(phases);
  });

  it('still succeeds when the socket server is not initialised', async () => {
    // getInstance() throws before the socket server exists (scripts, tests,
    // early boot). Frames are already on disk by the time progress is
    // reported, so a missing socket must never turn a good upload into a 500.
    getInstanceMock.mockImplementation(() => {
      throw new Error('WebSocket service not initialized');
    });
    const res = await request(buildApp()).post('/projects/proj-1/videos').send();
    expect(res.status).toBe(200);
    const onProgress = uploadVideoFromFileMock.mock.calls[0][0].onProgress;
    expect(() =>
      onProgress({
        videoContainerId: 'video-1',
        filename: 'stack.nd2',
        phase: 'extracting',
        progress: 0.1,
      })
    ).not.toThrow();
  });

  it('still succeeds when emitToUser itself throws', async () => {
    getInstanceMock.mockReturnValue({
      emitToUser: () => {
        throw new Error('socket write failed');
      },
    });
    const onProgress = await captureOnProgress();
    expect(() =>
      onProgress({
        videoContainerId: 'video-1',
        filename: 'stack.nd2',
        phase: 'persisting',
        progress: 0.9,
      })
    ).not.toThrow();
  });
});
