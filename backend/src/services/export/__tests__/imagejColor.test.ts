/**
 * imagejColor.test.ts — parity with the frontend colour math.
 *
 * The exported ROI stroke colour MUST match what the editor renders, otherwise
 * the same microtubule reads as one colour in the app and another in ImageJ.
 * `referenceHue` below re-implements the FE loop from
 * `src/pages/segmentation/utils/instanceColors.ts` INDEPENDENTLY (not imported),
 * so these tests fail if either side drifts.
 */

import { describe, it, expect } from 'vitest';
import {
  colorKeyForRoi,
  hueFromColorKey,
  imageJStrokeColor,
} from '../imagejColor';

/** Independent re-implementation of the FE hue hash for cross-checking. */
function referenceHue(key: string): number {
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = ((hash << 5) - hash + key.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % 360;
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
  it('matches the frontend hash for representative keys', () => {
    for (const key of ['mt_42', 'mt_0d08f27f', 'track_99', 'a', '']) {
      expect(hueFromColorKey(key)).toBe(referenceHue(key));
    }
  });

  it('pins the known FE hue for mt_42 (regression anchor)', () => {
    // Hand-computed from the djb2 loop; locks the algorithm so a refactor that
    // changes the hash is caught even if the FE reference above also drifts.
    expect(hueFromColorKey('mt_42')).toBe(62);
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

  it('encodes hsl(62, 70%, 55%) for mt_42 as RGB (215, 221, 60)', () => {
    // hue 62 → C=0.63, X≈0.609, m=0.235 → R≈0.844 G≈0.865 B≈0.235 → ×255.
    const argb = imageJStrokeColor('mt_42');
    const r = (argb >>> 16) & 0xff;
    const g = (argb >>> 8) & 0xff;
    const b = argb & 0xff;
    expect([r, g, b]).toEqual([215, 221, 60]);
  });

  it('returns opaque neutral gray (153,153,153) for an empty key', () => {
    const argb = imageJStrokeColor('');
    expect((argb >>> 24) & 0xff).toBe(0xff);
    expect((argb >>> 16) & 0xff).toBe(153);
    expect((argb >>> 8) & 0xff).toBe(153);
    expect(argb & 0xff).toBe(153);
  });
});
