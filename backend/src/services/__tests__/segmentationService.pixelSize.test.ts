/**
 * Which pixel size reaches the ML service, and for which model.
 *
 * Only `spheroid_disintegration` reads `pixel_size_um` (it resamples the frame
 * to 1.28 µm/px before inference); the ML route answers 400 when any other
 * model is sent the field, so these tests pin both halves: the right value for
 * that model, and the field's ABSENCE for every other one.
 */
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { SegmentationService } from '../segmentationService';
import { ImageService } from '../imageService';
import { PrismaClient } from '@prisma/client';
import axios from 'axios';
import { getStorageProvider } from '../../storage/index';
import {
  MODELS_READING_PIXEL_SIZE,
  pixelSizeFormValue,
  resolveSegmentationPixelSizeUm,
} from '../segmentationPixelSize';

vi.mock('axios');
vi.mock('@prisma/client', () => ({
  PrismaClient: vi.fn(),
  Prisma: { PrismaClientKnownRequestError: class extends Error {} },
}));
vi.mock('../imageService');
vi.mock('../previews/previewService', () => ({
  previewService: { notifyChanged: vi.fn(), notifyContainerChanged: vi.fn() },
  removePreviews: vi.fn(),
}));
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

const STILL = {
  id: 'img-1',
  name: 'spheroid.bmp',
  projectId: 'project-id',
  parentVideoId: null,
  frameIndex: null,
  originalPath: 'projects/p/images/spheroid.bmp',
  width: 2048,
  height: 2048,
  mimeType: 'image/bmp',
  pixelSizeUm: null as number | null,
};

describe('MODELS_READING_PIXEL_SIZE', () => {
  it('is the set the ML route accepts the field for', () => {
    // Two hand-kept copies of one rule. If this side named a model the route
    // does not, every segmentation with that model would get a 400; if the
    // route named one this side does not, the field would never be sent.
    const py = readFileSync(
      join(__dirname, '../../../segmentation/api/routes.py'),
      'utf8'
    );
    const m = /^PIXEL_SIZE_MODELS = frozenset\(\{([^}]*)\}\)$/m.exec(py);
    expect(m).not.toBeNull();
    const fromPython = [...m![1]!.matchAll(/"([a-z0-9_]+)"/g)].map(x => x[1]);
    expect(fromPython.sort()).toEqual([...MODELS_READING_PIXEL_SIZE].sort());
  });
});

describe('resolveSegmentationPixelSizeUm', () => {
  it('takes the container, then the image, then the project', () => {
    expect(
      resolveSegmentationPixelSizeUm({ container: 2, image: 3, project: 4 })
    ).toBe(2);
    expect(resolveSegmentationPixelSizeUm({ image: 3, project: 4 })).toBe(3);
    expect(resolveSegmentationPixelSizeUm({ project: 4 })).toBe(4);
    expect(resolveSegmentationPixelSizeUm({})).toBeNull();
  });

  it('skips a value that is not a usable scale instead of sending it', () => {
    expect(
      resolveSegmentationPixelSizeUm({ container: 0, image: NaN, project: 1.6 })
    ).toBe(1.6);
    expect(
      resolveSegmentationPixelSizeUm({ image: -1, project: Infinity })
    ).toBeNull();
  });
});

describe('pixelSizeFormValue', () => {
  it('is sent for spheroid_disintegration only, and only when usable', () => {
    expect(pixelSizeFormValue('spheroid_disintegration', 1.6)).toBe('1.6');
    expect(pixelSizeFormValue('spheroid_disintegration', null)).toBeNull();
    expect(pixelSizeFormValue('spheroid_disintegration', 0)).toBeNull();
    expect(pixelSizeFormValue('spheroid_disintegration', NaN)).toBeNull();
    for (const model of ['segformer', 'hrnet', 'unet_spherohq', 'wound']) {
      expect(pixelSizeFormValue(model, 1.6)).toBeNull();
    }
  });
});

describe('SegmentationService — pixel_size_um on /segment', () => {
  let service: SegmentationService;
  let post: Mock;
  let findImage: Mock;
  let findProject: Mock;
  let image: typeof STILL;

  /** The value of one multipart field, or null when it was not sent. */
  const field = (name: string): string | null => {
    const body = (post.mock.calls[0]?.[1] as { getBuffer(): Buffer })
      .getBuffer()
      .toString();
    const m = new RegExp(`name="${name}"\\r\\n\\r\\n([^\\r]*)\\r\\n`).exec(
      body
    );
    return m ? m[1]! : null;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    image = { ...STILL };
    findImage = vi.fn().mockResolvedValue({ pixelSizeUm: 2.56 });
    findProject = vi.fn().mockResolvedValue({
      id: 'project-id',
      type: 'spheroid_invasive',
      pixelSizeUm: null,
    });
    const prisma = {
      segmentation: {
        upsert: vi.fn().mockResolvedValue({ id: 'seg-1' }),
        findUnique: vi.fn().mockResolvedValue(null),
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      image: {
        findUnique: findImage,
        findMany: vi.fn().mockResolvedValue([]),
        update: vi.fn().mockResolvedValue({}),
      },
      project: { findUnique: findProject },
    } as unknown as PrismaClient;
    const imageService = {
      getImageById: vi.fn(() => Promise.resolve(image)),
      updateSegmentationStatus: vi.fn().mockResolvedValue(undefined),
    } as unknown as ImageService;

    post = vi.fn().mockResolvedValue({
      status: 200,
      data: {
        success: true,
        polygons: [],
        model_used: 'spheroid_disintegration',
        threshold_used: 0.5,
        processing_time: 1,
        image_size: { width: 2048, height: 2048 },
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
    (getStorageProvider as Mock).mockReturnValue({
      getBuffer: vi.fn(() => Promise.resolve(Buffer.from('image'))),
      getFileUrl: vi.fn(),
      saveFile: vi.fn(),
      deleteFile: vi.fn(),
    });
    service = new SegmentationService(prisma, imageService);
  });

  const run = (model: string) =>
    service
      .requestSegmentation({
        imageId: image.id,
        model: model as never,
        userId: 'user-1',
        detectHoles: true,
      })
      // Persisting the result is not what is under test here.
      .catch(error => error);

  it("sends the image's own pixel size for spheroid_disintegration", async () => {
    image.pixelSizeUm = 1.6;
    findProject.mockResolvedValue({
      type: 'spheroid_invasive',
      pixelSizeUm: 1,
    });
    await run('spheroid_disintegration');
    expect(field('pixel_size_um')).toBe('1.6');
    // a still has no container to ask
    expect(findImage).not.toHaveBeenCalled();
  });

  it("falls back to the project's pixel size", async () => {
    findProject.mockResolvedValue({
      type: 'spheroid_invasive',
      pixelSizeUm: 1.1,
    });
    await run('spheroid_disintegration');
    expect(field('pixel_size_um')).toBe('1.1');
  });

  it("takes a video frame's pixel size from its container", async () => {
    image = { ...STILL, parentVideoId: 'video-1', frameIndex: 3 } as never;
    findProject.mockResolvedValue({
      type: 'spheroid_invasive',
      pixelSizeUm: 1.1,
    });
    await run('spheroid_disintegration');
    expect(findImage).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'video-1' } })
    );
    expect(field('pixel_size_um')).toBe('2.56');
  });

  it('sends no field when no pixel size is known', async () => {
    await run('spheroid_disintegration');
    expect(post).toHaveBeenCalledTimes(1);
    expect(field('pixel_size_um')).toBeNull();
    // the rest of the request is what it always was
    expect(field('model')).toBe('spheroid_disintegration');
    expect(field('detect_holes')).toBe('true');
  });

  it('never sends the field for another model, even with a pixel size', async () => {
    image.pixelSizeUm = 1.6;
    findProject.mockResolvedValue({ type: 'spheroid', pixelSizeUm: 1.6 });
    await run('segformer');
    expect(post).toHaveBeenCalledTimes(1);
    expect(field('model')).toBe('segformer');
    expect(field('pixel_size_um')).toBeNull();
  });
});
