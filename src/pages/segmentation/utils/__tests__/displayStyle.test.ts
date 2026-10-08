import { describe, it, expect } from 'vitest';
import { displayFilter, imageRenderingFor } from '../displayStyle';

describe('imageRenderingFor', () => {
  it('is the browser default when smooth, nearest neighbour when not', () => {
    expect(imageRenderingFor(true)).toBe('auto');
    expect(imageRenderingFor(false)).toBe('pixelated');
  });

  it('never returns crisp-edges, which Chrome < 148 rejects', () => {
    expect([imageRenderingFor(true), imageRenderingFor(false)]).not.toContain(
      'crisp-edges'
    );
  });
});

describe('displayFilter', () => {
  it('emits no filter at the identity', () => {
    expect(displayFilter(100, 100)).toBeUndefined();
  });

  it('emits both functions as soon as either differs from 100', () => {
    expect(displayFilter(150, 100)).toBe('brightness(1.5) contrast(1)');
    expect(displayFilter(100, 80)).toBe('brightness(1) contrast(0.8)');
    expect(displayFilter(0, 200)).toBe('brightness(0) contrast(2)');
  });
});
