/**
 * Regression test for the video-container delete branch in
 * imageService.deleteImage.
 *
 * Round-2 review GAP-4: a future refactor that drops the
 * `if (image.isVideoContainer)` branch (or moves it after the DB
 * cascade and swallows the error) would silently leave the
 * projects/<pid>/images/<vid>/ directory subtree on disk. With 100 GB
 * video uploads enabled, unbounded disk growth is a real production
 * failure mode.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { fsRmMock, sharedStorageDelete } = vi.hoisted(() => ({
  fsRmMock: vi.fn(),
  sharedStorageDelete: vi.fn(),
}));

vi.mock('fs/promises', () => ({
  default: { rm: fsRmMock, mkdir: vi.fn(), readdir: vi.fn() },
  rm: fsRmMock,
}));

vi.mock('../../utils/config', () => ({
  config: { UPLOAD_DIR: '/data' },
}));

vi.mock('../../utils/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../../storage/index', () => ({
  getStorageProvider: () => ({ delete: sharedStorageDelete }),
}));

import { ImageService } from '../imageService';

describe('imageService.deleteImage video container branch (round-2 GAP-4)', () => {
  let prismaStub: {
    image: {
      findFirst: ReturnType<typeof vi.fn>;
      delete: ReturnType<typeof vi.fn>;
    };
  };
  let websocketStub: { emitToUser: ReturnType<typeof vi.fn> };
  let svc: ImageService;

  beforeEach(() => {
    vi.clearAllMocks();
    prismaStub = {
      image: {
        findFirst: vi.fn(),
        delete: vi.fn().mockResolvedValue({}),
      },
    };
    websocketStub = { emitToUser: vi.fn() };
    svc = new ImageService(prismaStub as never, websocketStub as never);
    // Stub the project-stats emit so it doesn't blow up looking for prisma.
    (
      svc as unknown as { emitProjectStatsUpdate: () => Promise<void> }
    ).emitProjectStatsUpdate = vi.fn().mockResolvedValue(undefined);
  });

  it('removes the container directory recursively when isVideoContainer=true', async () => {
    prismaStub.image.findFirst.mockResolvedValue({
      id: 'vid-1',
      name: 'clip.mp4',
      projectId: 'proj-1',
      originalPath: 'vid-1/original.mp4',
      thumbnailPath: 'vid-1/thumbnail.jpg',
      isVideoContainer: true,
    });

    await svc.deleteImage('vid-1', 'user-1');

    // The container directory was removed BEFORE prisma.image.delete
    // (or at least removed at all).
    const rmCalls = fsRmMock.mock.calls.map(c => c[0] as string);
    expect(rmCalls).toContain('/data/projects/proj-1/images/vid-1');
    expect(fsRmMock.mock.calls[0]?.[1]).toEqual({
      recursive: true,
      force: true,
    });
    expect(prismaStub.image.delete).toHaveBeenCalledWith({
      where: { id: 'vid-1' },
    });
  });

  it('does NOT touch the filesystem container dir for non-video images', async () => {
    prismaStub.image.findFirst.mockResolvedValue({
      id: 'img-99',
      name: 'photo.jpg',
      projectId: 'proj-1',
      originalPath: 'img-99/photo.jpg',
      thumbnailPath: 'img-99/photo-thumb.jpg',
      isVideoContainer: false,
    });

    await svc.deleteImage('img-99', 'user-1');

    // Storage provider was called for the originalPath + thumbnail (the
    // existing happy path) but fs.rm was NOT called with a container dir.
    const rmCalls = fsRmMock.mock.calls.map(c => c[0] as string);
    expect(rmCalls.find(p => p.endsWith('/images/img-99'))).toBeUndefined();
    expect(sharedStorageDelete).toHaveBeenCalledWith('img-99/photo.jpg');
  });
});
