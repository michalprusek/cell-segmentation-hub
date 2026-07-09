import { describe, it, expect } from 'vitest';
import { resolveMtColor, darkenHex, NEUTRAL_COLOR } from '../instanceColors';

describe('resolveMtColor', () => {
  const palette = new Map([['mt_type_a', '#ff0000']]);

  it('returns the label colour for a typed MT', () => {
    expect(resolveMtColor('mt_type_a', palette)).toBe('#ff0000');
  });

  it('returns neutral gray for an untyped MT', () => {
    expect(resolveMtColor(undefined, palette)).toBe(NEUTRAL_COLOR);
    expect(resolveMtColor(null, palette)).toBe(NEUTRAL_COLOR);
  });

  it('returns neutral gray for an unknown id', () => {
    expect(resolveMtColor('mt_type_missing', palette)).toBe(NEUTRAL_COLOR);
  });

  it('darkens the label colour when selected', () => {
    const selected = resolveMtColor('mt_type_a', palette, { selected: true });
    expect(selected).not.toBe('#ff0000');
    expect(selected).toBe(darkenHex('#ff0000'));
  });
});

describe('darkenHex', () => {
  it('darkens a hex colour', () => {
    expect(darkenHex('#ffffff', 0.5)).toBe('#808080');
  });
  it('passes through a non-hex string unchanged', () => {
    expect(darkenHex('hsl(0,0%,60%)')).toBe('hsl(0,0%,60%)');
  });
});
