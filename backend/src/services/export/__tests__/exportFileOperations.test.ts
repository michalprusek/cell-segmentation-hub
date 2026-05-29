/**
 * exportFileOperations.test.ts
 *
 * Behavioral tests for src/services/export/exportFileOperations.ts:
 *
 *  sanitizeFilename
 *   - non-string / empty → 'export'
 *   - unsafe chars (<>:"|?*\/) replaced with _
 *   - control chars replaced with _
 *   - leading/trailing dots and spaces stripped
 *   - result capped at 100 chars
 *   - Windows reserved names get _export suffix (CON, PRN, NUL, COM1, LPT9 …)
 *   - valid names pass through unchanged
 *
 *  getProgressMessage
 *   - no stage → 'Processing... X%'
 *   - stage only → per-stage message
 *   - stage + stageProgress → includes current/total
 *   - stageProgress with currentItem → includes item suffix
 *   - compression stage ignores stageProgress (uses simple form)
 *
 *  createZipArchive (real FS/archiver — SKIPPED; see note)
 *
 * NOTE: createZipArchive requires a real filesystem + archiver pipeline.
 * Testing it with mocked streams is fragile and provides false confidence —
 * the function's entire value is in real I/O plumbing. It is excluded here
 * per project convention ("skip real-IO"). Run it manually or in E2E.
 */

import { describe, it, expect } from 'vitest';
import { sanitizeFilename, getProgressMessage } from '../exportFileOperations';

// ---------------------------------------------------------------------------
// sanitizeFilename
// ---------------------------------------------------------------------------

describe('sanitizeFilename', () => {
  describe('invalid / empty input', () => {
    it('returns "export" for an empty string', () => {
      expect(sanitizeFilename('')).toBe('export');
    });

    it('returns "export" for a non-string (null-like)', () => {
      // The type signature says string but the guard checks at runtime.
      expect(sanitizeFilename(null as unknown as string)).toBe('export');
    });

    it('returns "export" for a string of only dots', () => {
      expect(sanitizeFilename('...')).toBe('export');
    });

    it('returns "export" for a string of only whitespace', () => {
      expect(sanitizeFilename('   ')).toBe('export');
    });
  });

  describe('unsafe character replacement', () => {
    const UNSAFE = ['<', '>', ':', '"', '|', '?', '*', '\\', '/'];

    for (const char of UNSAFE) {
      it(`replaces "${char}" with underscore`, () => {
        const result = sanitizeFilename(`file${char}name`);
        expect(result).toBe('file_name');
      });
    }

    it('replaces control chars (\\x00–\\x1f) with underscore', () => {
      const result = sanitizeFilename('file\x00name\x1fname');
      expect(result).toBe('file_name_name');
    });

    it('replaces DEL-range control chars (\\x80–\\x9f) with underscore', () => {
      const result = sanitizeFilename('file\x80name');
      expect(result).toBe('file_name');
    });
  });

  describe('leading/trailing dots and spaces', () => {
    it('strips leading dots', () => {
      expect(sanitizeFilename('...myfile')).toBe('myfile');
    });

    it('strips trailing dots', () => {
      expect(sanitizeFilename('myfile...')).toBe('myfile');
    });

    it('strips leading spaces after trim', () => {
      expect(sanitizeFilename('  myfile')).toBe('myfile');
    });

    it('strips trailing spaces', () => {
      expect(sanitizeFilename('myfile  ')).toBe('myfile');
    });
  });

  describe('length truncation', () => {
    it('truncates to 100 characters', () => {
      const long = 'a'.repeat(150);
      expect(sanitizeFilename(long)).toHaveLength(100);
    });

    it('does not truncate names at or below 100 characters', () => {
      const exact = 'a'.repeat(100);
      expect(sanitizeFilename(exact)).toBe(exact);
    });
  });

  describe('Windows reserved names', () => {
    const RESERVED = [
      'CON',
      'PRN',
      'AUX',
      'NUL',
      'COM1',
      'COM9',
      'LPT1',
      'LPT9',
    ];

    for (const name of RESERVED) {
      it(`appends "_export" to "${name}"`, () => {
        expect(sanitizeFilename(name)).toBe(`${name}_export`);
      });

      it(`appends "_export" to lowercase "${name.toLowerCase()}"`, () => {
        const lower = name.toLowerCase();
        expect(sanitizeFilename(lower)).toBe(`${lower}_export`);
      });
    }
  });

  describe('valid filenames pass through', () => {
    it('leaves a simple alphanumeric name unchanged', () => {
      expect(sanitizeFilename('my_project')).toBe('my_project');
    });

    it('leaves a name with hyphens and dots unchanged', () => {
      expect(sanitizeFilename('export-2026.zip')).toBe('export-2026.zip');
    });

    it('preserves unicode letters', () => {
      // Czech diacritics — no unsafe chars, should pass through.
      const name = 'buňky-projekt';
      expect(sanitizeFilename(name)).toBe(name);
    });
  });
});

// ---------------------------------------------------------------------------
// getProgressMessage
// ---------------------------------------------------------------------------

describe('getProgressMessage', () => {
  describe('no stage', () => {
    it('returns generic "Processing... X%" when no stage provided', () => {
      expect(getProgressMessage(42)).toBe('Processing... 42%');
    });

    it('includes 0% correctly', () => {
      expect(getProgressMessage(0)).toBe('Processing... 0%');
    });
  });

  describe('stage only (no stageProgress)', () => {
    it('images stage', () => {
      expect(getProgressMessage(10, 'images')).toBe(
        'Copying original images... 10%'
      );
    });

    it('visualizations stage', () => {
      expect(getProgressMessage(20, 'visualizations')).toBe(
        'Generating visualizations... 20%'
      );
    });

    it('annotations stage', () => {
      expect(getProgressMessage(30, 'annotations')).toBe(
        'Creating annotation files... 30%'
      );
    });

    it('metrics stage', () => {
      expect(getProgressMessage(40, 'metrics')).toBe(
        'Calculating metrics... 40%'
      );
    });

    it('compression stage', () => {
      expect(getProgressMessage(50, 'compression')).toBe(
        'Creating archive... 50%'
      );
    });
  });

  describe('stage + stageProgress', () => {
    it('images with current/total', () => {
      const msg = getProgressMessage(25, 'images', { current: 3, total: 10 });
      expect(msg).toBe('Copying original images (3/10)... 25%');
    });

    it('visualizations with current/total', () => {
      const msg = getProgressMessage(60, 'visualizations', {
        current: 6,
        total: 10,
      });
      expect(msg).toBe('Generating visualizations (6/10)... 60%');
    });

    it('annotations with current/total', () => {
      const msg = getProgressMessage(70, 'annotations', {
        current: 7,
        total: 10,
      });
      expect(msg).toBe('Creating annotation files (7/10)... 70%');
    });

    it('metrics with current/total', () => {
      const msg = getProgressMessage(80, 'metrics', { current: 8, total: 10 });
      expect(msg).toBe('Calculating metrics (8/10)... 80%');
    });

    it('compression with stageProgress still uses simple form', () => {
      const msg = getProgressMessage(90, 'compression', {
        current: 1,
        total: 1,
      });
      expect(msg).toBe('Creating archive... 90%');
    });

    it('includes currentItem suffix when provided', () => {
      const msg = getProgressMessage(50, 'images', {
        current: 5,
        total: 10,
        currentItem: 'image_001.png',
      });
      expect(msg).toContain(': image_001.png');
      expect(msg).toBe('Copying original images (5/10): image_001.png... 50%');
    });

    it('omits item suffix when currentItem is undefined', () => {
      const msg = getProgressMessage(50, 'metrics', { current: 2, total: 4 });
      expect(msg).not.toContain(': ');
    });
  });

  describe('default branch for unknown stage', () => {
    it('uses generic "Processing <stage>" message when stage is an unknown value', () => {
      // Cast to bypass TS union; covers the `default:` branch.
      const stage = 'unknown_stage' as Parameters<typeof getProgressMessage>[1];
      const msg = getProgressMessage(55, stage, { current: 1, total: 2 });
      expect(msg).toContain('unknown_stage');
      expect(msg).toContain('1/2');
      expect(msg).toContain('55%');
    });
  });
});
