import { describe, it, expect } from 'vitest';
import { contentDisposition } from '../contentDisposition';

/** Node's own rule: setHeader throws ERR_INVALID_CHAR above U+00FF or on a
 *  control character. Asserting it here means these tests fail for the same
 *  reason production did, rather than for a rule we invented. */
const nodeWouldReject = (v: string) => /[^\t\x20-\xFF]/.test(v);

describe('contentDisposition', () => {
  it('survives the em dash that took /display down', () => {
    // The exact production name: the multi-position ND2 split joins with U+2014.
    const name = 'WellD18_ChannelIRM,TIRF 488_Seq0000.nd2 — D18_0001 (frame 1)';
    const value = contentDisposition('inline', name);

    expect(nodeWouldReject(value)).toBe(false);
    // The real name is still recoverable by any current browser.
    expect(value).toContain("filename*=UTF-8''");
    expect(decodeURIComponent(value.split("UTF-8''")[1])).toBe(name);
  });

  it.each([
    ['Czech diacritics', 'Měření buněk 2026.zip'],
    ['CJK', '細胞画像.png'],
    ['emoji', 'result 🎉.png'],
    ['em dash', 'a — b.nd2'],
  ])('accepts %s', (_label, name) => {
    const value = contentDisposition('attachment', name);
    expect(nodeWouldReject(value)).toBe(false);
    expect(decodeURIComponent(value.split("UTF-8''")[1])).toBe(name);
  });

  it('cannot forge a header or escape the quoted string', () => {
    const nasty = 'evil"\r\nX-Injected: 1\\.png';
    const value = contentDisposition('inline', nasty);

    expect(nodeWouldReject(value)).toBe(false);
    expect(value).not.toContain('\r');
    expect(value).not.toContain('\n');
    // The ASCII fallback is a single quoted string: no bare quote, no backslash.
    const fallback = value.match(/filename="([^"]*)"/)?.[1];
    expect(fallback).toBeDefined();
    expect(fallback).not.toContain('"');
    expect(fallback).not.toContain('\\');
  });

  it('leaves a plain ASCII name exactly as it was', () => {
    const value = contentDisposition('inline', 'frame_0001.png');
    expect(value).toBe(
      'inline; filename="frame_0001.png"; filename*=UTF-8\'\'frame_0001.png'
    );
  });

  it('keeps the extension when the stem does not survive the ASCII pass', () => {
    // `細胞画像.png` becomes `____.png`. Ugly, but the extension is what makes a
    // save dialog offer the right application, so it beats a generic name.
    const value = contentDisposition('attachment', '細胞画像.png');
    expect(value).toContain('filename="____.png"');
    expect(decodeURIComponent(value.split("UTF-8''")[1])).toBe('細胞画像.png');
  });

  it('falls back to a generic name when literally nothing survives', () => {
    // No extension either — underscores alone are not a filename.
    const value = contentDisposition('attachment', '細胞画像');
    expect(value).toContain('filename="download"');
    expect(decodeURIComponent(value.split("UTF-8''")[1])).toBe('細胞画像');
  });

  it('percent-encodes the characters RFC 5987 excludes from attr-char', () => {
    const value = contentDisposition('inline', "it's (a) file!.png");
    const ext = value.split("UTF-8''")[1];
    for (const c of ["'", '(', ')', '!']) expect(ext).not.toContain(c);
    expect(decodeURIComponent(ext)).toBe("it's (a) file!.png");
  });

  it('honours the disposition type', () => {
    expect(contentDisposition('inline', 'a.png')).toMatch(/^inline;/);
    expect(contentDisposition('attachment', 'a.zip')).toMatch(/^attachment;/);
  });
});
