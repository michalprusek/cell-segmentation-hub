import { describe, it, expect } from 'vitest';
import { colorFromInstanceId, isMicrotubuleInstance } from '../instanceColors';

describe('isMicrotubuleInstance', () => {
  it('returns true for mt_-prefixed strings', () => {
    expect(isMicrotubuleInstance('mt_0d08f27f')).toBe(true);
    expect(isMicrotubuleInstance('mt_42')).toBe(true);
    expect(isMicrotubuleInstance('mt_')).toBe(true);
  });

  it('returns false for non-microtubule IDs', () => {
    expect(isMicrotubuleInstance('sperm_3')).toBe(false);
    expect(isMicrotubuleInstance('mt')).toBe(false);
    expect(isMicrotubuleInstance('MT_42')).toBe(false);
  });

  it('returns false for null / undefined / empty', () => {
    expect(isMicrotubuleInstance(null)).toBe(false);
    expect(isMicrotubuleInstance(undefined)).toBe(false);
    expect(isMicrotubuleInstance('')).toBe(false);
  });
});

describe('colorFromInstanceId', () => {
  it('is deterministic for the same id', () => {
    expect(colorFromInstanceId('mt_42')).toBe(colorFromInstanceId('mt_42'));
    expect(colorFromInstanceId('track_99')).toBe(
      colorFromInstanceId('track_99')
    );
  });

  it('produces different colors for different ids', () => {
    expect(colorFromInstanceId('mt_aaa')).not.toBe(
      colorFromInstanceId('mt_bbb')
    );
  });

  it('returns a valid hsl(...) string', () => {
    const color = colorFromInstanceId('mt_42');
    expect(color).toMatch(/^hsl\(\d+, \d+%, \d+%\)$/);
  });

  it('selected variant differs from unselected for the same id', () => {
    const id = 'mt_42';
    expect(colorFromInstanceId(id, { selected: true })).not.toBe(
      colorFromInstanceId(id, { selected: false })
    );
  });

  it('preserves hue across selected/unselected (only sat + light shift)', () => {
    const id = 'mt_42';
    const unsel = colorFromInstanceId(id, { selected: false });
    const sel = colorFromInstanceId(id, { selected: true });
    const huePattern = /^hsl\((\d+),/;
    expect(unsel.match(huePattern)?.[1]).toBe(sel.match(huePattern)?.[1]);
  });

  it('returns neutral gray for empty string (silent-failure guard)', () => {
    expect(colorFromInstanceId('')).toBe('hsl(0, 0%, 60%)');
  });
});

describe('hue spread — distinct ids must look distinct', () => {
  const hueOf = (id: string) => {
    const m = colorFromInstanceId(id).match(/hsl\((\d+)/);
    return m ? Number(m[1]) : NaN;
  };
  /** Smallest separation on the hue WHEEL, so 359 and 1 are 2 apart. */
  const minGap = (ids: string[]) => {
    const hs = ids.map(hueOf).sort((a, b) => a - b);
    let min = 360;
    for (let i = 0; i < hs.length; i++) {
      const next = i + 1 < hs.length ? hs[i + 1] : hs[0] + 360;
      min = Math.min(min, next - hs[i]);
    }
    return min;
  };

  it('separates SEQUENTIAL ids, which is how polygons are numbered', () => {
    // The failure this exists for: the `hash * 31 + charCode` string hash on
    // strings differing by one in the last character differs by one — the
    // prefix is identical, so the whole difference is the final unmultiplied
    // `+ c` — so `% 360` put four somas of one frame on
    // 329/330/331/332 — four cells, four indistinguishable magentas. Measured
    // on production 2026-09-08. A "colours differ" assertion passes at 1°,
    // which is why this asserts a SEPARATION a human could act on.
    const somas = ['polygon_21', 'polygon_22', 'polygon_23', 'polygon_24'];
    expect(minGap(somas)).toBeGreaterThan(20);
  });

  it('separates random ids too', () => {
    const tracks = [
      'mt_1cea30b3',
      'mt_af7599ea',
      'mt_6288592c',
      'mt_c30d9d4e',
      'mt_7bff9635',
    ];
    expect(minGap(tracks)).toBeGreaterThan(20);
  });

  it('is still stable per id, which the cross-frame palette depends on', () => {
    // Spreading the hues must not cost determinism: an MT keeps its colour
    // across frames because the trackId is the only input.
    expect(colorFromInstanceId('mt_abc123')).toBe(
      colorFromInstanceId('mt_abc123')
    );
  });
});
