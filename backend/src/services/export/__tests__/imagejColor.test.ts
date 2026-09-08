/**
 * imagejColor.test.ts — parity with the frontend colour math.
 *
 * The exported ROI stroke colour MUST match what the editor renders, otherwise
 * the same microtubule reads as one colour in the app and another in ImageJ.
 * These tests can only see the BACKEND half. `localHueCopy` below is a copy of
 * the same arithmetic living in this file, not an independent witness, so it
 * cannot fail when `src/pages/segmentation/utils/instanceColors.ts` changes —
 * proven on 2026-09-08, when the FE gained a x137 hue stride and this suite
 * stayed green while every exported .roi would have carried the old colour.
 * The cross-stack guard is `imagejColorParity.test.ts` on the frontend side,
 * which imports BOTH modules; the backend container bakes `backend/` alone and
 * cannot reach `src/`.
 */

import { describe, it, expect } from 'vitest';
import {
  colorKeyForRoi,
  hueFromColorKey,
  imageJStrokeColor,
  imageJColorFromHex,
} from '../imagejColor';

/**
 * A re-implementation of the FE hue arithmetic — and it is NOT an independent
 * check, whatever the old comment here claimed. It is a copy, in this file, of
 * the code it is comparing against, so it can only catch a change made to
 * `imagejColor.ts` alone; it cannot see the FRONTEND drift away, and on
 * 2026-09-08 it did not (the FE gained the x137 stride, every exported .roi
 * would have carried the old hue, and this suite stayed green). The real
 * cross-stack guard is `imagejColorParity.test.ts` on the frontend side, the
 * only suite that can import both modules. Kept because "the backend half did
 * not change under me" is still worth asserting cheaply.
 */
function localHueCopy(key: string): number {
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = ((hash << 5) - hash + key.charCodeAt(i)) | 0;
  }
  return (Math.abs(hash) * 137) % 360;
}

describe('colorKeyForRoi', () => {
  it('prefers trackId over instanceId and id', () => {
    expect(
      colorKeyForRoi({ trackId: 'mt_7', instanceId: 'mt_9', id: 'abc' })
    ).toBe('mt_7');
  });

  it('falls back to an mt_-prefixed instanceId when trackId is absent', () => {
    expect(colorKeyForRoi({ instanceId: 'mt_9', id: 'abc' })).toBe('mt_9');
  });

  it('ignores a non-mt instanceId and uses the id', () => {
    expect(colorKeyForRoi({ instanceId: 'sperm_3', id: 'abc' })).toBe('abc');
  });

  it('returns empty string when no identity is present', () => {
    expect(colorKeyForRoi({})).toBe('');
  });
});

describe('hueFromColorKey', () => {
  it('matches the local copy of the arithmetic for representative keys', () => {
    for (const key of ['mt_42', 'mt_0d08f27f', 'track_99', 'a', '']) {
      expect(hueFromColorKey(key)).toBe(localHueCopy(key));
    }
  });

  it('pins the known FE hue for mt_42 (regression anchor)', () => {
    // Hand-computed from `hash * 31 + charCode` then the x137 stride; locks the
    // arithmetic so a refactor is caught even if the copy above drifts with it.
    // Was 62 before the stride landed on 2026-09-08.
    expect(hueFromColorKey('mt_42')).toBe(214);
  });

  it('is stable and bounded to [0, 359]', () => {
    for (const key of ['mt_1', 'mt_2', 'x'.repeat(50), 'µ_αβ']) {
      const h = hueFromColorKey(key);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(360);
      expect(hueFromColorKey(key)).toBe(h);
    }
  });
});

describe('imageJStrokeColor', () => {
  it('always sets an opaque alpha (0xFF) so ImageJ treats the colour as set', () => {
    const argb = imageJStrokeColor('mt_42');
    expect((argb >>> 24) & 0xff).toBe(0xff);
  });

  it('is a stable, unsigned 32-bit value per key', () => {
    const a = imageJStrokeColor('mt_42');
    expect(a).toBe(imageJStrokeColor('mt_42'));
    expect(a).toBeGreaterThanOrEqual(0);
    expect(a).toBeLessThanOrEqual(0xffffffff);
  });

  it('produces different colours for different tracks', () => {
    expect(imageJStrokeColor('mt_aaa')).not.toBe(imageJStrokeColor('mt_bbb'));
  });

  it('encodes hsl(214, 70%, 55%) for mt_42 as RGB (60, 130, 221)', () => {
    // hue 214 → C=0.63, X≈0.147, m=0.235 → R=0.235 G≈0.382 B≈0.865 → ×255.
    const argb = imageJStrokeColor('mt_42');
    const r = (argb >>> 16) & 0xff;
    const g = (argb >>> 8) & 0xff;
    const b = argb & 0xff;
    expect([r, g, b]).toEqual([60, 130, 221]);
  });

  it('returns opaque neutral gray (153,153,153) for an empty key', () => {
    const argb = imageJStrokeColor('');
    expect((argb >>> 24) & 0xff).toBe(0xff);
    expect((argb >>> 16) & 0xff).toBe(153);
    expect((argb >>> 8) & 0xff).toBe(153);
    expect(argb & 0xff).toBe(153);
  });
});

describe('imageJStrokeColor hue coverage', () => {
  it('produces a valid opaque ARGB across every hslToRgb hue sextant', () => {
    // Many keys hash to hues spanning all six 60°-sextants, exercising each
    // branch of the HSL→RGB conversion.
    const hues = new Set<number>();
    for (let i = 0; i < 200; i++) {
      const key = `mt_${i}`;
      const argb = imageJStrokeColor(key);
      expect((argb >>> 24) & 0xff).toBe(0xff); // opaque
      hues.add(Math.floor(hueFromColorKey(key) / 60)); // 0..5
    }
    // All six sextants observed → every hslToRgb branch was taken.
    expect(hues.size).toBe(6);
  });
});

describe('imageJColorFromHex', () => {
  it('packs a #RRGGBB label colour into an opaque ARGB int', () => {
    const argb = imageJColorFromHex('#ff8040');
    expect((argb >>> 24) & 0xff).toBe(0xff); // opaque alpha
    expect((argb >>> 16) & 0xff).toBe(0xff);
    expect((argb >>> 8) & 0xff).toBe(0x80);
    expect(argb & 0xff).toBe(0x40);
  });

  it('trims surrounding whitespace', () => {
    expect(imageJColorFromHex('  #ff8040  ')).toBe(imageJColorFromHex('#ff8040'));
  });

  it('falls back to the neutral "no key" colour for a malformed hex', () => {
    const neutral = imageJStrokeColor('');
    expect(imageJColorFromHex('nothex')).toBe(neutral);
    expect(imageJColorFromHex('#fff')).toBe(neutral); // 3-digit not accepted
    expect(imageJColorFromHex('')).toBe(neutral);
  });
});
