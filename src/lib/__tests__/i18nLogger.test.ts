/**
 * Behavioral tests for i18nLogger.ts
 *
 * I18nLogger is a singleton that deduplicates missing-key warnings, gates
 * behaviour on NODE_ENV, and exposes structured reporting helpers.
 *
 * KEY DESIGN NOTE:
 * The singleton is constructed once at module-load time and reads
 * `process.env.NODE_ENV` in its constructor.  The test suite forces
 * `process.env.NODE_ENV = 'test'` in the global setup — so the exported
 * `i18nLogger` singleton is constructed with `isEnabled = false`.
 *
 * We therefore test two configurations:
 *   1. The exported singleton (NODE_ENV='test' → disabled) — tests that no
 *      logging occurs and all report methods still work safely.
 *   2. A fresh `I18nLogger` instance with `NODE_ENV` temporarily set to
 *      'development' — tests all the active logging / dedup / throttle /
 *      reporting logic.
 *
 * To construct a fresh instance we re-import the module under a mocked
 * NODE_ENV using vitest's vi.resetModules() + dynamic import.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { i18nLogger } from '../i18nLogger';

// ---------------------------------------------------------------------------
// Helpers to get a fresh logger constructed in dev mode
// ---------------------------------------------------------------------------

/**
 * Dynamically re-import the module after overriding NODE_ENV so that the
 * I18nLogger constructor sees 'development'.  The returned instance is fresh
 * (empty missingKeys map).
 */
async function getDevLogger() {
  vi.resetModules();
  const originalEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'development';
  // Import fresh copy — ESM module cache is busted by resetModules
  const mod = await import('../i18nLogger');
  process.env.NODE_ENV = originalEnv;
  return mod.i18nLogger;
}

// ---------------------------------------------------------------------------
// Section 1: exported singleton (NODE_ENV = 'test' → disabled)
// ---------------------------------------------------------------------------

describe('i18nLogger (test env — disabled)', () => {
  beforeEach(() => {
    i18nLogger.clear();
    vi.clearAllMocks();
  });

  it('logMissingKey does not call logger.warn in test env', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    i18nLogger.logMissingKey('some.key', 'TestComponent');
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('getMissingKeysReport returns empty array when no keys logged (disabled)', () => {
    i18nLogger.logMissingKey('missing.key');
    const report = i18nLogger.getMissingKeysReport();
    expect(report).toEqual([]);
  });

  it('exportMissingKeys returns empty object when disabled', () => {
    i18nLogger.logMissingKey('missing.key');
    expect(i18nLogger.exportMissingKeys()).toEqual({});
  });

  it('printReport does nothing in test env', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    i18nLogger.logMissingKey('x.y');
    i18nLogger.printReport();
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('clear() is safe to call even when no keys tracked', () => {
    expect(() => i18nLogger.clear()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Section 2: fresh dev-mode logger instance
// ---------------------------------------------------------------------------

describe('i18nLogger (dev env — enabled)', () => {
  let devLogger: Awaited<ReturnType<typeof getDevLogger>>;

  beforeEach(async () => {
    devLogger = await getDevLogger();
    devLogger.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ---- logMissingKey: first call emits a warning --------------------------

  describe('logMissingKey – first occurrence', () => {
    it('calls logger.warn (via console.warn) on first encounter of a key', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      devLogger.logMissingKey('common.hello', 'Header');
      expect(warnSpy).toHaveBeenCalledTimes(1);
      // The warning message should contain the key
      const callArg = warnSpy.mock.calls[0].join(' ');
      expect(callArg).toContain('common.hello');
    });

    it('records the component name alongside the key', () => {
      devLogger.logMissingKey('nav.home', 'Sidebar');
      const report = devLogger.getMissingKeysReport();
      expect(report[0].component).toBe('Sidebar');
    });

    it('sets initial count to 1', () => {
      devLogger.logMissingKey('nav.about');
      const report = devLogger.getMissingKeysReport();
      expect(report[0].count).toBe(1);
    });

    it('records a timestamp (numeric, recent)', () => {
      const before = Date.now();
      devLogger.logMissingKey('a.b');
      const after = Date.now();
      const { timestamp } = devLogger.getMissingKeysReport()[0];
      expect(timestamp).toBeGreaterThanOrEqual(before);
      expect(timestamp).toBeLessThanOrEqual(after);
    });
  });

  // ---- logMissingKey: deduplication (same key called again) ---------------

  describe('logMissingKey – deduplication / throttle', () => {
    it('does NOT emit a second warning for the same key on repeat calls', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      devLogger.logMissingKey('dup.key');
      devLogger.logMissingKey('dup.key');
      devLogger.logMissingKey('dup.key');
      // Only one warn for three calls to the same key
      expect(warnSpy).toHaveBeenCalledTimes(1);
    });

    it('increments count on repeated calls for the same key', () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      devLogger.logMissingKey('repeat.me');
      devLogger.logMissingKey('repeat.me');
      devLogger.logMissingKey('repeat.me');
      const report = devLogger.getMissingKeysReport();
      expect(report[0].count).toBe(3);
    });

    it('emits separate warnings for distinct keys', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      devLogger.logMissingKey('key.one');
      devLogger.logMissingKey('key.two');
      expect(warnSpy).toHaveBeenCalledTimes(2);
    });

    it('maintains separate counts for distinct keys', () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      devLogger.logMissingKey('a.x');
      devLogger.logMissingKey('a.x');
      devLogger.logMissingKey('b.y');
      const report = devLogger.getMissingKeysReport();
      const a = report.find(r => r.key === 'a.x');
      const b = report.find(r => r.key === 'b.y');
      expect(a?.count).toBe(2);
      expect(b?.count).toBe(1);
    });
  });

  // ---- getMissingKeysReport -----------------------------------------------

  describe('getMissingKeysReport', () => {
    it('returns all logged keys', () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      devLogger.logMissingKey('x.a');
      devLogger.logMissingKey('x.b');
      const report = devLogger.getMissingKeysReport();
      const keys = report.map(r => r.key);
      expect(keys).toContain('x.a');
      expect(keys).toContain('x.b');
    });

    it('sorts by count descending (most frequent first)', () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      devLogger.logMissingKey('rare.key');
      devLogger.logMissingKey('frequent.key');
      devLogger.logMissingKey('frequent.key');
      devLogger.logMissingKey('frequent.key');
      const report = devLogger.getMissingKeysReport();
      expect(report[0].key).toBe('frequent.key');
      expect(report[1].key).toBe('rare.key');
    });

    it('returns empty array when no keys have been logged', () => {
      expect(devLogger.getMissingKeysReport()).toEqual([]);
    });

    it('each entry has key, count, timestamp, and optional component', () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      devLogger.logMissingKey('check.fields', 'MyComp');
      const [entry] = devLogger.getMissingKeysReport();
      expect(entry).toHaveProperty('key', 'check.fields');
      expect(entry).toHaveProperty('count');
      expect(entry).toHaveProperty('timestamp');
      expect(entry).toHaveProperty('component', 'MyComp');
    });
  });

  // ---- exportMissingKeys --------------------------------------------------

  describe('exportMissingKeys', () => {
    it('returns empty object when no keys logged', () => {
      expect(devLogger.exportMissingKeys()).toEqual({});
    });

    it('nests dotted key into a nested object structure', () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      devLogger.logMissingKey('common.header.title');
      const exported = devLogger.exportMissingKeys();
      expect(exported).toHaveProperty('common');
      expect(exported.common).toHaveProperty('header');
      expect(exported.common.header).toHaveProperty('title');
    });

    it('leaf value contains "Missing translation for:" and the key', () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      devLogger.logMissingKey('a.b.c');
      const exported = devLogger.exportMissingKeys();
      expect(exported.a.b.c).toMatch(/Missing translation for:.*a\.b\.c/);
    });

    it('handles a flat (non-dotted) key as a top-level entry', () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      devLogger.logMissingKey('flatkey');
      const exported = devLogger.exportMissingKeys();
      expect(exported).toHaveProperty('flatkey');
      expect(typeof exported.flatkey).toBe('string');
    });

    it('merges multiple keys into the same section object', () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      devLogger.logMissingKey('section.keyA');
      devLogger.logMissingKey('section.keyB');
      const exported = devLogger.exportMissingKeys();
      expect(exported.section).toHaveProperty('keyA');
      expect(exported.section).toHaveProperty('keyB');
    });
  });

  // ---- generateSuggestion (exercised via console.warn side-effect) --------

  describe('suggestion string in warn output', () => {
    it('suggestion for dotted key references the section', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      devLogger.logMissingKey('auth.login.button');
      // The warn is called with message + data object; check both args
      const allArgs = warnSpy.mock.calls[0].join(' ');
      expect(allArgs).toContain('auth');
    });

    it('suggestion for flat (non-dotted) key contains the key verbatim', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      devLogger.logMissingKey('flatkey');
      const allArgs = warnSpy.mock.calls[0].join(' ');
      expect(allArgs).toContain('flatkey');
    });
  });

  // ---- clear() ------------------------------------------------------------

  describe('clear()', () => {
    it('empties the internal map so report returns empty array', () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      devLogger.logMissingKey('gone.key');
      devLogger.clear();
      expect(devLogger.getMissingKeysReport()).toEqual([]);
    });

    it('allows re-logging the same key after clear (triggers warn again)', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      devLogger.logMissingKey('cycle.key');
      devLogger.clear();
      devLogger.logMissingKey('cycle.key');
      // Should have warned twice — once before clear, once after
      expect(warnSpy).toHaveBeenCalledTimes(2);
    });
  });

  // ---- printReport --------------------------------------------------------

  describe('printReport()', () => {
    it('does not throw when keys are present', () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      devLogger.logMissingKey('report.key');
      expect(() => devLogger.printReport()).not.toThrow();
    });

    it('does not throw when no keys are present', () => {
      expect(() => devLogger.printReport()).not.toThrow();
    });
  });
});
