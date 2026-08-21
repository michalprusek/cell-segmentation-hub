import { describe, it, expect } from 'vitest';
import {
  deriveRangeMax,
  windowNeedsFullDepth,
  PROXY_LEVELS,
  MIN_LEVELS_IN_WINDOW,
} from '../playbackProxyRange';

describe('deriveRangeMax', () => {
  it('rounds a real container up to the next power of two', () => {
    // The measured container: 16-bit samples occupying 126..1566, so 11 bits.
    expect(deriveRangeMax([1566])).toBe(2047);
  });

  it('takes the largest of the sampled frames', () => {
    expect(deriveRangeMax([126, 1566, 900])).toBe(2047);
  });

  it('does not round a value that is already a power-of-two boundary', () => {
    expect(deriveRangeMax([2047])).toBe(2047);
    expect(deriveRangeMax([2048])).toBe(4095);
  });

  it('never goes below 8 bits, so the mapping can never widen the data', () => {
    expect(deriveRangeMax([0])).toBe(255);
    expect(deriveRangeMax([12])).toBe(255);
  });

  it('caps at the 16-bit container it came from', () => {
    expect(deriveRangeMax([65535])).toBe(65535);
  });

  it('refuses to guess from nothing', () => {
    expect(() => deriveRangeMax([])).toThrow(/no maxima/i);
  });

  it('refuses a non-finite maximum rather than producing NaN', () => {
    expect(() => deriveRangeMax([Number.NaN])).toThrow(/finite/i);
  });
});

describe('windowNeedsFullDepth', () => {
  const RANGE = 2047;

  it('is happy with a window spanning the whole range', () => {
    expect(windowNeedsFullDepth(0, RANGE, RANGE)).toBe(false);
  });

  it('demands full depth once the window holds too few proxy levels', () => {
    // A window this narrow contains fewer than MIN_LEVELS_IN_WINDOW of the
    // proxy's 256 levels, which is where banding starts to show.
    const tooNarrow = Math.floor((RANGE * (MIN_LEVELS_IN_WINDOW - 1)) / PROXY_LEVELS);
    expect(windowNeedsFullDepth(100, 100 + tooNarrow, RANGE)).toBe(true);
  });

  it('is satisfied exactly at the threshold', () => {
    const atThreshold = Math.ceil((RANGE * MIN_LEVELS_IN_WINDOW) / PROXY_LEVELS);
    expect(windowNeedsFullDepth(100, 100 + atThreshold, RANGE)).toBe(false);
  });

  it('treats an inverted window the same as the display code does', () => {
    expect(windowNeedsFullDepth(RANGE, 0, RANGE)).toBe(false);
  });

  it('treats a zero-width window as needing full depth', () => {
    expect(windowNeedsFullDepth(500, 500, RANGE)).toBe(true);
  });

  it('does not divide by a missing range', () => {
    expect(windowNeedsFullDepth(0, 2047, 0)).toBe(true);
  });
});
