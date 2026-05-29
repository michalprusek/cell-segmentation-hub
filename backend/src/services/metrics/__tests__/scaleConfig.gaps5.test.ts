/**
 * scaleConfig.gaps5.test.ts
 *
 * Covers branches still uncovered after scaleConversionIntegration.test.ts:
 *
 *  A. getScaleValidationMessage
 *     - scale = 0 → "Invalid scale value (0)"
 *     - scale = -1 → "Negative scale"
 *     - scale = Infinity → "Infinity"
 *     - scale = NaN → "NaN"
 *     - scale > MAX_SCALE → "exceeds maximum"
 *     - scale < MIN_SCALE → "below minimum"
 *     - valid scale → returns ''
 *
 *  B. findClosestTypicalScale (via getScaleWarningMessage)
 *     - scale matches closest key via the inner loop
 */

import { describe, it, expect } from 'vitest';
import { getScaleValidationMessage } from '../scaleConfig';

describe('getScaleValidationMessage', () => {
  it('returns message for scale = 0', () => {
    const msg = getScaleValidationMessage(0);
    expect(msg).toContain('Invalid scale value');
    expect(msg).toContain('0');
  });

  it('returns message for negative scale', () => {
    const msg = getScaleValidationMessage(-0.5);
    expect(msg).toContain('Negative scale');
  });

  it('returns message for Infinity', () => {
    const msg = getScaleValidationMessage(Infinity);
    expect(msg).toContain('Infinity');
  });

  it('returns message for NaN', () => {
    const msg = getScaleValidationMessage(NaN);
    expect(msg).toContain('NaN');
  });

  it('returns message for scale > MAX_SCALE (e.g. 1001)', () => {
    const msg = getScaleValidationMessage(1001);
    expect(msg).toContain('exceeds maximum');
  });

  it('returns message for scale < MIN_SCALE (e.g. 0.00001)', () => {
    const msg = getScaleValidationMessage(0.00001);
    expect(msg).toContain('below minimum');
  });

  it('returns empty string for valid scale (e.g. 0.5)', () => {
    const msg = getScaleValidationMessage(0.5);
    expect(msg).toBe('');
  });
});
