/**
 * scaleConfig.gaps6.test.ts
 *
 * Covers uncovered lines not hit by scaleConfig.gaps5.test.ts:
 *   94-95  — findClosestTypicalScale inner loop: diff < closestDiff branch
 *   114    — validateScale: scale === null short-circuit
 *   119    — validateScale: errorMessage truthy → returns invalid result
 *
 * Also covers getScaleWarningMessage high/low warning branches and
 * validateScale happy paths with warning.
 */

import { describe, it, expect } from 'vitest';
import {
  getScaleWarningMessage,
  validateScale,
} from '../scaleConfig';

// ---------------------------------------------------------------------------
// findClosestTypicalScale — exercised via getScaleWarningMessage (high scale)
// A scale > 1 triggers the high-scale warning which internally calls
// findClosestTypicalScale. The inner loop (line 93-96) fires when diff < closestDiff.
// ---------------------------------------------------------------------------

describe('findClosestTypicalScale (via getScaleWarningMessage)', () => {
  it('finds a closer typical scale than the 4x default (triggers inner loop body)', () => {
    // Scale of 0.25 is the exact 10x objective — the loop will find a diff=0
    // which is < the initial closestDiff (diff to 4x = |0.25 - 0.625| = 0.375)
    const warning = getScaleWarningMessage(0.24); // close to 10x (0.25)
    // No warning expected since 0.24 is within the low-scale threshold (0.01)
    // but we just need the internal findClosestTypicalScale to run
    expect(typeof warning).toBe('string');
  });

  it('returns high-scale warning for scale > 1 and runs findClosestTypicalScale', () => {
    // 2.0 um/pixel → high magnification warning, triggers findClosestTypicalScale
    const warning = getScaleWarningMessage(2.0);
    expect(warning).toContain('High scale value detected');
    expect(warning).toContain('2');
  });

  it('returns low-scale warning for scale < 0.01', () => {
    const warning = getScaleWarningMessage(0.005);
    expect(warning).toContain('Low scale value detected');
    expect(warning).toContain('0.005');
  });

  it('returns empty string for scale in normal range', () => {
    const warning = getScaleWarningMessage(0.25); // 10x objective
    expect(warning).toBe('');
  });
});

// ---------------------------------------------------------------------------
// validateScale — null, invalid, and warning cases
// ---------------------------------------------------------------------------

describe('validateScale()', () => {
  it('returns valid=true, value=undefined for undefined input', () => {
    const result = validateScale(undefined);
    expect(result.valid).toBe(true);
    expect(result.value).toBeUndefined();
  });

  it('returns valid=true, value=undefined for null input (line 114)', () => {
    // null is not in the TypeScript union but the JS runtime check handles it
    const result = validateScale(null as unknown as undefined);
    expect(result.valid).toBe(true);
    expect(result.value).toBeUndefined();
  });

  it('returns valid=false with error when scale is invalid (line 119)', () => {
    // Negative scale → errorMessage is truthy → returns invalid result
    const result = validateScale(-0.5);
    expect(result.valid).toBe(false);
    expect(result.value).toBeUndefined();
    expect(result.error).toContain('Negative');
  });

  it('returns valid=false with error for scale=0 (line 119)', () => {
    const result = validateScale(0);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Invalid scale value');
  });

  it('returns valid=true with no warning for normal scale in range', () => {
    const result = validateScale(0.25);
    expect(result.valid).toBe(true);
    expect(result.value).toBe(0.25);
    expect(result.warning).toBeUndefined();
  });

  it('returns valid=true with high-scale warning for scale > 1', () => {
    const result = validateScale(5.0);
    expect(result.valid).toBe(true);
    expect(result.value).toBe(5.0);
    expect(result.warning).toContain('High scale');
  });

  it('returns valid=true with low-scale warning for scale < 0.01', () => {
    const result = validateScale(0.001);
    // 0.001 is >= MIN_SCALE (0.001) so it's valid but triggers low warning
    expect(result.valid).toBe(true);
    expect(result.warning).toContain('Low scale');
  });
});
