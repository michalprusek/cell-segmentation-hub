/**
 * pythonExtractor.test.ts
 *
 * Behavioral tests for the Python-helper bridge (runHelper internals
 * via extractTiffStack / extractNd2):
 *
 *  - Argument construction: correct script name + positional args
 *  - PROGRESS line parsing: fraction clamped to [0,1], dispatched to callback
 *  - Result JSON: last non-PROGRESS line parsed as the PythonResult
 *  - Non-zero exit: rejects with exit-code + stderr tail
 *  - No result JSON: rejects with descriptive message
 *  - Unparseable final line: rejects with parse-error message
 *  - spawn error event: rejects
 *  - Stderr on zero-exit: warns, still resolves
 *  - buildChannelMeta: IRM auto-detect sets isSegmentationSource=true,
 *    non-IRM channels get isSegmentationSource=false, wavelength→color mapping
 *  - extractTiffStack / extractNd2 surface all ExtractionResult fields
 *
 * NOTE: real child_process.spawn is mocked — no Python interpreter needed.
 */

import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { EventEmitter } from 'events';

// ── Mocks (hoisted) ──────────────────────────────────────────────────────────

vi.mock('child_process', () => ({
  spawn: vi.fn(),
}));

vi.mock('../../../utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// Stub import.meta.url so fileURLToPath(import.meta.url) works in tests.
// pythonExtractor.ts derives HELPERS_DIR from its own __filename equivalent.
// Since we mock spawn we don't need the real path — but the module-level
// code runs at import time, so the URL must be resolvable.
vi.mock('url', async importOriginal => {
  const actual = await importOriginal<typeof import('url')>();
  return {
    ...actual,
    fileURLToPath: (u: string | URL) => {
      // Return something path.dirname can handle for the module under test.
      if (String(u).includes('pythonExtractor')) {
        return '/fake/dist/services/video/pythonExtractor.js';
      }
      return actual.fileURLToPath(u);
    },
  };
});

import { spawn } from 'child_process';
import { extractTiffStack, extractNd2 } from '../pythonExtractor';
import { logger } from '../../../utils/logger';

const mockSpawn = spawn as unknown as Mock;

// ---------------------------------------------------------------------------
// Helpers: build a fake child process
// ---------------------------------------------------------------------------

interface FakeChild {
  stdout: EventEmitter;
  stderr: EventEmitter;
  child: EventEmitter & { stdout: EventEmitter; stderr: EventEmitter };
}

function makeFakeChild(): FakeChild {
  const stdout = new EventEmitter();
  const stderr = new EventEmitter();
  const child = Object.assign(new EventEmitter(), { stdout, stderr });
  return { stdout, stderr, child };
}

/** Emit stdout data and then close with code 0 after the tick. */
function resolveWith(
  fake: FakeChild,
  lines: string[],
  stderrContent = ''
): void {
  process.nextTick(() => {
    fake.stdout.emit('data', lines.join('\n'));
    if (stderrContent) fake.stderr.emit('data', stderrContent);
    fake.child.emit('close', 0);
  });
}

/** Make spawn return the given fake child and schedule resolution. */
function setupSpawn(fake: FakeChild): void {
  mockSpawn.mockReturnValue(fake.child);
}

// A minimal valid PythonResult JSON:
function makePythonResult(overrides?: object): object {
  return {
    frameCount: 5,
    durationMs: 500,
    frameIntervalMs: 100,
    pixelSizeUm: 0.12,
    width: 512,
    height: 512,
    channels: [{ name: 'IRM', displayName: 'IRM Channel', wavelengthNm: null }],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('pythonExtractor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Argument construction ─────────────────────────────────────────────────

  describe('extractTiffStack argument construction', () => {
    it('spawns extract_tiff_stack.py with sourcePath and destDir as positional args', async () => {
      const fake = makeFakeChild();
      setupSpawn(fake);
      resolveWith(fake, [JSON.stringify(makePythonResult())]);

      await extractTiffStack('/data/stack.tiff', '/dest/dir');

      const [, scriptArgs] = mockSpawn.mock.calls[0];
      expect(scriptArgs[0]).toMatch(/extract_tiff_stack\.py$/);
      expect(scriptArgs[1]).toBe('/data/stack.tiff');
      expect(scriptArgs[2]).toBe('/dest/dir');
    });

    it('uses PYTHON_BIN env var when set', async () => {
      process.env.PYTHON_BIN = '/opt/venv/bin/python';
      const fake = makeFakeChild();
      setupSpawn(fake);
      resolveWith(fake, [JSON.stringify(makePythonResult())]);

      await extractTiffStack('/a', '/b');

      expect(mockSpawn.mock.calls[0][0]).toBe('/opt/venv/bin/python');
      delete process.env.PYTHON_BIN;
    });

    it('falls back to python3 when PYTHON_BIN is not set', async () => {
      delete process.env.PYTHON_BIN;
      const fake = makeFakeChild();
      setupSpawn(fake);
      resolveWith(fake, [JSON.stringify(makePythonResult())]);

      await extractTiffStack('/a', '/b');

      expect(mockSpawn.mock.calls[0][0]).toBe('python3');
    });
  });

  describe('extractNd2 argument construction', () => {
    it('spawns extract_nd2.py with sourcePath and destDir', async () => {
      const fake = makeFakeChild();
      setupSpawn(fake);
      resolveWith(fake, [JSON.stringify(makePythonResult())]);

      await extractNd2('/data/file.nd2', '/dest');

      const [, scriptArgs] = mockSpawn.mock.calls[0];
      expect(scriptArgs[0]).toMatch(/extract_nd2\.py$/);
      expect(scriptArgs[1]).toBe('/data/file.nd2');
      expect(scriptArgs[2]).toBe('/dest');
    });
  });

  // ── PROGRESS line parsing ─────────────────────────────────────────────────

  describe('PROGRESS line parsing', () => {
    it('calls onProgress callback for each PROGRESS line', async () => {
      const fake = makeFakeChild();
      setupSpawn(fake);
      const cb = vi.fn();

      process.nextTick(() => {
        fake.stdout.emit('data', 'PROGRESS 0.25\nPROGRESS 0.75\n');
        fake.stdout.emit('data', JSON.stringify(makePythonResult()) + '\n');
        fake.child.emit('close', 0);
      });

      await extractTiffStack('/a', '/b', cb);

      expect(cb).toHaveBeenCalledWith({ progress: 0.25 });
      expect(cb).toHaveBeenCalledWith({ progress: 0.75 });
    });

    it('clamps PROGRESS > 1 to 1', async () => {
      const fake = makeFakeChild();
      setupSpawn(fake);
      const cb = vi.fn();

      process.nextTick(() => {
        fake.stdout.emit('data', 'PROGRESS 1.5\n');
        fake.stdout.emit('data', JSON.stringify(makePythonResult()) + '\n');
        fake.child.emit('close', 0);
      });

      await extractTiffStack('/a', '/b', cb);

      expect(cb).toHaveBeenCalledWith({ progress: 1 });
    });

    it('clamps PROGRESS < 0 to 0', async () => {
      const fake = makeFakeChild();
      setupSpawn(fake);
      const cb = vi.fn();

      process.nextTick(() => {
        fake.stdout.emit('data', 'PROGRESS -0.1\n');
        fake.stdout.emit('data', JSON.stringify(makePythonResult()) + '\n');
        fake.child.emit('close', 0);
      });

      await extractTiffStack('/a', '/b', cb);

      expect(cb).toHaveBeenCalledWith({ progress: 0 });
    });

    it('ignores malformed PROGRESS lines (non-numeric)', async () => {
      const fake = makeFakeChild();
      setupSpawn(fake);
      const cb = vi.fn();

      process.nextTick(() => {
        fake.stdout.emit('data', 'PROGRESS notanumber\n');
        fake.stdout.emit('data', JSON.stringify(makePythonResult()) + '\n');
        fake.child.emit('close', 0);
      });

      await extractTiffStack('/a', '/b', cb);

      expect(cb).not.toHaveBeenCalled();
    });

    it('does not call onProgress when callback is not provided', async () => {
      const fake = makeFakeChild();
      setupSpawn(fake);

      process.nextTick(() => {
        fake.stdout.emit('data', 'PROGRESS 0.5\n');
        fake.stdout.emit('data', JSON.stringify(makePythonResult()) + '\n');
        fake.child.emit('close', 0);
      });

      // Should not throw even without a callback.
      await expect(extractTiffStack('/a', '/b')).resolves.toBeDefined();
    });
  });

  // ── Result JSON parsing ───────────────────────────────────────────────────

  describe('result JSON parsing', () => {
    it('resolves with parsed result from the last non-PROGRESS stdout line', async () => {
      const fake = makeFakeChild();
      setupSpawn(fake);
      const pyResult = makePythonResult({ frameCount: 10 });

      resolveWith(fake, ['PROGRESS 0.5', JSON.stringify(pyResult)]);

      const result = await extractTiffStack('/a', '/b');
      expect(result.frameCount).toBe(10);
    });

    it('rejects when stdout is empty (no result JSON)', async () => {
      const fake = makeFakeChild();
      setupSpawn(fake);

      process.nextTick(() => {
        fake.child.emit('close', 0);
      });

      await expect(extractTiffStack('/a', '/b')).rejects.toThrow(
        /produced no result JSON/
      );
    });

    it('rejects when stdout has only PROGRESS lines and no JSON', async () => {
      const fake = makeFakeChild();
      setupSpawn(fake);

      process.nextTick(() => {
        fake.stdout.emit('data', 'PROGRESS 0.1\nPROGRESS 0.9\n');
        fake.child.emit('close', 0);
      });

      await expect(extractTiffStack('/a', '/b')).rejects.toThrow(
        /produced no result JSON/
      );
    });

    it('rejects with parse-error message when the final line is not valid JSON', async () => {
      const fake = makeFakeChild();
      setupSpawn(fake);

      process.nextTick(() => {
        fake.stdout.emit(
          'data',
          'Traceback (most recent call last):\n  invalid'
        );
        fake.child.emit('close', 0);
      });

      await expect(extractTiffStack('/a', '/b')).rejects.toThrow(
        /failed to parse/
      );
    });
  });

  // ── Non-zero exit code ────────────────────────────────────────────────────

  describe('non-zero exit handling', () => {
    it('rejects with exit code and stderr tail on non-zero exit', async () => {
      const fake = makeFakeChild();
      setupSpawn(fake);

      process.nextTick(() => {
        fake.stderr.emit('data', 'ModuleNotFoundError: No module named nd2');
        fake.child.emit('close', 1);
      });

      await expect(extractNd2('/file.nd2', '/dest')).rejects.toThrow(
        /exited 1.*ModuleNotFoundError/s
      );
    });

    it('rejects even when stdout has content if exit code is non-zero', async () => {
      const fake = makeFakeChild();
      setupSpawn(fake);

      process.nextTick(() => {
        fake.stdout.emit('data', JSON.stringify(makePythonResult()));
        fake.child.emit('close', 2);
      });

      await expect(extractTiffStack('/a', '/b')).rejects.toThrow(/exited 2/);
    });
  });

  // ── spawn error event ─────────────────────────────────────────────────────

  describe('spawn error event', () => {
    it('rejects when spawn emits an error event', async () => {
      const fake = makeFakeChild();
      setupSpawn(fake);

      process.nextTick(() => {
        fake.child.emit('error', new Error('ENOENT python3'));
      });

      await expect(extractTiffStack('/a', '/b')).rejects.toThrow(
        'ENOENT python3'
      );
    });
  });

  // ── Stderr on zero-exit ───────────────────────────────────────────────────

  describe('stderr on zero-exit', () => {
    it('warns via logger but resolves when stderr has content and exit is 0', async () => {
      const fake = makeFakeChild();
      setupSpawn(fake);

      process.nextTick(() => {
        fake.stdout.emit('data', JSON.stringify(makePythonResult()));
        fake.stderr.emit('data', 'DeprecationWarning: tifffile API changed');
        fake.child.emit('close', 0);
      });

      const result = await extractTiffStack('/a', '/b');
      expect(result).toBeDefined();
      expect(vi.mocked(logger.warn)).toHaveBeenCalledWith(
        expect.stringContaining('succeeded with stderr'),
        'VideoExtractor'
      );
    });
  });

  // ── buildChannelMeta (via extractTiffStack) ───────────────────────────────

  describe('buildChannelMeta channel classification', () => {
    async function extractWithChannels(channels: object[]) {
      const fake = makeFakeChild();
      setupSpawn(fake);
      resolveWith(fake, [JSON.stringify(makePythonResult({ channels }))]);
      return extractTiffStack('/a', '/b');
    }

    it('marks IRM channel as isSegmentationSource=true', async () => {
      const result = await extractWithChannels([
        { name: 'IRM', wavelengthNm: null },
        { name: 'GFP', wavelengthNm: 488 },
      ]);
      const irm = result.channels.find(c => c.name === 'IRM');
      const gfp = result.channels.find(c => c.name === 'GFP');
      expect(irm?.isSegmentationSource).toBe(true);
      expect(gfp?.isSegmentationSource).toBe(false);
    });

    it('sets type="irm" for IRM channel and type="fluorescent" for others', async () => {
      const result = await extractWithChannels([
        { name: 'IRM', wavelengthNm: null },
        { name: 'DAPI', wavelengthNm: 405 },
      ]);
      expect(result.channels.find(c => c.name === 'IRM')?.type).toBe('irm');
      expect(result.channels.find(c => c.name === 'DAPI')?.type).toBe(
        'fluorescent'
      );
    });

    it('sets isSegmentationSource=false for all channels when none is IRM', async () => {
      const result = await extractWithChannels([
        { name: 'GFP', wavelengthNm: 488 },
        { name: 'mCherry', wavelengthNm: 594 },
      ]);
      expect(result.channels.every(c => !c.isSegmentationSource)).toBe(true);
    });

    it('only the first IRM channel is marked segmentation source (radio behaviour)', async () => {
      const result = await extractWithChannels([
        { name: 'IRM', wavelengthNm: null },
        { name: 'BF', wavelengthNm: 0 },
      ]);
      const sources = result.channels.filter(c => c.isSegmentationSource);
      expect(sources).toHaveLength(1);
      expect(sources[0].name).toBe('IRM');
    });

    it('maps wavelength 488 → blue display color (430–490 nm band)', async () => {
      // Per defaultColorForWavelength: nm < 490 → '#00aaff' (blue).
      const result = await extractWithChannels([
        { name: 'GFP', wavelengthNm: 488 },
      ]);
      expect(result.channels[0].displayColor).toBe('#00aaff');
    });

    it('maps wavelength 530 → green display color (490–530 nm band)', async () => {
      // nm >= 490 && nm < 530 → '#00ff00'
      const result = await extractWithChannels([
        { name: 'GFP530', wavelengthNm: 510 },
      ]);
      expect(result.channels[0].displayColor).toBe('#00ff00');
    });

    it('maps unknown wavelength (null) → gray display color', async () => {
      const result = await extractWithChannels([
        { name: 'IRM', wavelengthNm: null },
      ]);
      expect(result.channels[0].displayColor).toBe('#cccccc');
    });

    it('surfaces displayName from Python result onto ChannelMeta', async () => {
      const result = await extractWithChannels([
        { name: 'ch0', displayName: 'Cy5', wavelengthNm: 650 },
      ]);
      expect(result.channels[0].displayName).toBe('Cy5');
    });
  });

  // ── ExtractionResult field surfacing ─────────────────────────────────────

  describe('ExtractionResult field surfacing', () => {
    async function runExtraction(pyResult: object) {
      const fake = makeFakeChild();
      setupSpawn(fake);
      resolveWith(fake, [JSON.stringify(pyResult)]);
      return extractNd2('/file.nd2', '/dest');
    }

    it('surfaces frameCount, width, height', async () => {
      const r = await runExtraction(
        makePythonResult({ frameCount: 42, width: 1024, height: 768 })
      );
      expect(r.frameCount).toBe(42);
      expect(r.width).toBe(1024);
      expect(r.height).toBe(768);
    });

    it('surfaces frameIntervalMs and pixelSizeUm', async () => {
      const r = await runExtraction(
        makePythonResult({ frameIntervalMs: 250, pixelSizeUm: 0.065 })
      );
      expect(r.frameIntervalMs).toBe(250);
      expect(r.pixelSizeUm).toBe(0.065);
    });

    it('normalises durationMs: null from Python passes through as null', async () => {
      const r = await runExtraction(makePythonResult({ durationMs: null }));
      expect(r.durationMs).toBeNull();
    });

    it('normalises durationMs: numeric value passes through', async () => {
      const r = await runExtraction(makePythonResult({ durationMs: 1200 }));
      expect(r.durationMs).toBe(1200);
    });
  });
});
