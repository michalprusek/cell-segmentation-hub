/**
 * Every sharp call that reads a USER-supplied image must raise the pixel limit.
 *
 * sharp defaults `limitInputPixels` to 268.4 Mpx and rejects anything larger
 * with `Input image exceeds pixel limit`. A 2026-09-10 report — "a ~1 GB
 * single-channel TIFF would not upload, but the moment I converted it to PNG it
 * went straight through" — was that limit: the file is 22 324 x 22 324 =
 * 498.4 Mpx, so it failed the TIFF upload while generating the container
 * thumbnail AND left the converted copy unsegmentable. The format was never
 * the variable; the pixel count is.
 *
 * This is a SOURCE SCAN rather than a behavioural test on purpose. The failure
 * is one forgotten option at one call site out of fourteen, it only shows up on
 * an image larger than most test fixtures, and the cost of missing it is a
 * silent upload failure for exactly the users whose microscopes produce the
 * biggest files. Scanning is what makes a NEW `sharp(` call fail here rather
 * than in production.
 */

import { describe, it, expect, vi } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';
import sharp from 'sharp';
import {
  MAX_INPUT_PIXELS,
  SHARP_INPUT_LIMITS,
  segmentationTimeoutMs,
} from '../../constants/imageLimits';

// The global setup mocks sharp; the warning-tolerance tests need the real libvips.
vi.unmock('sharp');

const SRC = join(__dirname, '..', '..');

/** Call sites deliberately left on sharp's tight default, with the reason. */
const EXEMPT: Record<string, string> = {
  'services/authService.ts':
    'avatars are small by definition; the tight default is the right guard',
};

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '__tests__') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (entry.endsWith('.ts') && !entry.endsWith('.test.ts')) out.push(full);
  }
  return out;
}

describe('sharp input pixel limits', () => {
  it('is large enough for real microscopy, and still bounded', () => {
    // The reported image, and the reason a plain `false` is not used.
    expect(MAX_INPUT_PIXELS).toBeGreaterThan(498_400_000);
    expect(Number.isFinite(MAX_INPUT_PIXELS)).toBe(true);
  });

  it('every sharp() on a user image raises the limit', () => {
    const offenders: string[] = [];

    for (const file of walk(SRC)) {
      const rel = relative(SRC, file).replace(/\\/g, '/');
      if (EXEMPT[rel]) continue;
      const src = readFileSync(file, 'utf8');
      if (!src.includes('sharp(')) continue;

      // Each `sharp(` opener, with the text up to the end of its options.
      for (const m of src.matchAll(/sharp\(([^;]{0,400})/g)) {
        const call = m[1];
        if (
          call.includes('SHARP_INPUT_LIMITS') ||
          call.includes('limitInputPixels')
        ) {
          continue;
        }
        const line = src.slice(0, m.index).split('\n').length;
        offenders.push(`${rel}:${line}`);
      }
    }

    expect(offenders).toEqual([]);
  });
});

describe('sharp input warning tolerance', () => {
  // A real-shaped defect, not a mock: see fixtures/make_unterminated_ascii_tiff.py.
  const FIXTURE = join(__dirname, 'fixtures', 'unterminated-software-tag.tif');

  it('the fixture still reproduces the defect under sharp defaults', async () => {
    // Guards the test itself: if a sharp/libtiff upgrade stops warning, the
    // assertion below would pass vacuously.
    await expect(sharp(FIXTURE).png().toBuffer()).rejects.toThrow();
  });

  it('decodes a TIFF whose ASCII tag lacks its NUL terminator', async () => {
    const png = await sharp(FIXTURE, SHARP_INPUT_LIMITS).png().toBuffer();
    const meta = await sharp(png).metadata();
    expect([meta.width, meta.height, meta.channels]).toEqual([16, 16, 3]);
  });

  it('still refuses a truncated image', async () => {
    const whole = readFileSync(FIXTURE);
    const cut = whole.subarray(0, whole.length - 400);
    await expect(
      sharp(cut, SHARP_INPUT_LIMITS).png().toBuffer()
    ).rejects.toThrow();
  });
});

describe('segmentation timeout', () => {
  it('keeps the previous flat value for small frames', () => {
    // 44 Mpx measured at ~22 s, so the floor is what protects it, not the rate.
    expect(segmentationTimeoutMs(6664, 6657)).toBe(300_000);
  });

  it('covers the 498 Mpx frame that used to time out at 5 minutes', () => {
    // Measured end to end at 1 342 s once the accumulators moved off the GPU.
    const ms = segmentationTimeoutMs(22324, 22324);
    expect(ms).toBeGreaterThan(1_342_000);
    expect(ms).toBeLessThanOrEqual(45 * 60_000);
  });

  it('caps, rather than holding a connection open indefinitely', () => {
    expect(segmentationTimeoutMs(100_000, 100_000)).toBe(45 * 60_000);
  });

  it('falls back to the flat value when dimensions are unknown', () => {
    // An upload that failed part-way records no width/height.
    expect(segmentationTimeoutMs(null, null)).toBe(300_000);
    expect(segmentationTimeoutMs(0, 500)).toBe(300_000);
  });
});
