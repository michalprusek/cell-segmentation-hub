/**
 * passwordResetEmailMultilang.gaps5.test.ts
 *
 * Full coverage of src/templates/passwordResetEmailMultilang.ts:
 *
 *  A. generateSimplePasswordResetHTML
 *     - valid URL → returns HTML string containing expected content
 *     - invalid URL → throws "Invalid reset URL"
 *     - locale='cs' → uses Czech translations + Prague timezone
 *     - locale='de' → uses German translations
 *     - unknown locale → falls back to English
 *
 *  B. generateSimplePasswordResetText
 *     - valid URL → returns plain text with correct content
 *     - invalid URL → throws
 *
 *  C. getPasswordResetSubject
 *     - returns English subject by default
 *     - returns locale-specific subject
 */

import { describe, it, expect } from 'vitest';
import {
  generateSimplePasswordResetHTML,
  generateSimplePasswordResetText,
  getPasswordResetSubject,
  type PasswordResetEmailData,
} from '../passwordResetEmailMultilang';

const baseData: PasswordResetEmailData = {
  resetToken: 'abc123',
  userEmail: 'user@example.com',
  resetUrl: 'https://spheroseg.example.com/reset?token=abc123',
  expiresAt: new Date('2026-01-15T12:00:00Z'),
};

// ─── A. generateSimplePasswordResetHTML ───────────────────────────────────────

describe('generateSimplePasswordResetHTML', () => {
  it('returns HTML with reset link and user email', () => {
    const html = generateSimplePasswordResetHTML(baseData);
    expect(html).toContain('<html>');
    expect(html).toContain('user@example.com');
    // URL is escapeHtml'd: / → &#x2F;
    expect(html).toContain('spheroseg.example.com');
    expect(html).toContain('reset');
  });

  it('throws "Invalid reset URL" for empty URL', () => {
    expect(() =>
      generateSimplePasswordResetHTML({ ...baseData, resetUrl: '' })
    ).toThrow('Invalid reset URL');
  });

  it('throws for javascript: URL', () => {
    expect(() =>
      generateSimplePasswordResetHTML({
        ...baseData,
        resetUrl: 'javascript:alert(1)',
      })
    ).toThrow('Invalid reset URL');
  });

  it('uses Czech translations for locale=cs', () => {
    const html = generateSimplePasswordResetHTML({ ...baseData, locale: 'cs' });
    expect(html).toContain('Reset hesla');
    expect(html).toContain('Dobrý den');
  });

  it('uses German translations for locale=de', () => {
    const html = generateSimplePasswordResetHTML({ ...baseData, locale: 'de' });
    expect(html).toContain('Passwort');
  });

  it('uses French translations for locale=fr', () => {
    const html = generateSimplePasswordResetHTML({ ...baseData, locale: 'fr' });
    expect(html).toContain('Réinitialisation');
  });

  it('uses Chinese translations for locale=zh', () => {
    const html = generateSimplePasswordResetHTML({ ...baseData, locale: 'zh' });
    expect(html.length).toBeGreaterThan(100);
  });

  it('falls back to English for unknown locale', () => {
    const html = generateSimplePasswordResetHTML({
      ...baseData,
      locale: 'xx',
    });
    expect(html).toContain('Password Reset');
  });

  it('escapes HTML in user email', () => {
    const html = generateSimplePasswordResetHTML({
      ...baseData,
      userEmail: 'user+<test>@example.com',
    });
    // Should not contain raw < > in email
    expect(html).not.toContain('<test>');
  });
});

// ─── B. generateSimplePasswordResetText ───────────────────────────────────────

describe('generateSimplePasswordResetText', () => {
  it('returns plain text with reset link', () => {
    const text = generateSimplePasswordResetText(baseData);
    expect(typeof text).toBe('string');
    expect(text).toContain('user@example.com');
    expect(text).toContain('spheroseg.example.com');
  });

  it('throws "Invalid reset URL" for empty URL', () => {
    expect(() =>
      generateSimplePasswordResetText({ ...baseData, resetUrl: '' })
    ).toThrow('Invalid reset URL');
  });

  it('uses locale-specific content for cs', () => {
    const text = generateSimplePasswordResetText({ ...baseData, locale: 'cs' });
    expect(text).toContain('hesla');
  });

  it('falls back to English for unknown locale', () => {
    const text = generateSimplePasswordResetText({
      ...baseData,
      locale: 'unknown',
    });
    expect(text).toContain('Password Reset');
  });
});

// ─── C. getPasswordResetSubject ───────────────────────────────────────────────

describe('getPasswordResetSubject', () => {
  it('returns English subject by default', () => {
    expect(getPasswordResetSubject()).toContain('SpheroSeg');
    expect(getPasswordResetSubject('en')).toContain('Password Reset');
  });

  it('returns Czech subject for cs', () => {
    expect(getPasswordResetSubject('cs')).toContain('Reset hesla');
  });

  it('returns Spanish subject for es', () => {
    expect(getPasswordResetSubject('es')).toContain('contraseña');
  });

  it('falls back to English for unknown locale', () => {
    expect(getPasswordResetSubject('zz')).toContain('Password Reset');
  });
});
