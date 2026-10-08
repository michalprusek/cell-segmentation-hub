/**
 * The wiring of a merged-channel segmentation: which files are read and what
 * reaches the ML service. The merge itself is Python and is tested there.
 */
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { SegmentationService } from '../segmentationService';
import { ImageService } from '../imageService';
import { PrismaClient } from '@prisma/client';
import axios from 'axios';
import { getStorageProvider } from '../../storage/index';

vi.mock('axios');
vi.mock('@prisma/client', () => ({
  PrismaClient: vi.fn(),
  Prisma: { PrismaClientKnownRequestError: class extends Error {} },
}));
vi.mock('../imageService');
vi.mock('../segmentationThumbnailService');
vi.mock('../thumbnailManager');
vi.mock('../../utils/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../../utils/config', () => ({
  config: {
    SEGMENTATION_SERVICE_URL: 'http://localhost:8000',
    NODE_ENV: 'test',
    JWT_SECRET: 'test-secret',
    JWT_REFRESH_SECRET: 'test-refresh-secret',
    DATABASE_URL: 'file:./test.db',
    STORAGE_TYPE: 'local',
    STORAGE_LOCAL_PATH: '/tmp/test-storage',
  },
}));
vi.mock('../../storage/index', () => ({ getStorageProvider: vi.fn() }));

const FRAME = {
  id: 'frame-1',
  name: 'stack.tif (frame 1)',
  projectId: 'project-id',
  parentVideoId: 'video-1',
  frameIndex: 1,
  originalPath: 'projects/p/images/video-1/frames/0001/Channel_1.png',
  width: 64,
  height: 64,
  mimeType: 'image/png',
};

describe('SegmentationService — channels to merge', () => {
  let service: SegmentationService;
  let post: Mock;
  let getBuffer: Mock;
  let findContainer: Mock;

  /** The multipart body that was posted, as text. */
  const postedBody = (): string =>
    (post.mock.calls[0]?.[1] as { getBuffer(): Buffer }).getBuffer().toString();
  const parts = (name: string): number =>
    postedBody().split(`name="${name}"`).length - 1;

  beforeEach(() => {
    vi.clearAllMocks();
    findContainer = vi.fn().mockResolvedValue({
      channels: [
        { name: 'Channel_1', sparseFill: { '1': 0 } },
        { name: 'Channel_2' },
        { name: 'Channel_3' },
      ],
    });
    const prisma = {
      segmentation: {
        upsert: vi.fn().mockResolvedValue({ id: 'seg-1' }),
        findUnique: vi.fn().mockResolvedValue(null),
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      image: {
        findUnique: findContainer,
        findMany: vi.fn().mockResolvedValue([]),
        update: vi.fn().mockResolvedValue({}),
      },
      project: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'project-id',
          userId: 'user-1',
          type: 'neurite',
        }),
      },
    } as unknown as PrismaClient;
    const imageService = {
      getImageById: vi.fn().mockResolvedValue(FRAME),
      updateSegmentationStatus: vi.fn().mockResolvedValue(undefined),
    } as unknown as ImageService;

    post = vi.fn().mockResolvedValue({
      status: 200,
      data: {
        success: true,
        polygons: [],
        model_used: 'neurite_soma_classical',
        threshold_used: 0.5,
        processing_time: 1,
        image_size: { width: 64, height: 64 },
      },
    });
    (axios.create as Mock).mockReturnValue({
      post,
      get: vi.fn(),
      interceptors: {
        request: { use: vi.fn() },
        response: { use: vi.fn() },
      },
    });
    getBuffer = vi.fn((key: string) => Promise.resolve(Buffer.from(key)));
    (getStorageProvider as Mock).mockReturnValue({
      getBuffer,
      getFileUrl: vi.fn(),
      saveFile: vi.fn(),
      deleteFile: vi.fn(),
    });
    service = new SegmentationService(prisma, imageService);
  });

  const run = (model: string, channels?: string[]) =>
    service
      .requestSegmentation({
        imageId: 'frame-1',
        model: model as never,
        userId: 'user-1',
        detectHoles: true,
        channels,
      })
      // Persisting the result is not what is under test here.
      .catch(error => error);

  it('reads every picked channel and sends them all, in the order asked', async () => {
    await run('neurite_soma_classical', ['Channel_2', 'Channel_1']);

    expect(getBuffer.mock.calls.map(call => call[0])).toEqual([
      'projects/p/images/video-1/frames/0001/Channel_2.png',
      // Frame 1 is a gap on Channel_1; frame 0 stands in for it.
      'projects/p/images/video-1/frames/0000/Channel_1.png',
    ]);
    expect(parts('file')).toBe(1);
    expect(parts('extra_channels')).toBe(1);
    const body = postedBody();
    // The first channel is `file`, the second the extra one.
    expect(body.indexOf('frames/0001/Channel_2.png')).toBeLessThan(
      body.indexOf('frames/0000/Channel_1.png')
    );
  });

  it('sends one file when one channel is picked', async () => {
    await run('neurite_soma_classical', ['Channel_3']);
    expect(getBuffer.mock.calls.map(call => call[0])).toEqual([
      'projects/p/images/video-1/frames/0001/Channel_3.png',
    ]);
    expect(parts('extra_channels')).toBe(0);
  });

  it('does not segment a subset when a channel does not exist', async () => {
    const outcome = await run('neurite_soma_classical', ['Channel_2', 'nope']);
    expect(post).not.toHaveBeenCalled();
    expect(String((outcome as Error)?.message ?? outcome)).toMatch(/nope/);
  });

  it('ignores the list for a model that reads one channel', async () => {
    // The controllers refuse this; the service must still not act on it.
    await run('neurite_soma', ['Channel_2', 'Channel_3']);
    expect(findContainer).not.toHaveBeenCalled();
    expect(getBuffer.mock.calls.map(call => call[0])).toEqual([
      FRAME.originalPath,
    ]);
    expect(parts('extra_channels')).toBe(0);
  });
});
