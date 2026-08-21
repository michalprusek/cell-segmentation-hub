import { describe, it, expect } from 'vitest';
import { deriveRangeMax } from '../playbackProxyRange';

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
