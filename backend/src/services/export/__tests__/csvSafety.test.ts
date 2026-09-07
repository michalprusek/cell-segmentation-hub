/**
 * The formula guard every CSV export shares.
 *
 * This exists because a metrics sheet carries an image or frame NAME, and that
 * name is the filename the uploader chose. Projects can be SHARED, so the
 * person who named the file and the person who opens the sheet in Excel are
 * not necessarily the same person.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { neutraliseCsvFormula } from '../csvSafety';

describe('neutraliseCsvFormula', () => {
  it.each(['=', '+', '-', '@'])('neutralises a value starting with %s', lead => {
    const out = neutraliseCsvFormula(`${lead}HYPERLINK("http://x")`);
    // FIRST character, or the cell still evaluates.
    expect(out.startsWith("'")).toBe(true);
    // and the original value survives behind it — the row must stay traceable
    // to its frame.
    expect(out.slice(1)).toBe(`${lead}HYPERLINK("http://x")`);
  });

  it('neutralises a leading tab and CR, which spreadsheets strip first', () => {
    for (const lead of ['\t', '\r']) {
      expect(neutraliseCsvFormula(`${lead}=1+1`).startsWith("'")).toBe(true);
    }
  });

  it('leaves an ordinary value untouched', () => {
    // The control. Prefixing everything would put a quote in front of every
    // cell in every sheet.
    for (const v of ['r5_ctrl_0001.png', '42', '0.18', 'a=b', ' =1+1']) {
      expect(neutraliseCsvFormula(v)).toBe(v);
    }
  });

  it('does not double-prefix an already-quoted value', () => {
    // An apostrophe is not a formula lead, so a second pass is a no-op.
    const once = neutraliseCsvFormula('=1+1');
    expect(neutraliseCsvFormula(once)).toBe(once);
  });

  it('leaves the empty string alone', () => {
    expect(neutraliseCsvFormula('')).toBe('');
  });
});

describe('every CSV exporter is wired to the guard', () => {
  // The failure this catches: a THIRD exporter starts writing a CSV and quotes
  // its cells without neutralising them, reintroducing the hole in a new file
  // where no unit test of this helper would ever look. Two exporters already
  // drifted apart on exactly this — the neurite one grew the guard first and
  // the MT one had the same gap for a year.
  const EXPORT_DIR = path.join(__dirname, '..');

  const csvBuilders = () =>
    fs
      .readdirSync(EXPORT_DIR)
      .filter(f => f.endsWith('.ts') && f !== 'csvSafety.ts')
      .map(f => ({ name: f, src: fs.readFileSync(path.join(EXPORT_DIR, f), 'utf-8') }))
      // A file "builds CSV cells" if it joins values with commas into a line.
      .filter(f => /\.join\(','\)/.test(f.src));

  it('finds the CSV builders at all — the scan must not be vacuous', () => {
    const names = csvBuilders().map(f => f.name);
    expect(names).toContain('mtMetricsExporter.ts');
    expect(names).toContain('neuriteMetricsExporter.ts');
  });

  it.each(csvBuilders().map(f => f.name))('%s calls the shared guard', name => {
    const src = fs.readFileSync(path.join(EXPORT_DIR, name), 'utf-8');
    expect(src).toContain("from './csvSafety'");
    expect(src).toContain('neutraliseCsvFormula(');
  });
});
