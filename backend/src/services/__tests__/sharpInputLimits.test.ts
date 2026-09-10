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

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';
import { MAX_INPUT_PIXELS } from '../../constants/imageLimits';

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
