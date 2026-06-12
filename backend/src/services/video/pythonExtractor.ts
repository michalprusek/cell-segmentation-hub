/**
 * Bridge to the Python helpers that read microscopy-specific formats
 * (multi-page TIFF stacks, Nikon ND2). The Python side is responsible
 * for decoding axes, applying max-projection across Z, normalising to
 * 8-bit PNG, and emitting one file per (frame, channel) tuple.
 *
 * The helpers print a single JSON object to stdout describing the
 * detected channels and frame count; we parse that and surface it as
 * an :class:`ExtractionResult`.
 */

import { spawn } from 'child_process';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { logger } from '../../utils/logger';
import {
  ChannelMeta,
  defaultColorForWavelength,
  ExtractedPosition,
  ExtractionOutcome,
  ExtractionResult,
  isIrmChannel,
  ProgressCallback,
} from './types';

// The backend runs under tsx in ES-module mode where __dirname is not
// defined. Resolve our own dir from import.meta.url so the spawned
// Python helpers can find each other regardless of cwd.
const _MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const HELPERS_DIR = path.join(_MODULE_DIR, 'pythonHelpers');

interface PythonResult {
  frameCount: number;
  durationMs: number | null;
  /** Median ms between consecutive frames; null when unknown. Both
   *  helpers always emit the key. */
  frameIntervalMs: number | null;
  /** Isotropic pixel size in µm; null when unknown. */
  pixelSizeUm: number | null;
  width: number;
  height: number;
  channels: Array<{
    name: string;
    displayName?: string | null;
    wavelengthNm?: number | null;
  }>;
}

/** One position entry in a multi-position ND2 result: a single-position
 *  result plus position identity + the frames subdir it was written to. */
interface PythonPosition extends PythonResult {
  index: number;
  name: string | null;
  stageXUm: number | null;
  stageYUm: number | null;
  framesSubdir: string;
  originalFile: string;
}

/** ``extract_nd2.py`` prints either a single result or, for multi-position
 *  files, ``{ positions: [...] }``. The discriminant is the ``positions``
 *  key. */
type PythonNd2Result = PythonResult | { positions: PythonPosition[] };

async function runHelper<T = PythonResult>(
  scriptName: string,
  args: readonly string[],
  onProgress?: ProgressCallback
): Promise<T> {
  const interpreter = process.env.PYTHON_BIN || 'python3';
  const scriptPath = path.join(HELPERS_DIR, scriptName);

  return new Promise<T>((resolve, reject) => {
    const child = spawn(interpreter, [scriptPath, ...args]);
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => {
      const text = chunk.toString();
      stdout += text;
      // Helpers may emit progress lines prefixed with "PROGRESS " — pick
      // these out as they arrive without waiting for the final JSON.
      if (onProgress) {
        for (const line of text.split('\n')) {
          if (line.startsWith('PROGRESS ')) {
            const fraction = parseFloat(line.slice(9).trim());
            if (Number.isFinite(fraction)) {
              onProgress({ progress: Math.max(0, Math.min(1, fraction)) });
            }
          }
        }
      }
    });
    child.stderr.on('data', c => (stderr += c.toString()));
    child.on('error', reject);
    child.on('close', code => {
      if (code !== 0) {
        return reject(
          new Error(
            `python helper ${scriptName} exited ${code}: ${stderr.slice(-500)}`
          )
        );
      }
      // Helpers occasionally warn on stderr while still exiting 0 (e.g.
      // tifffile deprecation, partial-page skip). Surface to ops at warn
      // so the "first 3 pages decoded as wrong axes order" message
      // doesn't vanish.
      if (stderr.trim().length > 0) {
        logger.warn(
          `python helper ${scriptName} succeeded with stderr: ${stderr.slice(-500)}`,
          'VideoExtractor'
        );
      }
      const finalLine = stdout
        .split('\n')
        .map(l => l.trim())
        .filter(l => l.length > 0 && !l.startsWith('PROGRESS '))
        .pop();
      if (!finalLine) {
        return reject(
          new Error(
            `${scriptName} produced no result JSON. stdout tail: ${stdout.slice(-300)} | stderr: ${stderr.slice(-300)}`
          )
        );
      }
      try {
        resolve(JSON.parse(finalLine));
      } catch (err) {
        // Don't lose the actual output we tried to parse; ops needs it
        // when the helper accidentally prints a traceback as the "final
        // line" and the JSON parse blows up downstream.
        reject(
          new Error(
            `failed to parse ${scriptName} output: ${err}. final line: ${finalLine.slice(0, 200)}`
          )
        );
      }
    });
  });
}

function buildChannelMeta(
  raw: PythonResult['channels'],
  preferIrmSource: boolean
): ChannelMeta[] {
  // Pick exactly one channel as the segmentation source (the IRM one if we
  // can find it). Per design this radio behaviour means at most one true.
  let irmIndex = -1;
  for (let i = 0; i < raw.length; i++) {
    const r = raw[i];
    if (isIrmChannel(r.name, r.wavelengthNm ?? undefined)) {
      irmIndex = i;
      break;
    }
  }

  return raw.map((r, i) => ({
    name: r.name,
    displayName: r.displayName ?? undefined,
    type: isIrmChannel(r.name, r.wavelengthNm ?? undefined)
      ? 'irm'
      : 'fluorescent',
    wavelengthNm: r.wavelengthNm ?? undefined,
    displayColor: defaultColorForWavelength(r.wavelengthNm ?? undefined),
    isSegmentationSource: preferIrmSource && i === irmIndex,
  }));
}

export async function extractTiffStack(
  sourcePath: string,
  destDir: string,
  onProgress?: ProgressCallback
): Promise<ExtractionResult> {
  const result = await runHelper(
    'extract_tiff_stack.py',
    [sourcePath, destDir],
    onProgress
  );
  const channels = buildChannelMeta(result.channels, true);
  logger.info('Multi-page TIFF extracted', 'VideoExtractor', {
    sourcePath,
    frames: result.frameCount,
    channels: channels.length,
  });
  return {
    frameCount: result.frameCount,
    durationMs: result.durationMs ?? null,
    frameIntervalMs: result.frameIntervalMs,
    pixelSizeUm: result.pixelSizeUm,
    channels,
    width: result.width,
    height: result.height,
  };
}

/** Map a single Python result object to an ExtractionResult (builds channel
 *  metadata + IRM source detection). Shared by the single and per-position
 *  ND2 branches. */
function toExtractionResult(r: PythonResult): ExtractionResult {
  return {
    frameCount: r.frameCount,
    durationMs: r.durationMs ?? null,
    frameIntervalMs: r.frameIntervalMs,
    pixelSizeUm: r.pixelSizeUm,
    channels: buildChannelMeta(r.channels, true),
    width: r.width,
    height: r.height,
  };
}

export async function extractNd2(
  sourcePath: string,
  destDir: string,
  onProgress?: ProgressCallback
): Promise<ExtractionOutcome> {
  const raw = await runHelper<PythonNd2Result>(
    'extract_nd2.py',
    [sourcePath, destDir],
    onProgress
  );

  // Multi-position (well-plate / multipoint): one container per XY position.
  // The `positions` key is the discriminant; presence alone narrows the
  // union (the type guarantees it's an array).
  if ('positions' in raw) {
    const positions: ExtractedPosition[] = raw.positions.map(p => ({
      positionIndex: p.index,
      positionName: p.name ?? null,
      stageXUm: p.stageXUm ?? null,
      stageYUm: p.stageYUm ?? null,
      framesSubdir: p.framesSubdir,
      originalFile: p.originalFile,
      result: toExtractionResult(p),
    }));
    logger.info('Multi-position ND2 extracted', 'VideoExtractor', {
      sourcePath,
      positions: positions.length,
      framesEach: positions[0]?.result.frameCount,
      channels: positions[0]?.result.channels.length,
    });
    return { kind: 'multi', positions };
  }

  // Single-position (historical path) — frames at <dest>/frames/...
  const result = toExtractionResult(raw);
  logger.info('ND2 file extracted', 'VideoExtractor', {
    sourcePath,
    frames: result.frameCount,
    channels: result.channels.length,
  });
  return { kind: 'single', result };
}
