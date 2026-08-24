import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { decodeWebpGray, canDecodeWebpGray } from '../webpGray';

/**
 * jsdom has neither `createImageBitmap` nor `OffscreenCanvas`, so both are
 * stubbed the way the decode-worker tests stub theirs. The arithmetic under
 * test — RGBA stride, min/max, bit depth — is ours; the browser's decoding is
 * not, and pretending to test it here would only test the stub.
 */
function installStubs(
  width: number,
  height: number,
  grayValues: number[]
): { close: ReturnType<typeof vi.fn> } {
  const close = vi.fn();
  const rgba = new Uint8ClampedArray(width * height * 4);
  grayValues.forEach((v, i) => {
    rgba[i * 4] = v;
    rgba[i * 4 + 1] = v;
    rgba[i * 4 + 2] = v;
    rgba[i * 4 + 3] = 255;
  });

  vi.stubGlobal(
    'createImageBitmap',
    vi.fn(async () => ({ width, height, close }))
  );
  vi.stubGlobal(
    'OffscreenCanvas',
    class {
      constructor(
        public width: number,
        public height: number
      ) {}
      getContext() {
        return {
          drawImage: vi.fn(),
          getImageData: () => ({ data: rgba }),
        };
      }
    }
  );
  return { close };
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('canDecodeWebpGray', () => {
  it('is false when the browser lacks the APIs', () => {
    vi.stubGlobal('createImageBitmap', undefined);
    vi.stubGlobal('OffscreenCanvas', undefined);
    expect(canDecodeWebpGray()).toBe(false);
  });

  it('is true once both are present', () => {
    installStubs(1, 1, [0]);
    expect(canDecodeWebpGray()).toBe(true);
  });
});

describe('decodeWebpGray', () => {
  it('takes one sample per pixel out of the RGBA quads', async () => {
    installStubs(2, 2, [0, 64, 128, 255]);

    const out = await decodeWebpGray(new Blob(), 255);

    // Range 255 is the identity mapping, so this isolates the RGBA stride
    // from the expansion arithmetic tested further down.
    expect(Array.from(out.data)).toEqual([0, 64, 128, 255]);
    expect(out.width).toBe(2);
    expect(out.height).toBe(2);
  });

  it('always reports data units, never raw proxy samples', async () => {
    installStubs(1, 1, [7]);

    const out = await decodeWebpGray(new Blob(), 2047);

    // The old signature let a caller omit the range and get 0..255 back. Those
    // samples reaching the compositor draw the frame rangeMax/255 too dark —
    // 8x here, 128x on the brightest channel — with nothing to show it.
    expect(out.bitDepth).toBe(16);
    expect(out.data).toBeInstanceOf(Uint16Array);
  });

  it('refuses a proxy whose range was lost', async () => {
    installStubs(1, 1, [7]);

    await expect(decodeWebpGray(new Blob(), Number.NaN)).rejects.toThrow(
      /needs its range/
    );
    await expect(decodeWebpGray(new Blob(), 0)).rejects.toThrow(
      /needs its range/
    );
  });

  it('reports min and max in data units, for auto-contrast', async () => {
    installStubs(2, 2, [30, 200, 45, 90]);

    const out = await decodeWebpGray(new Blob(), 255);

    expect(out.min).toBe(30);
    expect(out.max).toBe(200);
  });

  it('does not report an inverted window for an empty frame', async () => {
    installStubs(0, 0, []);

    const out = await decodeWebpGray(new Blob(), 2047);

    expect(out.min).toBe(0);
    expect(out.max).toBe(0);
  });

  it('closes the bitmap, which holds pixels off the JS heap', async () => {
    const { close } = installStubs(1, 1, [1]);

    await decodeWebpGray(new Blob(), 2047);

    expect(close).toHaveBeenCalledOnce();
  });

  it('closes the bitmap even when reading it back fails', async () => {
    const { close } = installStubs(1, 1, [1]);
    vi.stubGlobal(
      'OffscreenCanvas',
      class {
        getContext() {
          return null;
        }
      }
    );

    await expect(decodeWebpGray(new Blob(), 2047)).rejects.toThrow(
      /2d context/
    );
    expect(close).toHaveBeenCalledOnce();
  });
});

describe('decodeWebpGray expanding back into the data units', () => {
  it('maps 255 onto the range and 0 onto 0', () => {
    installStubs(2, 1, [0, 255]);

    return decodeWebpGray(new Blob(), 2047).then(out => {
      expect(Array.from(out.data)).toEqual([0, 2047]);
    });
  });

  it('hands the compositor 16-bit samples, like the PNG path does', async () => {
    installStubs(1, 1, [128]);

    const out = await decodeWebpGray(new Blob(), 2047);

    expect(out.bitDepth).toBe(16);
    expect(out.data).toBeInstanceOf(Uint16Array);
  });

  it('reports min and max in the data units too', async () => {
    // Otherwise auto-contrast would propose a window of 0..255 against
    // samples that run to 2047, and the frame would come up nearly white.
    installStubs(2, 1, [0, 255]);

    const out = await decodeWebpGray(new Blob(), 2047);

    expect(out.min).toBe(0);
    expect(out.max).toBe(2047);
  });

  it('is coarser than the original, which is the bargain being struck', async () => {
    installStubs(2, 1, [10, 11]);

    const out = await decodeWebpGray(new Blob(), 2047);

    // One proxy level is rangeMax/255 ≈ 8 original units; nothing in between
    // survives, which is what `windowNeedsFullDepth` exists to bound.
    expect(out.data[1] - out.data[0]).toBe(8);
  });
});
