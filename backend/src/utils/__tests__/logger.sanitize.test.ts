/**
 * logger.sanitize.test.ts
 *
 * Pins the CWE-117 record-forging defence in `Logger.sanitize`, and in
 * particular the two properties that make it BOTH safe and visible to CodeQL.
 *
 * `sanitize` is private, so everything here goes through the public `logger.*`
 * methods and reads what actually reached `console.*` — the real sink. That is
 * deliberate: a test against the helper would keep passing if the wiring
 * between `formatMessage` and the console branches ever came apart.
 *
 * Why this file exists at all: the substitution is written as three chained
 * `.replace()` calls rather than the one obvious call, because CodeQL's
 * `StringReplaceSanitizer` (LogInjectionQuery.qll) only recognises a newline
 * replaced by the EMPTY string. The one-step `.replace(/[\r\n]/g, ' ')` form is
 * equally safe but invisible to the query, and left `js/log-injection` open on
 * every `console.*` branch.
 *
 * Be honest about what these tests can and cannot catch. Mutation-tested
 * 2026-08-27, running only this file:
 *
 *   - drop the trailing `.replace(/\n/g, '')`      -> 7 fail
 *   - separator becomes '' instead of ' '          -> 6 fail
 *   - drop the C0-control strip                    -> 1 fail
 *   - revert to the ONE-STEP `/[\r\n]/g -> ' '`     -> 0 fail
 *
 * That last row is the point. The three-step form was chosen for the
 * ANALYSER, and for the SEPARATOR it is byte-for-byte identical to the
 * one-step form — compared over 62 695 inputs, holding the control class
 * equal on both sides, 0 differences. So no behavioural test can tell them
 * apart: these tests pin the SEMANTICS, and CodeQL pins the SHAPE by
 * reopening the alert. If you simplify `sanitize` and CI stays green, check
 * the Security tab before concluding nothing broke.
 *
 * The C1 strip is the one deliberate behaviour CHANGE in that same commit,
 * and is NOT covered by the equivalence above — it is pinned separately by
 * the CSI/NEL test, which goes red if the range is narrowed back to DEL.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { logger } from '../logger';

const LF = '\n';
const CR = '\r';
const NUL = '\u0000';
const BEL = '\u0007';
const ESC = '\u001b';
const DEL = '\u007f';
const CSI = '\u009b'; // C1: single-character form of ESC[
const NEL = '\u0085'; // C1: next line
const TAB = '\t';

/** Capture whatever the logger handed to `console.info`. */
function capture(fn: () => void): string {
  const spy = vi.spyOn(console, 'info').mockImplementation(() => {});
  try {
    fn();
    expect(spy).toHaveBeenCalledTimes(1);
    return String(spy.mock.calls[0][0]);
  } finally {
    spy.mockRestore();
  }
}

/** The message body, i.e. everything after the `<timestamp> <LEVEL> ` prefix.
 *
 *  Matched by exact width, not by `\s+`: `formatMessage` builds the prefix as
 *  `${timestamp} ${LogLevel[..].padEnd(5)} `, so a greedy `\s+` would swallow a
 *  leading space that sanitizing itself produced -- which is precisely the
 *  character the SEPARATOR tests below exist to observe. */
function body(line: string): string {
  return line.replace(/^\S+ .{5} /, '');
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Logger.sanitize — record forging (CWE-117)', () => {
  it('folds a forged record onto a single line', () => {
    const forged = `evil${LF}2026-01-01 ERROR [Auth] admin logged in`;
    const line = capture(() => logger.info(forged));

    // The whole point: one call must never produce two log records.
    expect(line).not.toContain(LF);
    expect(line).not.toContain(CR);
    expect(line.split(LF)).toHaveLength(1);
    // The payload text survives — sanitizing is not censoring.
    expect(line).toContain('2026-01-01 ERROR [Auth] admin logged in');
  });

  it('strips C0 controls and DEL that could repaint the line', () => {
    const line = capture(() =>
      logger.info(`a${NUL}b${BEL}c${DEL}${ESC}[2Kdef`)
    );
    expect(body(line)).toBe('abc[2Kdef');
  });

  it('strips the C1 block, which C0-only sanitizing let through', () => {
    // U+009B is CSI: on a terminal that decodes C1, a bare U+009B + '2K'
    // erases the line exactly as ESC[2K does, so C0-only stripping left the
    // repainting attack open in its other spelling.
    expect(body(capture(() => logger.info(`a${CSI}2Kb`)))).toBe('a2Kb');
    // U+0085 is NEL, which some log consumers treat as a line break.
    expect(body(capture(() => logger.info(`a${NEL}b`)))).toBe('ab');
  });

  it('leaves legitimate non-ASCII alone', () => {
    // The C1 strip must not reach printable text: every codepoint it removes
    // is Unicode category Cc, and these all sit above the block.
    for (const text of ['éclair', '漢字', 'naïve', 'µm']) {
      expect(body(capture(() => logger.info(text)))).toBe(text);
    }
  });

  it('keeps TAB, which cannot forge a record', () => {
    const line = capture(() => logger.info(`col1${TAB}col2`));
    expect(body(line)).toBe(`col1${TAB}col2`);
  });

  it('sanitizes the context field too', () => {
    const line = capture(() => logger.info('msg', `ctx${LF}injected`));
    expect(line).not.toContain(LF);
    expect(line).toContain('ctx injected');
  });
});

describe('Logger.sanitize — SEPARATOR becomes a space, not nothing', () => {
  // Guards the semantics. A `\n` -> '' collapse would fuse two unrelated
  // fields into one word ("ab"), which is a different, quieter bug than the
  // one being defended against — and is exactly what a naive rewrite to
  // satisfy CodeQL in ONE step would produce.
  it('LF yields a space so neighbouring text cannot fuse', () => {
    expect(body(capture(() => logger.info(`a${LF}b`)))).toBe('a b');
  });

  it('CRLF yields two spaces, matching the one-step form it replaced', () => {
    // Each of CR and LF contributes its own space. This is the value the
    // original single `.replace(/[\r\n]/g, ' ')` produced; the three-step
    // form must stay byte-identical to it.
    expect(body(capture(() => logger.info(`a${CR}${LF}b`)))).toBe('a  b');
  });

  it('a run of separators yields one space each', () => {
    expect(body(capture(() => logger.info(`a${LF}${LF}${LF}b`)))).toBe('a   b');
  });

  it('leading and trailing separators become spaces', () => {
    expect(body(capture(() => logger.info(`${LF}head`)))).toBe(' head');
    expect(body(capture(() => logger.info(`tail${LF}`)))).toBe('tail ');
  });
});

describe('Logger.sanitize — error message and stack', () => {
  it('sanitizes error.message, which once reached the sink raw', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const err = new Error(`boom${LF}2026-01-01 ERROR [Auth] forged`);
    err.stack = `Error: boom${LF}    at real ()${LF}    at frames ()`;
    logger.error('failed', err);
    const line = String(spy.mock.calls[0][0]);
    spy.mockRestore();

    // The forged record inside error.message is folded, not passed through.
    expect(line).toContain('boom 2026-01-01 ERROR [Auth] forged');

    // Only OUR deliberate separators survive as newlines; every continuation
    // line is either one of them or visibly indented, so none can pass for a
    // fresh record.
    const [, ...rest] = line.split(LF);
    for (const l of rest) {
      expect(
        l.startsWith('Error:') || l.startsWith('Stack:') || l.startsWith('    ')
      ).toBe(true);
    }
  });
});
