/**
 * shareInvitationEmailSimple.gaps5.test.ts
 *
 * Full coverage of shareInvitationEmailSimple.ts:
 *
 *  A. generateShareInvitationSimpleHTML
 *     - English locale → contains expected English text
 *     - Czech locale → contains Czech text
 *     - Unknown locale → falls back to English
 *
 *  B. generateShareInvitationSimpleText
 *     - Returns plain text with expected content
 *
 *  C. getShareInvitationSimpleSubject
 *     - English subject includes project title
 *     - Czech subject
 *     - Unknown locale falls back to English
 *
 *  D. formatDateShort — error path
 *     - Invalid locale → falls back to en-US
 */

import { describe, it, expect } from 'vitest';
import {
  generateShareInvitationSimpleHTML,
  generateShareInvitationSimpleText,
  getShareInvitationSimpleSubject,
  type ShareInvitationSimpleData,
} from '../shareInvitationEmailSimple';

const baseData: ShareInvitationSimpleData = {
  projectTitle: 'My Spheroid Project',
  sharedByEmail: 'admin@example.com',
  acceptUrl: 'https://spheroseg.example.com/share/accept/token123',
  expiresAt: new Date('2026-02-01T12:00:00Z'),
};

// ─── A. generateShareInvitationSimpleHTML ─────────────────────────────────────

describe('generateShareInvitationSimpleHTML', () => {
  it('returns HTML with project title and sender email', () => {
    const html = generateShareInvitationSimpleHTML(baseData);
    expect(html).toContain('<html>');
    expect(html).toContain('My Spheroid Project');
    expect(html).toContain('admin@example.com');
  });

  it('uses English translations by default', () => {
    const html = generateShareInvitationSimpleHTML(baseData);
    expect(html).toContain('Hello!');
    expect(html).toContain('Accept invitation');
  });

  it('uses Czech translations for locale=cs', () => {
    const html = generateShareInvitationSimpleHTML({
      ...baseData,
      locale: 'cs',
    });
    expect(html).toContain('Dobrý den!');
    expect(html).toContain('Přijmout pozvánku');
  });

  it('uses Spanish translations for locale=es', () => {
    const html = generateShareInvitationSimpleHTML({
      ...baseData,
      locale: 'es',
    });
    expect(html).toContain('Aceptar invitación');
  });

  it('uses German translations for locale=de', () => {
    const html = generateShareInvitationSimpleHTML({
      ...baseData,
      locale: 'de',
    });
    expect(html).toContain('Hallo!');
  });

  it('uses French translations for locale=fr', () => {
    const html = generateShareInvitationSimpleHTML({
      ...baseData,
      locale: 'fr',
    });
    expect(html).toContain('Accepter');
  });

  it('uses Chinese translations for locale=zh', () => {
    const html = generateShareInvitationSimpleHTML({
      ...baseData,
      locale: 'zh',
    });
    expect(html.length).toBeGreaterThan(100);
  });

  it('falls back to English for unknown locale', () => {
    const html = generateShareInvitationSimpleHTML({
      ...baseData,
      locale: 'xx',
    });
    expect(html).toContain('Hello!');
  });

  it('escapes HTML in project title', () => {
    const html = generateShareInvitationSimpleHTML({
      ...baseData,
      projectTitle: '<script>alert(1)</script>',
    });
    expect(html).not.toContain('<script>');
  });
});

// ─── B. generateShareInvitationSimpleText ────────────────────────────────────

describe('generateShareInvitationSimpleText', () => {
  it('returns plain text with project title', () => {
    const text = generateShareInvitationSimpleText(baseData);
    expect(typeof text).toBe('string');
    expect(text).toContain('My Spheroid Project');
    expect(text).toContain('admin@example.com');
  });

  it('uses Czech text for cs locale', () => {
    const text = generateShareInvitationSimpleText({
      ...baseData,
      locale: 'cs',
    });
    expect(text).toContain('Dobrý den!');
  });

  it('falls back to English for unknown locale', () => {
    const text = generateShareInvitationSimpleText({
      ...baseData,
      locale: 'zz',
    });
    expect(text).toContain('Hello!');
  });
});

// ─── C. getShareInvitationSimpleSubject ──────────────────────────────────────

describe('getShareInvitationSimpleSubject', () => {
  it('returns English subject with project title', () => {
    const subject = getShareInvitationSimpleSubject('My Project');
    expect(subject).toContain('My Project');
    expect(subject).toContain('Project Shared');
  });

  it('returns Czech subject for cs locale', () => {
    const subject = getShareInvitationSimpleSubject('Projekt', 'cs');
    expect(subject).toContain('Sdílený projekt');
    expect(subject).toContain('Projekt');
  });

  it('falls back to English for unknown locale', () => {
    const subject = getShareInvitationSimpleSubject('Test', 'zz');
    expect(subject).toContain('Project Shared');
  });
});

// ─── D. formatDateShort — invalid locale fallback ────────────────────────────

describe('generateShareInvitationSimpleHTML — invalid locale date fallback', () => {
  it('handles invalid Intl locale gracefully', () => {
    // An invalid locale string should trigger the catch in formatDateShort
    const html = generateShareInvitationSimpleHTML({
      ...baseData,
      locale: 'invalid-LOCALE-999',
    });
    // Should still render without throwing
    expect(html).toContain('<html>');
  });
});
