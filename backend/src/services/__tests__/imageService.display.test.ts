/**
 * imageService.display.test.ts — the getBrowserCompatibleImage / display
 * pipeline for ImageService.
 *
 * These paths require getStorageProvider to return a REAL LocalStorageProvider
 * instance (so `storage instanceof LocalStorageProvider` is true and
 * getImageBuffer reads via fs). That mock strategy is incompatible with the
 * core suite in imageService.test.ts (which deliberately returns a non-LSP so
 * getImageBuffer throws) — hence a separate file.
 *
 * Concerns:
 *   - getBrowserCompatibleImage: access control + query shape
 *   - getBrowserCompatibleImage: browser-compatible passthrough, cached PNG,
 *     sharp conversion + cache write, basename sanitization
 *   - getBrowserCompatibleImage: video-container / frame display
 *   - cleanupConvertedCache resilience (background, fire-and-forget)
 *   - getImageBuffer error paths
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Hoisted mocks ─────────────────────────────────────────────────────────────

const {
  mockAccess,
  mockReadFile,
  mockWriteFile,
  mockMkdir,
  mockReaddir,
  mockStat,
  mockUnlink,
  prismaMock,
  webSocketServiceMock,
} = vi.hoisted(() => ({
  mockAccess: vi.fn(),
  mockReadFile: vi.fn(),
  mockWriteFile: vi.fn(),
  mockMkdir: vi.fn(),
  mockReaddir: vi.fn(),
  mockStat: vi.fn(),
  mockUnlink: vi.fn(),
  prismaMock: {
    project: { findFirst: vi.fn() },
    image: {
      create: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      count: vi.fn(),
      delete: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    user: { findUnique: vi.fn() },
    $transaction: vi.fn(),
  },
  webSocketServiceMock: {
    getInstance: vi.fn(() => ({
      emitToUser: vi.fn(),
      broadcastProjectUpdate: vi.fn(),
      emitDashboardUpdate: vi.fn(),
    })),
  },
}));

vi.mock('../../utils/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../../utils/config', () => ({
  config: {
    SEGMENTATION_SERVICE_URL: 'http://localhost:8000',
    UPLOAD_DIR: '/tmp/uploads',
    STORAGE_TYPE: 'local',
    NODE_ENV: 'test',
  },
}));

vi.mock('../../utils/getBaseUrl', () => ({
  getBaseUrl: vi.fn(() => 'http://api.test'),
}));

vi.mock('../../storage/index', async () => {
  const { LocalStorageProvider: RealLSP } = await vi.importActual<
    typeof import('../../storage/localStorage')
  >('../../storage/localStorage');

  // A real instance so instanceof checks pass; methods stubbed.
  const fakeLocalStorage = Object.create(RealLSP.prototype) as InstanceType<
    typeof RealLSP
  >;
  (fakeLocalStorage as Record<string, unknown>).upload = vi.fn();
  (fakeLocalStorage as Record<string, unknown>).getUrl = vi.fn(
    async (p: string) => `http://host/${p}`
  );
  (fakeLocalStorage as Record<string, unknown>).delete = vi
    .fn()
    .mockResolvedValue(undefined);
  (fakeLocalStorage as Record<string, unknown>).getBuffer = vi
    .fn()
    .mockResolvedValue(Buffer.from('img'));

  return {
    getStorageProvider: vi.fn(() => fakeLocalStorage),
    LocalStorageProvider: RealLSP,
  };
});

vi.mock('../websocketService', () => ({
  WebSocketService: webSocketServiceMock,
}));

vi.mock('../userService', () => ({
  getUserStats: vi.fn().mockResolvedValue({
    totalProjects: 1,
    totalImages: 1,
    processedImages: 0,
    imagesUploadedToday: 0,
    storageUsed: '0',
    storageUsedBytes: 0,
  }),
}));

// imageService uses `import { promises as fs } from 'fs'`.
vi.mock('fs', () => ({
  promises: {
    access: mockAccess,
    readFile: mockReadFile,
    writeFile: mockWriteFile,
    mkdir: mockMkdir,
    readdir: mockReaddir,
    stat: mockStat,
    unlink: mockUnlink,
    rm: vi.fn().mockResolvedValue(undefined),
  },
  constants: { W_OK: 2, R_OK: 4 },
}));

const mockSharpToBuffer = vi.fn().mockResolvedValue(Buffer.from('converted-png'));
vi.mock('sharp', () => ({
  default: vi.fn(() => ({
    png: vi.fn().mockReturnThis(),
    toBuffer: mockSharpToBuffer,
    metadata: vi.fn().mockResolvedValue({ width: 100, height: 100 }),
  })),
}));

import { ImageService } from '../imageService';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const makeService = () => new ImageService(prismaMock as never);

function makeImage(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'img-1',
    name: 'photo.jpg',
    originalPath: 'projects/p/img-1/original.jpg',
    thumbnailPath: null,
    segmentationThumbnailPath: null,
    projectId: 'proj-1',
    fileSize: BigInt(1024),
    width: 100,
    height: 100,
    mimeType: 'image/jpeg',
    segmentationStatus: 'no_segmentation',
    isVideoContainer: false,
    parentVideoId: null,
    frameIndex: null,
    displayOrder: 0,
    channels: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

// Reset one-time queues (global clearMocks does not clear them) and
// re-establish fs defaults so a queued value can't leak between the merged
// describes.
beforeEach(() => {
  vi.clearAllMocks();
  for (const m of [
    mockAccess,
    mockReadFile,
    mockWriteFile,
    mockMkdir,
    mockReaddir,
    mockStat,
    mockUnlink,
    prismaMock.project.findFirst,
    prismaMock.image.findFirst,
    prismaMock.image.findUnique,
    prismaMock.image.findMany,
    prismaMock.image.count,
    prismaMock.user.findUnique,
    prismaMock.$transaction,
  ]) {
    m.mockReset();
  }
  // pathExists → false (no cached converted file) unless a test opts in.
  mockAccess.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
  mockReadFile.mockResolvedValue(Buffer.from('raw-image-data'));
  mockWriteFile.mockResolvedValue(undefined);
  mockMkdir.mockResolvedValue(undefined);
  mockReaddir.mockResolvedValue([]);
  mockStat.mockResolvedValue({ size: 100, mtimeMs: Date.now() });
  mockUnlink.mockResolvedValue(undefined);
});

// ─── getBrowserCompatibleImage — access control + query shape ────────────────

describe('ImageService — getBrowserCompatibleImage access', () => {
  it('throws "Access denied" when the image is not found (with userId)', async () => {
    const service = makeService();
    prismaMock.image.findFirst.mockResolvedValueOnce(null);

    await expect(
      service.getBrowserCompatibleImage('img-1', 'user-1')
    ).rejects.toThrow('Access denied');
  });

  it('throws "Access denied" when the image is not found (without userId)', async () => {
    const service = makeService();
    prismaMock.image.findFirst.mockResolvedValueOnce(null);

    await expect(service.getBrowserCompatibleImage('img-1')).rejects.toThrow(
      'Access denied'
    );
  });

  it('queries the image without a project filter when userId is omitted', async () => {
    const service = makeService();
    prismaMock.image.findFirst.mockResolvedValueOnce(makeImage({ mimeType: 'image/jpeg' }));
    mockReadFile.mockResolvedValueOnce(Buffer.from('jpeg-data'));

    await service.getBrowserCompatibleImage('img-1');

    const call = prismaMock.image.findFirst.mock.calls[0][0];
    expect(call.where).not.toHaveProperty('project');
  });
});

// ─── getBrowserCompatibleImage — conversion pipeline ─────────────────────────

describe('ImageService — getBrowserCompatibleImage pipeline', () => {
  it('returns the original buffer for a browser-compatible mime (image/jpeg)', async () => {
    const service = makeService();
    prismaMock.image.findFirst.mockResolvedValueOnce(
      makeImage({ mimeType: 'image/jpeg', name: 'photo.jpg' })
    );
    mockReadFile.mockResolvedValueOnce(Buffer.from('jpeg-data'));

    const result = await service.getBrowserCompatibleImage('img-1', 'user-1');

    expect(result.mimeType).toBe('image/jpeg');
    expect(result.buffer).toBeDefined();
  });

  it('returns the cached PNG when a converted file already exists', async () => {
    const service = makeService();
    prismaMock.image.findFirst.mockResolvedValueOnce(makeImage({ mimeType: 'image/tiff' }));
    mockAccess.mockResolvedValueOnce(undefined); // pathExists → cached file present
    mockReadFile.mockResolvedValueOnce(Buffer.from('cached-png'));

    const result = await service.getBrowserCompatibleImage('img-1', 'user-1');

    expect(result.mimeType).toBe('image/png');
    expect(result.filename).toMatch(/\.png$/);
  });

  it('converts a non-cached tiff via sharp and writes the cache', async () => {
    const service = makeService();
    prismaMock.image.findFirst.mockResolvedValueOnce(makeImage({ mimeType: 'image/tiff' }));
    mockAccess.mockRejectedValueOnce(
      Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    );
    mockReadFile.mockResolvedValueOnce(Buffer.from('tiff-data'));
    mockSharpToBuffer.mockResolvedValueOnce(Buffer.from('converted'));

    const result = await service.getBrowserCompatibleImage('img-1', 'user-1');

    expect(result.mimeType).toBe('image/png');
    expect(mockMkdir).toHaveBeenCalled();
    expect(mockWriteFile).toHaveBeenCalled();
  });

  it('sanitizes the imageId with path.basename (path-traversal safe)', async () => {
    const service = makeService();
    // safeImageId = path.basename('../../../etc/passwd') = 'passwd', staying
    // within the converted-cache base — exercises the sanitization branch.
    prismaMock.image.findFirst.mockResolvedValueOnce(
      makeImage({ id: '../../../etc/passwd', mimeType: 'image/tiff' })
    );
    mockAccess.mockRejectedValueOnce(
      Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    );
    mockReadFile.mockResolvedValueOnce(Buffer.from('tiff-data'));
    mockSharpToBuffer.mockResolvedValueOnce(Buffer.from('converted'));

    const result = await service.getBrowserCompatibleImage(
      '../../../etc/passwd',
      'user-1'
    );

    expect(result).toBeDefined();
  });
});

// ─── getBrowserCompatibleImage — video container / frame display ─────────────

describe('ImageService — getBrowserCompatibleImage video container', () => {
  it('returns the frame buffer when isVideoContainer=true with a valid channel', async () => {
    const service = makeService();
    prismaMock.image.findFirst.mockResolvedValueOnce(
      makeImage({
        id: 'container-1',
        name: 'video.nd2',
        originalPath: 'projects/p/img/container-1/original.nd2',
        mimeType: 'video/nd2',
        isVideoContainer: true,
        channels: [{ name: 'DAPI', isSegmentationSource: true }],
      })
    );
    mockReadFile.mockResolvedValueOnce(Buffer.from('frame-png-data'));

    const result = await service.getBrowserCompatibleImage('container-1', 'user-1');

    expect(result.mimeType).toBe('image/png');
    expect(result.buffer).toBeDefined();
  });

  it('falls through to the original buffer when getVideoFrameForDisplay returns null', async () => {
    const service = makeService();
    prismaMock.image.findFirst.mockResolvedValueOnce(
      makeImage({
        id: 'container-2',
        name: 'video.nd2',
        originalPath: 'projects/p/img/container-2/original.nd2',
        // browser-compatible so it falls through to the original buffer
        mimeType: 'image/jpeg',
        isVideoContainer: true,
        channels: [], // no channels → getVideoFrameForDisplay returns null
      })
    );
    mockReadFile.mockResolvedValueOnce(Buffer.from('original-data'));

    const result = await service.getBrowserCompatibleImage('container-2', 'user-1');

    expect(result.mimeType).toBe('image/jpeg');
  });
});

// ─── cleanupConvertedCache — background resilience (via display) ─────────────

describe('ImageService — cleanupConvertedCache', () => {
  it('returns without error when readdir throws ENOENT', async () => {
    const service = makeService();
    prismaMock.image.findFirst.mockResolvedValueOnce(
      makeImage({ mimeType: 'image/jpeg', name: 'photo.jpg' })
    );
    mockAccess.mockResolvedValueOnce(undefined); // cached path → cleanup runs
    mockReadFile.mockResolvedValueOnce(Buffer.from('cached-png'));
    mockReaddir.mockRejectedValueOnce(
      Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    );

    const result = await service.getBrowserCompatibleImage('img-1', 'user-1');

    expect(result).toBeDefined();
    await new Promise(r => setTimeout(r, 20)); // let background cleanup settle
  });

  it('does not propagate a stat failure during background cleanup', async () => {
    const service = makeService();
    prismaMock.image.findFirst.mockResolvedValueOnce(
      makeImage({ mimeType: 'image/jpeg', name: 'photo.jpg' })
    );
    mockAccess.mockResolvedValueOnce(undefined);
    mockReadFile.mockResolvedValueOnce(Buffer.from('cached-png'));
    mockReaddir.mockResolvedValueOnce(['file.png']);
    mockStat.mockRejectedValueOnce(new Error('Permission denied'));

    await expect(
      service.getBrowserCompatibleImage('img-1', 'user-1')
    ).resolves.toBeDefined();
    await new Promise(r => setTimeout(r, 20));
  });
});

// ─── getImageBuffer — error paths (via display) ──────────────────────────────

describe('ImageService — getImageBuffer error paths', () => {
  it('throws "Image file not found" when readFile returns ENOENT', async () => {
    const service = makeService();
    prismaMock.image.findFirst.mockResolvedValueOnce(
      makeImage({ mimeType: 'image/jpeg', name: 'photo.jpg' })
    );
    mockReadFile.mockRejectedValueOnce(
      Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    );

    await expect(
      service.getBrowserCompatibleImage('img-1', 'user-1')
    ).rejects.toThrow('Image file not found');
  });

  it('re-throws a non-ENOENT readFile error', async () => {
    const service = makeService();
    prismaMock.image.findFirst.mockResolvedValueOnce(
      makeImage({ mimeType: 'image/jpeg', name: 'photo.jpg' })
    );
    mockReadFile.mockRejectedValueOnce(new Error('Permission denied'));

    await expect(
      service.getBrowserCompatibleImage('img-1', 'user-1')
    ).rejects.toThrow('Permission denied');
  });
});
