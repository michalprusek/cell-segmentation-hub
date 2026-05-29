/**
 * ffmpegExtractor.test.ts
 *
 * Tests extraction orchestration, output path construction, progress callbacks,
 * error handling, and isFfmpegFormat utility. Mocks child_process.spawn and
 * fs/promises — zero real ffmpeg execution.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ChildProcess } from 'child_process';

// ─── hoisted mock references ─────────────────────────────────────────────────
const { mockSpawn, mockMkdir, mockReaddir, mockRename, mockRmdir } = vi.hoisted(
  () => ({
    mockSpawn: vi.fn() as ReturnType<typeof vi.fn>,
    mockMkdir: vi.fn() as ReturnType<typeof vi.fn>,
    mockReaddir: vi.fn() as ReturnType<typeof vi.fn>,
    mockRename: vi.fn() as ReturnType<typeof vi.fn>,
    mockRmdir: vi.fn() as ReturnType<typeof vi.fn>,
  })
);

vi.mock('child_process', () => ({ spawn: mockSpawn }));

vi.mock('fs/promises', () => ({
  mkdir: mockMkdir,
  readdir: mockReaddir,
  rename: mockRename,
  rmdir: mockRmdir,
  constants: { W_OK: 2, R_OK: 4 },
}));

vi.mock('ffmpeg-static', () => ({ default: '/usr/bin/ffmpeg' }));

vi.mock('../../../utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { extractWithFfmpeg, isFfmpegFormat } from '../ffmpegExtractor';

// ─── helpers ─────────────────────────────────────────────────────────────────

type FakeListeners = Record<string, ((...args: unknown[]) => void)[]>;

/**
 * Build a minimal fake child_process that records on() subscriptions and lets
 * the test trigger them via emit().
 */
function makeFakeChild() {
  const listeners: FakeListeners = { error: [], close: [] };
  const stdoutListeners: FakeListeners = { data: [] };
  const stderrListeners: FakeListeners = { data: [] };

  const child = {
    stdout: {
      on: (event: string, cb: (...args: unknown[]) => void) => {
        if (!stdoutListeners[event]) stdoutListeners[event] = [];
        stdoutListeners[event].push(cb);
      },
    },
    stderr: {
      on: (event: string, cb: (...args: unknown[]) => void) => {
        if (!stderrListeners[event]) stderrListeners[event] = [];
        stderrListeners[event].push(cb);
      },
    },
    on: (event: string, cb: (...args: unknown[]) => void) => {
      if (!listeners[event]) listeners[event] = [];
      listeners[event].push(cb);
    },
    emit: (event: string, ...args: unknown[]) => {
      listeners[event]?.forEach(cb => cb(...args));
      stdoutListeners[event]?.forEach(cb => cb(...args));
      stderrListeners[event]?.forEach(cb => cb(...args));
    },
    emitStdout: (data: string) =>
      stdoutListeners['data']?.forEach(cb => cb(data)),
    emitStderr: (data: string) =>
      stderrListeners['data']?.forEach(cb => cb(data)),
    emitClose: (code: number) => listeners['close']?.forEach(cb => cb(code)),
    emitError: (err: Error) => listeners['error']?.forEach(cb => cb(err)),
  } as unknown as ChildProcess & {
    emitStdout: (d: string) => void;
    emitStderr: (d: string) => void;
    emitClose: (c: number) => void;
    emitError: (e: Error) => void;
  };

  return child;
}

/** Valid ffprobe JSON payload for 3 frames, 1920×1080, 1 second */
const PROBE_JSON = JSON.stringify({
  streams: [
    {
      width: 1920,
      height: 1080,
      duration: '1.000000',
      nb_read_packets: '3',
    },
  ],
});

/**
 * Wire up mockSpawn to return two fake children in sequence:
 *   1st call = ffprobe probe
 *   2nd call = ffmpeg extraction
 */
function wireSpawnForSuccess(
  probeOutput = PROBE_JSON,
  ffmpegStderr = ''
): {
  probeChild: ReturnType<typeof makeFakeChild>;
  ffmpegChild: ReturnType<typeof makeFakeChild>;
} {
  const probeChild = makeFakeChild();
  const ffmpegChild = makeFakeChild();
  let callCount = 0;

  mockSpawn.mockImplementation(() => {
    callCount++;
    return callCount === 1 ? probeChild : ffmpegChild;
  });

  // Automatically settle children after being registered
  // (use setImmediate so event listeners are attached first)
  setImmediate(() => {
    probeChild.emitStdout(probeOutput);
    probeChild.emitClose(0);
  });
  setImmediate(() => {
    if (ffmpegStderr) ffmpegChild.emitStderr(ffmpegStderr);
    ffmpegChild.emitClose(0);
  });

  return { probeChild, ffmpegChild };
}

// ─── tests ───────────────────────────────────────────────────────────────────

describe('extractWithFfmpeg', () => {
  beforeEach(() => {
    mockMkdir.mockResolvedValue(undefined);
    mockReaddir.mockResolvedValue(['000001.png', '000002.png', '000003.png']);
    mockRename.mockResolvedValue(undefined);
    mockRmdir.mockResolvedValue(undefined);
  });

  describe('successful extraction', () => {
    it('returns correct frame count from flat directory listing', async () => {
      wireSpawnForSuccess();
      const result = await extractWithFfmpeg('/src/video.mp4', '/dest');
      expect(result.frameCount).toBe(3);
    });

    it('creates flat extraction directory inside destDir', async () => {
      wireSpawnForSuccess();
      await extractWithFfmpeg('/src/video.mp4', '/dest');
      // flatDir = /dest/_extract_flat
      expect(mockMkdir).toHaveBeenCalledWith(
        expect.stringContaining('_extract_flat'),
        { recursive: true }
      );
    });

    it('creates per-frame subdirectories with zero-padded names', async () => {
      wireSpawnForSuccess();
      await extractWithFfmpeg('/src/video.mp4', '/dest');
      // Frame 0 → /dest/frames/0000, frame 1 → /dest/frames/0001, etc.
      expect(mockMkdir).toHaveBeenCalledWith(
        expect.stringContaining('frames/0000'),
        { recursive: true }
      );
      expect(mockMkdir).toHaveBeenCalledWith(
        expect.stringContaining('frames/0001'),
        { recursive: true }
      );
    });

    it('uses default channel name "video" when none provided', async () => {
      wireSpawnForSuccess();
      await extractWithFfmpeg('/src/video.mp4', '/dest');
      expect(mockRename).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringContaining('video.png')
      );
    });

    it('uses custom channelName in output paths', async () => {
      wireSpawnForSuccess();
      await extractWithFfmpeg('/src/video.mp4', '/dest', {
        channelName: 'GFP',
      });
      expect(mockRename).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringContaining('GFP.png')
      );
    });

    it('populates channels with type fluorescent and isSegmentationSource false', async () => {
      wireSpawnForSuccess();
      const result = await extractWithFfmpeg('/src/video.mp4', '/dest');
      expect(result.channels).toHaveLength(1);
      expect(result.channels[0].type).toBe('fluorescent');
      expect(result.channels[0].isSegmentationSource).toBe(false);
    });

    it('derives frameIntervalMs from probed duration when >1 frame', async () => {
      wireSpawnForSuccess(); // 3 frames, 1000 ms duration
      const result = await extractWithFfmpeg('/src/video.mp4', '/dest');
      // durationMs / (frameCount - 1) = 1000 / 2 = 500
      expect(result.frameIntervalMs).toBeCloseTo(500, 0);
    });

    it('sets frameIntervalMs to null for single-frame video', async () => {
      const singleFrameProbe = JSON.stringify({
        streams: [
          { width: 640, height: 480, duration: '0.033', nb_read_packets: '1' },
        ],
      });
      const probeChild = makeFakeChild();
      const ffmpegChild = makeFakeChild();
      let calls = 0;
      mockSpawn.mockImplementation(() =>
        ++calls === 1 ? probeChild : ffmpegChild
      );
      mockReaddir.mockResolvedValue(['000001.png']);
      setImmediate(() => {
        probeChild.emitStdout(singleFrameProbe);
        probeChild.emitClose(0);
      });
      setImmediate(() => {
        ffmpegChild.emitClose(0);
      });

      const result = await extractWithFfmpeg('/src/video.mp4', '/dest');
      expect(result.frameIntervalMs).toBeNull();
    });

    it('returns probed width and height in result', async () => {
      wireSpawnForSuccess();
      const result = await extractWithFfmpeg('/src/video.mp4', '/dest');
      expect(result.width).toBe(1920);
      expect(result.height).toBe(1080);
    });

    it('returns durationMs from probe', async () => {
      wireSpawnForSuccess();
      const result = await extractWithFfmpeg('/src/video.mp4', '/dest');
      expect(result.durationMs).toBe(1000);
    });

    it('calls onProgress callback at least on first and last frame', async () => {
      wireSpawnForSuccess();
      const onProgress = vi.fn();
      await extractWithFfmpeg('/src/video.mp4', '/dest', { onProgress });
      expect(onProgress).toHaveBeenCalled();
      const calls = onProgress.mock.calls;
      // Last call should have progress === 1
      const lastCall = calls[calls.length - 1][0];
      expect(lastCall.progress).toBe(1);
    });

    it('removes flat extraction directory after rename', async () => {
      wireSpawnForSuccess();
      await extractWithFfmpeg('/src/video.mp4', '/dest');
      expect(mockRmdir).toHaveBeenCalledWith(
        expect.stringContaining('_extract_flat')
      );
    });

    it('warns on stderr output but does not fail', async () => {
      const { logger } = await import('../../../utils/logger');
      wireSpawnForSuccess(PROBE_JSON, 'PTS discontinuity detected');
      const result = await extractWithFfmpeg('/src/video.mp4', '/dest');
      expect(result.frameCount).toBe(3);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('stderr'),
        expect.any(String)
      );
    });

    it('falls back gracefully when probe fails (non-zero exit)', async () => {
      // Probe returns non-zero → null → totalFrames = -1
      const probeChild = makeFakeChild();
      const ffmpegChild = makeFakeChild();
      let calls = 0;
      mockSpawn.mockImplementation(() =>
        ++calls === 1 ? probeChild : ffmpegChild
      );
      setImmediate(() => {
        probeChild.emitClose(1);
      }); // failure
      setImmediate(() => {
        ffmpegChild.emitClose(0);
      });

      const result = await extractWithFfmpeg('/src/video.mp4', '/dest');
      // Still returns frames from readdir; width/height default to 0
      expect(result.frameCount).toBe(3);
      expect(result.width).toBe(0);
      expect(result.height).toBe(0);
      expect(result.durationMs).toBeNull();
    });

    it('falls back when probe stdout is invalid JSON', async () => {
      const probeChild = makeFakeChild();
      const ffmpegChild = makeFakeChild();
      let calls = 0;
      mockSpawn.mockImplementation(() =>
        ++calls === 1 ? probeChild : ffmpegChild
      );
      setImmediate(() => {
        probeChild.emitStdout('{bad json');
        probeChild.emitClose(0);
      });
      setImmediate(() => {
        ffmpegChild.emitClose(0);
      });

      const result = await extractWithFfmpeg('/src/video.mp4', '/dest');
      expect(result.width).toBe(0); // probe returned null
    });

    it('falls back when probe stream entry is missing', async () => {
      const emptyProbe = JSON.stringify({ streams: [] });
      const probeChild = makeFakeChild();
      const ffmpegChild = makeFakeChild();
      let calls = 0;
      mockSpawn.mockImplementation(() =>
        ++calls === 1 ? probeChild : ffmpegChild
      );
      setImmediate(() => {
        probeChild.emitStdout(emptyProbe);
        probeChild.emitClose(0);
      });
      setImmediate(() => {
        ffmpegChild.emitClose(0);
      });

      const result = await extractWithFfmpeg('/src/video.mp4', '/dest');
      expect(result.width).toBe(0);
    });

    it('falls back when probe stream has non-finite frameCount', async () => {
      const badFrameProbe = JSON.stringify({
        streams: [
          { width: 640, height: 480, duration: '1.0', nb_read_packets: 'NaN' },
        ],
      });
      const probeChild = makeFakeChild();
      const ffmpegChild = makeFakeChild();
      let calls = 0;
      mockSpawn.mockImplementation(() =>
        ++calls === 1 ? probeChild : ffmpegChild
      );
      setImmediate(() => {
        probeChild.emitStdout(badFrameProbe);
        probeChild.emitClose(0);
      });
      setImmediate(() => {
        ffmpegChild.emitClose(0);
      });

      const result = await extractWithFfmpeg('/src/video.mp4', '/dest');
      expect(result.width).toBe(0);
    });
  });

  describe('error handling', () => {
    it('throws when ffmpeg exits with non-zero code', async () => {
      const probeChild = makeFakeChild();
      const ffmpegChild = makeFakeChild();
      let calls = 0;
      mockSpawn.mockImplementation(() =>
        ++calls === 1 ? probeChild : ffmpegChild
      );
      setImmediate(() => {
        probeChild.emitClose(0);
      }); // probe: nothing useful
      setImmediate(() => {
        ffmpegChild.emitStderr('codec not found');
        ffmpegChild.emitClose(1);
      });

      await expect(
        extractWithFfmpeg('/src/video.mp4', '/dest')
      ).rejects.toThrow(/ffmpeg exited 1/);
    });

    it('throws when ffmpeg spawn emits error event', async () => {
      const probeChild = makeFakeChild();
      const ffmpegChild = makeFakeChild();
      let calls = 0;
      mockSpawn.mockImplementation(() =>
        ++calls === 1 ? probeChild : ffmpegChild
      );
      setImmediate(() => {
        probeChild.emitClose(0);
      });
      setImmediate(() => {
        ffmpegChild.emitError(new Error('ENOENT'));
      });

      await expect(
        extractWithFfmpeg('/src/video.mp4', '/dest')
      ).rejects.toThrow('ENOENT');
    });

    it('throws when ffmpeg exits 0 but writes no PNG files', async () => {
      mockReaddir.mockResolvedValue([]); // no .png files
      const probeChild = makeFakeChild();
      const ffmpegChild = makeFakeChild();
      let calls = 0;
      mockSpawn.mockImplementation(() =>
        ++calls === 1 ? probeChild : ffmpegChild
      );
      setImmediate(() => {
        probeChild.emitClose(0);
      });
      setImmediate(() => {
        ffmpegChild.emitStderr('unsupported codec');
        ffmpegChild.emitClose(0);
      });

      await expect(
        extractWithFfmpeg('/src/video.mp4', '/dest')
      ).rejects.toThrow(/ffmpeg produced no frames/);
    });

    it('includes stderr tail in no-frames error message', async () => {
      mockReaddir.mockResolvedValue([]);
      const probeChild = makeFakeChild();
      const ffmpegChild = makeFakeChild();
      let calls = 0;
      mockSpawn.mockImplementation(() =>
        ++calls === 1 ? probeChild : ffmpegChild
      );
      setImmediate(() => {
        probeChild.emitClose(0);
      });
      setImmediate(() => {
        ffmpegChild.emitStderr('Broken pipe in muxer');
        ffmpegChild.emitClose(0);
      });

      await expect(
        extractWithFfmpeg('/src/video.mp4', '/dest')
      ).rejects.toThrow(/Broken pipe in muxer/);
    });

    it('only includes .png files from flat directory (ignores other extensions)', async () => {
      mockReaddir.mockResolvedValue(['000001.png', 'thumb.jpg', '000002.png']);
      wireSpawnForSuccess();
      const result = await extractWithFfmpeg('/src/video.mp4', '/dest');
      // thumb.jpg is filtered out
      expect(result.frameCount).toBe(2);
    });
  });

  describe('probe error handling', () => {
    it('falls back to null probe when probe child emits error event', async () => {
      const probeChild = makeFakeChild();
      const ffmpegChild = makeFakeChild();
      let calls = 0;
      mockSpawn.mockImplementation(() =>
        ++calls === 1 ? probeChild : ffmpegChild
      );
      setImmediate(() => {
        probeChild.emitError(new Error('spawn fail'));
      });
      setImmediate(() => {
        ffmpegChild.emitClose(0);
      });

      const result = await extractWithFfmpeg('/src/video.mp4', '/dest');
      expect(result.width).toBe(0); // fallback
    });
  });
});

describe('isFfmpegFormat', () => {
  it.each(['.mp4', '.avi', '.mov', '.mkv', '.webm'])(
    'returns true for %s',
    ext => {
      expect(isFfmpegFormat(ext)).toBe(true);
    }
  );

  it.each(['.MP4', '.AVI', '.MOV', '.MKV', '.WEBM'])(
    'returns true for uppercase %s (case-insensitive)',
    ext => {
      expect(isFfmpegFormat(ext)).toBe(true);
    }
  );

  it.each(['.tif', '.tiff', '.nd2', '.png', '.jpg', '.gif', ''])(
    'returns false for %s',
    ext => {
      expect(isFfmpegFormat(ext)).toBe(false);
    }
  );
});
