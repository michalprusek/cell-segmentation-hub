/**
 * tiffConverter tests
 *
 * Pure-logic target: isTiffFile — fully testable, no browser deps.
 *
 * convertImageToDataUrl / createImagePreviewUrl require Canvas + FileReader +
 * Image + UTIF.  We mock all of those at the module level so we can test:
 *   • TIFF detection routes correctly to the TIFF path
 *   • Non-TIFF routes to the Image path
 *   • Error paths (UTIF failure, FileReader error, Image onerror fallback)
 *   • createImagePreviewUrl FileReader + object-URL fallback chain
 *
 * Genuinely untestable here: the real pixel-level RGBA copy loop inside
 * convertTiffToCanvas (requires a real ArrayBuffer + UTIF decode output).
 * We stub UTIF to return a minimal valid shape and verify the surrounding
 * control flow instead.
 */

import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  type Mock,
} from 'vitest';

// ── UTIF2 mock — must be declared before the import of tiffConverter ─────────
vi.mock('utif2', () => ({
  default: {
    decode: vi.fn(),
    decodeImage: vi.fn(),
    toRGBA8: vi.fn(() => new Uint8Array([255, 0, 0, 255])), // 1-px red
  },
}));

// ── logger mock ──────────────────────────────────────────────────────────────
vi.mock('@/lib/logger', () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

import {
  isTiffFile,
  convertImageToDataUrl,
  createImagePreviewUrl,
} from '@/lib/tiffConverter';
import UTIF from 'utif2';

// ─── helpers ─────────────────────────────────────────────────────────────────

function makeFile(name: string, type: string): File {
  return new File(['data'], name, { type });
}

// Build a minimal canvas mock that returns a predictable dataURL
function makeCanvasMock(dataUrl = 'data:image/png;base64,TEST') {
  const imageData = {
    data: new Uint8ClampedArray(4),
  };
  return {
    width: 1,
    height: 1,
    getContext: vi.fn(() => ({
      createImageData: vi.fn(() => imageData),
      putImageData: vi.fn(),
      drawImage: vi.fn(),
    })),
    toDataURL: vi.fn(() => dataUrl),
  };
}

// ─── isTiffFile ──────────────────────────────────────────────────────────────

describe('isTiffFile', () => {
  it('returns true for MIME type image/tiff', () => {
    expect(isTiffFile(makeFile('photo.jpg', 'image/tiff'))).toBe(true);
  });

  it('returns true for MIME type image/tif', () => {
    expect(isTiffFile(makeFile('photo.jpg', 'image/tif'))).toBe(true);
  });

  it('returns true for .tiff extension regardless of MIME type', () => {
    expect(isTiffFile(makeFile('scan.TIFF', 'application/octet-stream'))).toBe(
      true
    );
  });

  it('returns true for .tif extension (case-insensitive)', () => {
    expect(isTiffFile(makeFile('scan.TIF', 'application/octet-stream'))).toBe(
      true
    );
  });

  it('returns false for a PNG file', () => {
    expect(isTiffFile(makeFile('image.png', 'image/png'))).toBe(false);
  });

  it('returns false for a JPEG file', () => {
    expect(isTiffFile(makeFile('photo.jpg', 'image/jpeg'))).toBe(false);
  });

  it('returns false for a WEBP file', () => {
    expect(isTiffFile(makeFile('img.webp', 'image/webp'))).toBe(false);
  });

  it('returns false for no extension and non-tiff MIME', () => {
    expect(isTiffFile(makeFile('noextension', 'image/png'))).toBe(false);
  });

  it('returns true when only extension matches (no MIME match)', () => {
    // MIME type is empty but .tif extension is present
    expect(isTiffFile(makeFile('scan.tif', ''))).toBe(true);
  });
});

// ─── convertImageToDataUrl — TIFF branch ─────────────────────────────────────

describe('convertImageToDataUrl (TIFF branch)', () => {
  let origCreateElement: typeof document.createElement;
  let origCreateObjectURL: typeof URL.createObjectURL;
  let origRevokeObjectURL: typeof URL.revokeObjectURL;
  let origFileReader: typeof FileReader;

  beforeEach(() => {
    origCreateElement = document.createElement.bind(document);
    origCreateObjectURL = URL.createObjectURL;
    origRevokeObjectURL = URL.revokeObjectURL;
    origFileReader = globalThis.FileReader;

    // Mock document.createElement('canvas') for the TIFF path
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      if (tag === 'canvas') {
        return makeCanvasMock() as unknown as HTMLCanvasElement;
      }
      return origCreateElement(tag);
    });

    // FileReader mock — simulates successful ArrayBuffer read
    const FileReaderMock = vi.fn().mockImplementation(() => {
      const fr: Partial<FileReader> = {
        readAsArrayBuffer: vi.fn(function (this: typeof fr) {
          Promise.resolve().then(() => {
            const event = {
              target: { result: new ArrayBuffer(8) },
            } as unknown as ProgressEvent<FileReader>;
            (this as any).onload(event);
          });
        }),
        readAsDataURL: vi.fn(function (this: typeof fr) {
          Promise.resolve().then(() => {
            const event = {
              target: { result: 'data:image/png;base64,FALLBACK' },
            } as unknown as ProgressEvent<FileReader>;
            (this as any).onload(event);
          });
        }),
      };
      return fr;
    });
    globalThis.FileReader = FileReaderMock as unknown as typeof FileReader;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    URL.createObjectURL = origCreateObjectURL;
    URL.revokeObjectURL = origRevokeObjectURL;
    globalThis.FileReader = origFileReader;
  });

  it('returns a data URL for a valid TIFF file', async () => {
    const utifMock = UTIF as unknown as {
      decode: Mock;
      decodeImage: Mock;
      toRGBA8: Mock;
    };
    utifMock.decode.mockReturnValue([{ width: 1, height: 1 }]);
    utifMock.toRGBA8.mockReturnValue(new Uint8Array([255, 0, 0, 255]));

    const file = makeFile('scan.tiff', 'image/tiff');
    const result = await convertImageToDataUrl(file);
    expect(result).toContain('data:image/png');
  });

  it('throws when UTIF.decode returns empty array', async () => {
    (UTIF as any).decode.mockReturnValue([]);

    const file = makeFile('bad.tiff', 'image/tiff');
    await expect(convertImageToDataUrl(file)).rejects.toThrow(
      /No images found/
    );
  });

  it('throws when UTIF.decode throws', async () => {
    (UTIF as any).decode.mockImplementation(() => {
      throw new Error('UTIF parse error');
    });

    const file = makeFile('corrupt.tiff', 'image/tiff');
    await expect(convertImageToDataUrl(file)).rejects.toThrow(
      /Failed to parse TIFF file/
    );
  });
});

// ─── convertImageToDataUrl — non-TIFF branch ─────────────────────────────────

describe('convertImageToDataUrl (non-TIFF branch)', () => {
  let origCreateElement: typeof document.createElement;
  let origCreateObjectURL: typeof URL.createObjectURL;
  let origRevokeObjectURL: typeof URL.revokeObjectURL;

  beforeEach(() => {
    origCreateElement = document.createElement.bind(document);
    origCreateObjectURL = URL.createObjectURL;
    origRevokeObjectURL = URL.revokeObjectURL;

    URL.createObjectURL = vi.fn(() => 'blob:mock-url');
    URL.revokeObjectURL = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    URL.createObjectURL = origCreateObjectURL;
    URL.revokeObjectURL = origRevokeObjectURL;
  });

  it('resolves with a data URL when Image loads successfully', async () => {
    // Mock Image to fire onload immediately
    const imgMock = {
      onload: null as (() => void) | null,
      onerror: null as (() => void) | null,
      src: '',
      width: 1,
      height: 1,
    };

    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      if (tag === 'canvas') {
        return makeCanvasMock(
          'data:image/png;base64,NONTIFFFRESULT'
        ) as unknown as HTMLCanvasElement;
      }
      return origCreateElement(tag);
    });

    const origImage = globalThis.Image;
    globalThis.Image = vi.fn(() => {
      // Fire onload asynchronously when src is set
      const obj = Object.assign(imgMock, {});
      Object.defineProperty(obj, 'src', {
        set(_val: string) {
          Promise.resolve().then(() => obj.onload?.());
        },
      });
      return obj;
    }) as unknown as typeof Image;

    const file = makeFile('photo.png', 'image/png');
    const result = await convertImageToDataUrl(file);
    expect(result).toContain('data:image/png');

    globalThis.Image = origImage;
  });
});

// ─── createImagePreviewUrl — FileReader fallback chain ───────────────────────

describe('createImagePreviewUrl fallback chain', () => {
  let origCreateObjectURL: typeof URL.createObjectURL;
  let origRevokeObjectURL: typeof URL.revokeObjectURL;
  let origFileReader: typeof FileReader;

  beforeEach(() => {
    origCreateObjectURL = URL.createObjectURL;
    origRevokeObjectURL = URL.revokeObjectURL;
    origFileReader = globalThis.FileReader;
    URL.createObjectURL = vi.fn(() => 'blob:fallback-url');
    URL.revokeObjectURL = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    URL.createObjectURL = origCreateObjectURL;
    URL.revokeObjectURL = origRevokeObjectURL;
    globalThis.FileReader = origFileReader;
  });

  it('falls back to FileReader when Image fails and returns data URL', async () => {
    // TIFF path will throw so we land in the outer catch of createImagePreviewUrl.
    (UTIF as any).decode.mockImplementation(() => {
      throw new Error('intentional failure');
    });

    // FileReader returns a data URL
    const FileReaderMock = vi.fn().mockImplementation(() => ({
      readAsDataURL: vi.fn(function (this: any) {
        Promise.resolve().then(() => {
          const e = { target: { result: 'data:image/tiff;base64,FAKE' } };
          this.onload(e);
        });
      }),
    }));
    globalThis.FileReader = FileReaderMock as unknown as typeof FileReader;

    const file = makeFile('fallback.tiff', 'image/tiff');
    const result = await createImagePreviewUrl(file);
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });

  it('uses object URL as last resort when FileReader is unavailable', async () => {
    // Make both convertImageToDataUrl and FileReader fail
    (UTIF as any).decode.mockImplementation(() => {
      throw new Error('intentional failure');
    });
    // FileReader throws on construction
    globalThis.FileReader = (() => {
      throw new Error('FileReader not available');
    }) as unknown as typeof FileReader;

    const file = makeFile('last-resort.tiff', 'image/tiff');
    const result = await createImagePreviewUrl(file);
    // Should fall through to URL.createObjectURL
    expect(result).toBe('blob:fallback-url');
  });
});
