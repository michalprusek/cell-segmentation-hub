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
