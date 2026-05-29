import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks — must precede all imports
// ---------------------------------------------------------------------------

const { fsMock, existsSyncMock, sharpMock, sharpInst } = vi.hoisted(() => {
  const fsMock = {
    mkdir: vi.fn(),
    writeFile: vi.fn(),
    unlink: vi.fn(),
    stat: vi.fn(),
    readFile: vi.fn(),
  };

  const existsSyncMock = vi.fn();

  // A single chainable sharp instance reused across calls
  const sharpInst = {
    metadata: vi.fn(),
    resize: vi.fn(),
    jpeg: vi.fn(),
    toFile: vi.fn(),
  };
  sharpInst.resize.mockReturnValue(sharpInst);
  sharpInst.jpeg.mockReturnValue(sharpInst);

  const sharpMock = vi.fn().mockReturnValue(sharpInst);

  return { fsMock, existsSyncMock, sharpMock, sharpInst };
});

// fs/promises is imported as `import fs from 'fs/promises'` (default import of the promise namespace).
// Vitest requires the mock to export `default` to satisfy that import.
vi.mock('fs/promises', () => ({
  default: fsMock,
  ...fsMock,
}));

vi.mock('fs', () => ({
  default: { existsSync: existsSyncMock },
  existsSync: existsSyncMock,
}));

vi.mock('sharp', () => ({ default: sharpMock }));

vi.mock('../../utils/config', () => ({
  config: { UPLOAD_DIR: '/app/uploads' },
}));

vi.mock('../../utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../utils/getBaseUrl', () => ({
  getBaseUrl: vi.fn().mockReturnValue('http://localhost:3001'),
}));

// ---------------------------------------------------------------------------
// Import the module under test AFTER mocks are registered
// ---------------------------------------------------------------------------

import { LocalStorageProvider } from '../localStorage';
import { StorageError } from '../interface';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('LocalStorageProvider', () => {
  let provider: LocalStorageProvider;

  beforeEach(() => {
    vi.clearAllMocks();

    // Restore chainable returns after clearAllMocks wipes them
    sharpInst.resize.mockReturnValue(sharpInst);
    sharpInst.jpeg.mockReturnValue(sharpInst);
    sharpMock.mockReturnValue(sharpInst);

    // Default fs behaviour
    fsMock.mkdir.mockResolvedValue(undefined);
    fsMock.writeFile.mockResolvedValue(undefined);
    fsMock.unlink.mockResolvedValue(undefined);
    fsMock.readFile.mockResolvedValue(Buffer.from('data'));
    fsMock.stat.mockResolvedValue({
      size: 1024,
      mtime: new Date('2024-01-01T00:00:00Z'),
    });

    // Default: sharp reports PNG 100×80
    sharpInst.metadata.mockResolvedValue({
      width: 100,
      height: 80,
      format: 'png',
    });
    sharpInst.toFile.mockResolvedValue(undefined);

    // Files don't exist by default
    existsSyncMock.mockReturnValue(false);

    provider = new LocalStorageProvider();
    // Clear the mkdir call from the constructor so per-test assertions are clean
    fsMock.mkdir.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // Constructor
  // -------------------------------------------------------------------------

  describe('constructor', () => {
    it('calls mkdir with the configured uploadDir and recursive:true', () => {
      // Re-create so we can capture the constructor's mkdir call
      fsMock.mkdir.mockResolvedValue(undefined);
      new LocalStorageProvider();
      expect(fsMock.mkdir).toHaveBeenCalledWith('/app/uploads', {
        recursive: true,
      });
    });
  });

  // -------------------------------------------------------------------------
  // upload()
  // -------------------------------------------------------------------------

  describe('upload()', () => {
    it('writes the buffer to the correct absolute path', async () => {
      const buf = Buffer.from('hello');
      await provider.upload(buf, 'user1/proj1/originals/file.png');

      expect(fsMock.writeFile).toHaveBeenCalledWith(
        '/app/uploads/user1/proj1/originals/file.png',
        buf
      );
    });

    it('returns correct UploadResult with dimensions from sharp', async () => {
      const buf = Buffer.from('image-data');
      const result = await provider.upload(buf, 'a/b/originals/img.png');

      expect(result.fileSize).toBe(buf.length);
      expect(result.mimeType).toBe('image/png');
      expect(result.width).toBe(100);
      expect(result.height).toBe(80);
      expect(result.originalPath).toBe('a/b/originals/img.png');
    });

    it('falls back to provided mimeType when sharp metadata fails', async () => {
      sharpInst.metadata.mockRejectedValue(new Error('not an image'));

      const buf = Buffer.from('binary');
      const result = await provider.upload(buf, 'a/b/originals/file.bin', {
        mimeType: 'application/octet-stream',
      });

      expect(result.mimeType).toBe('application/octet-stream');
      expect(result.width).toBeUndefined();
    });

    it('generates thumbnail when generateThumbnail=true and image mimeType', async () => {
      sharpInst.metadata.mockResolvedValue({
        width: 200,
        height: 150,
        format: 'jpeg',
      });

      const buf = Buffer.from('image-data');
      const result = await provider.upload(buf, 'u/p/originals/photo.jpg', {
        generateThumbnail: true,
        mimeType: 'image/jpeg',
      });

      // thumbnailKey replaces 'originals' with 'thumbnails' and extension with .jpg
      expect(result.thumbnailPath).toBe('u/p/thumbnails/photo.jpg');
      expect(sharpInst.toFile).toHaveBeenCalledWith(
        '/app/uploads/u/p/thumbnails/photo.jpg'
      );
    });

    it('does NOT generate thumbnail for non-image MIME type', async () => {
      // Make sharp not detect image format so mimeType stays 'application/octet-stream'
      sharpInst.metadata.mockRejectedValue(new Error('not an image'));

      const buf = Buffer.from('data');
      const result = await provider.upload(buf, 'u/p/originals/file.bin', {
        generateThumbnail: true,
        mimeType: 'application/octet-stream',
      });

      expect(result.thumbnailPath).toBeUndefined();
      expect(sharpInst.toFile).not.toHaveBeenCalled();
    });

    it('does not fail the upload when thumbnail generation throws', async () => {
      sharpInst.toFile.mockRejectedValue(new Error('sharp resize failed'));

      const buf = Buffer.from('image');
      // Should not throw — thumbnail errors are swallowed
      const result = await provider.upload(buf, 'u/p/originals/img.png', {
        generateThumbnail: true,
      });

      expect(result.originalPath).toBe('u/p/originals/img.png');
      expect(result.thumbnailPath).toBeUndefined();
    });

    it('wraps fs.writeFile errors in StorageError(UPLOAD_FAILED)', async () => {
      fsMock.writeFile.mockRejectedValue(new Error('ENOSPC: no space left'));

      await expect(
        provider.upload(Buffer.from('x'), 'a/b/originals/f.png')
      ).rejects.toMatchObject({ code: 'UPLOAD_FAILED', statusCode: 500 });
    });

    it('ensures the file directory is created before writing', async () => {
      await provider.upload(Buffer.from('d'), 'u1/p1/originals/deep/file.png');

      const mkdirCalls = fsMock.mkdir.mock.calls.map((c: unknown[]) => c[0]);
      expect(mkdirCalls).toContain('/app/uploads/u1/p1/originals/deep');
    });
  });

  // -------------------------------------------------------------------------
  // delete()
  // -------------------------------------------------------------------------

  describe('delete()', () => {
    it('deletes an existing file via unlink', async () => {
      existsSyncMock.mockReturnValue(true);
      await provider.delete('u/p/originals/img.png');

      expect(fsMock.unlink).toHaveBeenCalledWith(
        '/app/uploads/u/p/originals/img.png'
      );
    });

    it('skips unlink when file does not exist (existsSync returns false)', async () => {
      existsSyncMock.mockReturnValue(false);
      await provider.delete('u/p/originals/missing.png');

      expect(fsMock.unlink).not.toHaveBeenCalled();
    });

    it('also deletes the corresponding thumbnail for non-avatar keys', async () => {
      existsSyncMock.mockReturnValue(true);
      await provider.delete('u/p/originals/img.png');

      const unlinkCalls = fsMock.unlink.mock.calls.map((c: unknown[]) => c[0]);
      expect(unlinkCalls).toContain('/app/uploads/u/p/originals/img.png');
      expect(unlinkCalls).toContain('/app/uploads/u/p/thumbnails/img.jpg');
    });

    it('does NOT attempt thumbnail deletion for avatar keys', async () => {
      existsSyncMock.mockReturnValue(true);
      await provider.delete('avatars/user-123/avatar.jpg');

      const unlinkCalls = fsMock.unlink.mock.calls.map((c: unknown[]) => c[0]);
      // Only the original file, no thumbnail attempt
      expect(unlinkCalls).toHaveLength(1);
      expect(unlinkCalls[0]).toContain('avatars/user-123/avatar.jpg');
    });

    it('wraps fs.unlink errors in StorageError(DELETE_FAILED)', async () => {
      existsSyncMock.mockReturnValue(true);
      fsMock.unlink.mockRejectedValue(new Error('EPERM'));

      await expect(
        provider.delete('u/p/originals/img.png')
      ).rejects.toMatchObject({
        code: 'DELETE_FAILED',
        statusCode: 500,
      });
    });
  });

  // -------------------------------------------------------------------------
  // exists()
  // -------------------------------------------------------------------------

  describe('exists()', () => {
    it('returns true when existsSync says file is present', async () => {
      existsSyncMock.mockReturnValue(true);
      expect(await provider.exists('some/key.png')).toBe(true);
    });

    it('returns false when existsSync says file is absent', async () => {
      existsSyncMock.mockReturnValue(false);
      expect(await provider.exists('some/key.png')).toBe(false);
    });

    it('constructs the absolute path from uploadDir + key', async () => {
      existsSyncMock.mockReturnValue(false);
      await provider.exists('user/proj/originals/x.jpg');

      expect(existsSyncMock).toHaveBeenCalledWith(
        '/app/uploads/user/proj/originals/x.jpg'
      );
    });
  });

  // -------------------------------------------------------------------------
  // getUrl()
  // -------------------------------------------------------------------------

  describe('getUrl()', () => {
    const originalEnv = process.env.NODE_ENV;

    afterEach(() => {
      process.env.NODE_ENV = originalEnv;
    });

    it('returns a relative /uploads/<key> URL in production', async () => {
      process.env.NODE_ENV = 'production';
      const url = await provider.getUrl('u/p/originals/img.png');
      expect(url).toBe('/uploads/u/p/originals/img.png');
    });

    it('returns the baseUrl-prefixed URL in development', async () => {
      process.env.NODE_ENV = 'development';
      const url = await provider.getUrl('u/p/originals/img.png');
      expect(url).toBe('http://localhost:3001/uploads/u/p/originals/img.png');
    });
  });

  // -------------------------------------------------------------------------
  // getMetadata()
  // -------------------------------------------------------------------------

  describe('getMetadata()', () => {
    it('returns size and lastModified from fs.stat', async () => {
      const mtime = new Date('2024-06-01T12:00:00Z');
      fsMock.stat.mockResolvedValue({ size: 2048, mtime });

      const meta = await provider.getMetadata('u/p/originals/img.jpg');

      expect(meta.size).toBe(2048);
      expect(meta.lastModified).toEqual(mtime);
    });

    it('infers mimeType from file extension for known types', async () => {
      const cases: [string, string][] = [
        ['file.jpg', 'image/jpeg'],
        ['file.jpeg', 'image/jpeg'],
        ['file.png', 'image/png'],
        ['file.bmp', 'image/bmp'],
        ['file.tiff', 'image/tiff'],
        ['file.tif', 'image/tiff'],
      ];

      for (const [filename, expectedMime] of cases) {
        const meta = await provider.getMetadata(`u/p/originals/${filename}`);
        expect(meta.mimeType).toBe(expectedMime);
      }
    });

    it('falls back to application/octet-stream for unknown extensions', async () => {
      const meta = await provider.getMetadata('u/p/originals/file.bin');
      expect(meta.mimeType).toBe('application/octet-stream');
    });

    it('wraps fs.stat errors in StorageError(METADATA_FAILED)', async () => {
      fsMock.stat.mockRejectedValue(
        Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
      );

      await expect(
        provider.getMetadata('u/p/originals/missing.png')
      ).rejects.toMatchObject({ code: 'METADATA_FAILED', statusCode: 500 });
    });
  });

  // -------------------------------------------------------------------------
  // getBuffer()
  // -------------------------------------------------------------------------

  describe('getBuffer()', () => {
    it('reads and returns file contents when file exists', async () => {
      const data = Buffer.from('raw-file-bytes');
      existsSyncMock.mockReturnValue(true);
      fsMock.readFile.mockResolvedValue(data);

      const result = await provider.getBuffer('u/p/originals/img.png');

      expect(result).toEqual(data);
      expect(fsMock.readFile).toHaveBeenCalledWith(
        '/app/uploads/u/p/originals/img.png'
      );
    });

    it('throws StorageError(FILE_NOT_FOUND, 404) when file does not exist', async () => {
      existsSyncMock.mockReturnValue(false);

      await expect(
        provider.getBuffer('u/p/originals/missing.png')
      ).rejects.toMatchObject({
        code: 'FILE_NOT_FOUND',
        statusCode: 404,
      });
    });

    it('wraps unexpected fs.readFile errors in StorageError(BUFFER_FAILED)', async () => {
      existsSyncMock.mockReturnValue(true);
      fsMock.readFile.mockRejectedValue(new Error('EIO: input/output error'));

      await expect(
        provider.getBuffer('u/p/originals/img.png')
      ).rejects.toMatchObject({ code: 'BUFFER_FAILED', statusCode: 500 });
    });
  });

  // -------------------------------------------------------------------------
  // generateKey() — static
  // -------------------------------------------------------------------------

  describe('generateKey()', () => {
    it('produces a path with the structure userId/projectId/originals/timestamp_name.ext', () => {
      const key = LocalStorageProvider.generateKey(
        'uid-1',
        'pid-2',
        'photo.png'
      );
      expect(key).toMatch(/^uid-1\/pid-2\/originals\/\d+_photo\.png$/);
    });

    it('puts thumbnails in the thumbnails folder when isOriginal=false', () => {
      const key = LocalStorageProvider.generateKey('u', 'p', 'img.jpg', false);
      expect(key).toContain('/thumbnails/');
    });

    it('falls back to "unknown" for undefined userId or projectId', () => {
      const key = LocalStorageProvider.generateKey(
        undefined,
        undefined,
        'file.png'
      );
      expect(key).toMatch(/^unknown\/unknown\/originals\//);
    });

    it('strips path traversal sequences from the filename', () => {
      const key = LocalStorageProvider.generateKey(
        'u',
        'p',
        '../../etc/passwd.png'
      );
      expect(key).not.toContain('..');
      expect(key).not.toContain('/etc/');
    });

    it('strips path traversal sequences from userId and projectId', () => {
      const key = LocalStorageProvider.generateKey(
        '../evil',
        '../../root',
        'f.png'
      );
      expect(key).not.toContain('../');
    });

    it('lowercases the extension', () => {
      const key = LocalStorageProvider.generateKey('u', 'p', 'IMAGE.PNG');
      expect(key).toMatch(/\.png$/);
    });

    it('replaces spaces with underscores in the filename', () => {
      const key = LocalStorageProvider.generateKey('u', 'p', 'my photo.jpg');
      const filename = key.split('/').pop() ?? '';
      expect(filename).not.toContain(' ');
      expect(filename).toContain('_');
    });
  });
});
