/**
 * verificationEmail.gaps5.test.ts
 *
 * Full coverage of src/templates/verificationEmail.ts:
 *
 *  A. generateVerificationEmailHTML
 *     - English locale → subject + HTML with English text
 *     - Czech locale → Czech translations
 *     - Unknown locale → falls back to English
 *     - Invalid URL (javascript:) → safeUrl becomes '#'
 *     - userEmail provided → included in HTML
 *     - no userEmail → no user-info div
 */

import { describe, it, expect } from 'vitest';
import { generateVerificationEmailHTML } from '../verificationEmail';

const validUrl = 'https://spheroseg.example.com/verify?token=abc123';

describe('generateVerificationEmailHTML', () => {
  it('returns HTML and subject with English locale (default)', () => {
    const result = generateVerificationEmailHTML({ verificationUrl: validUrl });
    expect(result.subject).toContain('Verify Your Email');
    expect(result.html).toContain('Email Verification');
    expect(result.html).toContain('Verify Email');
  });

  it('uses Czech translations for locale=cs', () => {
    const result = generateVerificationEmailHTML({
      verificationUrl: validUrl,
      locale: 'cs',
    });
    expect(result.subject).toContain('Ověřte svůj e-mail');
    expect(result.html).toContain('Ověření e-mailu');
  });

  it('uses Spanish translations for locale=es', () => {
    const result = generateVerificationEmailHTML({
      verificationUrl: validUrl,
      locale: 'es',
    });
    expect(result.subject).toContain('Verifica tu correo');
  });

  it('uses German translations for locale=de', () => {
    const result = generateVerificationEmailHTML({
      verificationUrl: validUrl,
      locale: 'de',
    });
    expect(result.subject).toContain('E-Mail bestätigen');
  });

  it('uses French translations for locale=fr', () => {
    const result = generateVerificationEmailHTML({
      verificationUrl: validUrl,
      locale: 'fr',
    });
    expect(result.subject).toContain('Vérifiez votre email');
  });

  it('uses Chinese translations for locale=zh', () => {
    const result = generateVerificationEmailHTML({
      verificationUrl: validUrl,
      locale: 'zh',
    });
    expect(result.html).toContain('电子邮件验证');
  });

  it('falls back to English for unknown locale', () => {
    const result = generateVerificationEmailHTML({
      verificationUrl: validUrl,
      locale: 'xx',
    });
    expect(result.subject).toContain('Verify Your Email');
    // safeLocale defaults to 'en' for unknown locale
    expect(result.html).toContain('lang="en"');
  });

  it('falls back to # when URL is invalid (javascript: protocol)', () => {
    const result = generateVerificationEmailHTML({
      verificationUrl: 'javascript:alert(1)',
    });
    // safeUrl = escapeHtml('#') = '#'
    expect(result.html).not.toContain('javascript:');
    expect(result.html).toContain('href="#"');
  });

  it('falls back to # when URL is malformed', () => {
    const result = generateVerificationEmailHTML({
      verificationUrl: 'not-a-valid-url',
    });
    expect(result.html).toContain('href="#"');
  });

  it('includes user email in HTML when provided', () => {
    const result = generateVerificationEmailHTML({
      verificationUrl: validUrl,
      userEmail: 'user@example.com',
    });
    expect(result.html).toContain('user@example.com');
    expect(result.html).toContain('user-info');
  });

  it('does not include account email in body when no email provided', () => {
    const result = generateVerificationEmailHTML({
      verificationUrl: validUrl,
    });
    // The user-info CSS class is in the style block, but the div should not be
    // in the body (it uses a conditional template expression)
    expect(result.html).not.toContain('Account:');
  });
});
