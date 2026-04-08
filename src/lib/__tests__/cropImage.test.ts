import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createCroppedImage,
  cropImageToCircle,
  blobToBase64,
} from '@/lib/cropImage';
import type { Area } from 'react-easy-crop';

// A minimal 2d context mock that does NOT rely on DOMMatrix.translate / DOMMatrix.scale.
// The full canvasTestUtils mock breaks after vi.clearAllMocks() because it chains
// DOMMatrix method calls — this simple mock avoids that fragility.
function createSimpleCtxMock() {
  const scaleSpy = vi.fn();
  const translateSpy = vi.fn();
  const rotateSpy = vi.fn();
  const drawImageSpy = vi.fn();
  const beginPathSpy = vi.fn();
  const arcSpy = vi.fn();
  const clipSpy = vi.fn();
  const saveSpy = vi.fn();
  const restoreSpy = vi.fn();

  return {
    translate: translateSpy,
    scale: scaleSpy,
    rotate: rotateSpy,
    drawImage: drawImageSpy,
    beginPath: beginPathSpy,
    arc: arcSpy,
    clip: clipSpy,
    save: saveSpy,
    restore: restoreSpy,
    // Expose spies for assertions
    _spies: { scaleSpy, translateSpy, rotateSpy, drawImageSpy },
  };
}

// Helper to set up the Image mock so the load event fires automatically,
// simulating a successfully loaded image.
function setupImageMock(width = 400, height = 300) {
  global.Image = vi.fn().mockImplementation(() => {
    const img: any = {
      addEventListener: vi.fn((event: string, handler: () => void) => {
        if (event === 'load') {
          // Schedule the load callback asynchronously so src is set first
          Promise.resolve().then(handler);
        }
      }),
      removeEventListener: vi.fn(),
      setAttribute: vi.fn(),
      naturalWidth: width,
      naturalHeight: height,
      width,
      height,
      complete: true,
      src: '',
    };
    return img;
  }) as any;
}

// Helper to set up the Image mock so the error event fires automatically.
function setupImageErrorMock() {
  global.Image = vi.fn().mockImplementation(() => {
    const img: any = {
      addEventListener: vi.fn((event: string, handler: (e: Event) => void) => {
        if (event === 'error') {
          Promise.resolve().then(() => handler(new Event('error')));
        }
      }),
      removeEventListener: vi.fn(),
      setAttribute: vi.fn(),
      src: '',
    };
    return img;
  }) as any;
}

describe('cropImage', () => {
  let ctxMock: ReturnType<typeof createSimpleCtxMock>;

  beforeEach(() => {
    ctxMock = createSimpleCtxMock();

    // Override getContext to return our simple mock instead of the DOMMatrix-based one
    HTMLCanvasElement.prototype.getContext = vi.fn((contextType: string) => {
      if (contextType === '2d') return ctxMock as any;
      return null;
    });

    // Ensure toBlob resolves with a proper JPEG blob by default
    HTMLCanvasElement.prototype.toBlob = vi.fn(
      (callback: BlobCallback, _type?: string, _quality?: number) => {
        callback(new Blob(['mock-image-data'], { type: 'image/jpeg' }));
      }
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('createCroppedImage', () => {
    it('resolves to a Blob for a valid crop area', async () => {
      setupImageMock(400, 300);

      const crop: Area = { x: 10, y: 10, width: 100, height: 80 };
      const blob = await createCroppedImage('data:image/jpeg;base64,abc', crop);

      expect(blob).toBeInstanceOf(Blob);
    });

    it('returned blob has the jpeg mime type', async () => {
      setupImageMock(400, 300);

      const crop: Area = { x: 0, y: 0, width: 200, height: 150 };
      const blob = await createCroppedImage('data:image/jpeg;base64,abc', crop);

      expect(blob.type).toBe('image/jpeg');
    });

    it('calls translate and rotate on the canvas context', async () => {
      setupImageMock(400, 300);

      const crop: Area = { x: 10, y: 10, width: 100, height: 80 };
      await createCroppedImage(
        'data:image/jpeg;base64,abc',
        crop,
        undefined,
        45
      );

      // translate should be called (to position crop center and offset)
      expect(ctxMock._spies.translateSpy).toHaveBeenCalled();
      // rotate should be called when rotation is non-zero
      expect(ctxMock._spies.rotateSpy).toHaveBeenCalled();
    });

    it('applies horizontal flip transformation when requested', async () => {
      setupImageMock(400, 300);

      const crop: Area = { x: 0, y: 0, width: 100, height: 80 };
      await createCroppedImage('data:image/jpeg;base64,abc', crop, {
        horizontal: true,
        vertical: false,
      });

      // scale(-1, 1) should have been called for horizontal flip
      expect(ctxMock._spies.scaleSpy).toHaveBeenCalledWith(-1, 1);
    });

    it('rejects when the image fails to load', async () => {
      setupImageErrorMock();

      const crop: Area = { x: 0, y: 0, width: 100, height: 80 };
      await expect(
        createCroppedImage('http://invalid.example/img.jpg', crop)
      ).rejects.toThrow();
    });

    it('rejects when canvas returns null blob', async () => {
      setupImageMock(400, 300);

      HTMLCanvasElement.prototype.toBlob = vi.fn((callback: BlobCallback) => {
        callback(null);
      });

      const crop: Area = { x: 0, y: 0, width: 100, height: 80 };
      await expect(
        createCroppedImage('data:image/jpeg;base64,abc', crop)
      ).rejects.toThrow('Failed to create blob from canvas');
    });
  });

  describe('cropImageToCircle', () => {
    it('resolves to a Blob', async () => {
      setupImageMock(400, 400);

      const crop: Area = { x: 50, y: 50, width: 200, height: 200 };
      const blob = await cropImageToCircle('data:image/jpeg;base64,abc', crop);

      expect(blob).toBeInstanceOf(Blob);
    });

    it('creates a circular clip path (arc + clip are called)', async () => {
      setupImageMock(400, 400);

      const crop: Area = { x: 0, y: 0, width: 200, height: 200 };
      await cropImageToCircle('data:image/jpeg;base64,abc', crop);

      // Circular crop requires arc and clip calls
      expect(ctxMock.arc).toHaveBeenCalled();
      expect(ctxMock.clip).toHaveBeenCalled();
    });

    it('rejects when canvas returns null blob', async () => {
      setupImageMock(400, 400);

      HTMLCanvasElement.prototype.toBlob = vi.fn((callback: BlobCallback) => {
        callback(null);
      });

      const crop: Area = { x: 0, y: 0, width: 100, height: 100 };
      await expect(
        cropImageToCircle('data:image/jpeg;base64,abc', crop)
      ).rejects.toThrow('Failed to create blob from canvas');
    });
  });

  describe('blobToBase64', () => {
    it('resolves with a base64 data URL string', async () => {
      // Use a real FileReader-friendly approach: override global FileReader
      const fakeResult = 'data:image/jpeg;base64,/9j/abc123';

      global.FileReader = vi.fn().mockImplementation(() => {
        const reader: any = {
          onload: null,
          onerror: null,
          result: fakeResult,
          readAsDataURL: vi.fn(function (this: any) {
            Promise.resolve().then(() => {
              if (this.onload) this.onload({ target: this });
            });
          }),
        };
        // Bind readAsDataURL so `this` refers to the reader instance
        reader.readAsDataURL = reader.readAsDataURL.bind(reader);
        return reader;
      }) as any;

      const blob = new Blob(['fake'], { type: 'image/jpeg' });
      const result = await blobToBase64(blob);

      expect(typeof result).toBe('string');
      expect(result).toBe(fakeResult);
    });

    it('rejects when FileReader encounters an error', async () => {
      global.FileReader = vi.fn().mockImplementation(() => {
        const reader: any = {
          onload: null,
          onerror: null,
          result: null,
          readAsDataURL: vi.fn(function (this: any) {
            Promise.resolve().then(() => {
              if (this.onerror) this.onerror(new Error('read error'));
            });
          }),
        };
        reader.readAsDataURL = reader.readAsDataURL.bind(reader);
        return reader;
      }) as any;

      const blob = new Blob(['fake'], { type: 'image/jpeg' });
      await expect(blobToBase64(blob)).rejects.toBeTruthy();
    });
  });
});
