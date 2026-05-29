import { describe, it, expect, vi } from 'vitest';
import { getErrorMessage } from '../index';

/**
 * Covers getErrorMessage's STRING-input branches (the `error: string` path):
 * the "resource code N" extraction → per-status mapping (both with and
 * without a translation function) and the camelCase→readable conversion.
 * These complement index.runtime.test.ts, which focuses on Error/ApiError
 * object inputs.
 */
describe('getErrorMessage — string-input branches', () => {
  describe('"resource code N" without a translation function (English fallbacks)', () => {
    const cases: Array<[number, string]> = [
      [400, 'Invalid request. Please check your input.'],
      [401, 'Your session has expired. Please sign in again.'],
      [403, 'You do not have permission to perform this action.'],
      [404, 'The requested resource was not found.'],
      [409, 'A conflict occurred. Please refresh and try again.'],
      [422, 'Validation error. Please check your input.'],
      [429, 'Too many requests. Please wait a moment and try again.'],
      [500, 'Server error. Please try again later.'],
      [502, 'Service temporarily unavailable. Please try again later.'],
      [503, 'Service temporarily unavailable. Please try again later.'],
      [504, 'Service temporarily unavailable. Please try again later.'],
      [450, 'Request error. Please try again.'], // 4xx default
      [599, 'Server error. Please try again later.'], // 5xx default
    ];
    it.each(cases)(
      'maps "resource code %i" → fallback message',
      (code, msg) => {
        expect(getErrorMessage(`failed with resource code ${code}`)).toBe(msg);
      }
    );

    it('returns the generic message for an out-of-range code (e.g. 300)', () => {
      expect(getErrorMessage('resource code 300')).toBe(
        'An error occurred. Please try again.'
      );
    });
  });

  describe('"resource code N" WITH a translation function', () => {
    const t = (key: string) => `t:${key}`;
    it('routes to the right i18n key per status', () => {
      expect(getErrorMessage('resource code 401', t)).toBe(
        't:errors.sessionExpired'
      );
      expect(getErrorMessage('resource code 404', t)).toBe('t:errors.notFound');
      expect(getErrorMessage('resource code 503', t)).toBe(
        't:errors.serverUnavailable'
      );
      expect(getErrorMessage('resource code 450', t)).toBe(
        't:errors.clientError'
      );
      expect(getErrorMessage('resource code 599', t)).toBe('t:errors.server');
    });
  });

  describe('camelCase → readable conversion (string input)', () => {
    it('converts a camelCase token to spaced, capitalised text', () => {
      expect(getErrorMessage('someErrorThing')).toBe('Some error thing');
    });
    it('leaves a plain sentence string untouched', () => {
      expect(getErrorMessage('Just a normal message')).toBe(
        'Just a normal message'
      );
    });
  });

  it('returns the unknown-error message for a non-error, non-string input', () => {
    expect(getErrorMessage(42)).toBe('An unknown error occurred');
    expect(getErrorMessage(undefined, (k: string) => `t:${k}`)).toBe(
      't:errors.unknown'
    );
  });
});
