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
    /** Gap frame index -> the frame index it reads from, emitted by
     *  `plane_coverage.py` only for a channel the acquisition left holes in.
     *  Absent (the overwhelmingly common case) = this channel is real on every
     *  frame. String keys because that is what JSON does to Python's integer
     *  keys. Frames that are neither keys nor values were acquired normally. */
    fillFrames?: Record<string, number>;
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
    child.on('close', (code, signal) => {
      // A helper KILLED by a signal reports code === null, and the reason
      // lives entirely in `signal`. Dropping it printed "exited null:" with an
      // empty stderr tail — SIGKILL gives the process no chance to write
      // anything — which named neither the failure nor a place to look. On
      // this deployment the overwhelmingly likely SIGKILL is the cgroup OOM
      // killer: the backend container is memory-capped, and decoding a large
      // ND2 is the one routine job that approaches the cap. Say so, and say
      // where to confirm it, because the kernel log is the only place that
      // records it — the container itself just vanishes mid-write.
      if (signal) {
        const oomHint =
          signal === 'SIGKILL'
            ? ' — killed by the kernel, almost certainly the container running ' +
              'out of memory. Confirm with `journalctl -k | grep -i oom` on the ' +
              'host (look for constraint=CONSTRAINT_MEMCG naming this container) ' +
              'and raise the backend memory limit in docker-compose.production.yml ' +
              'if the file is legitimately that large.'
            : '';
        const killed: HelperExitError = new Error(
          `python helper ${scriptName} was killed by ${signal}${oomHint}` +
            (stderr.trim() ? ` Last stderr: ${stderr.slice(-500)}` : '')
        );
        killed.signal = signal;
        return reject(killed);
      }
      if (code !== 0) {
        // The code is attached, not just interpolated into the message: one
        // caller (drift correction) has to tell a clean decline from a helper
        // that failed AFTER modifying data, and parsing that back out of a
        // string would be a decision made on prose.
        const err: HelperExitError = new Error(
          `python helper ${scriptName} exited ${code}: ${stderr.slice(-500)}`
        );
        err.exitCode = code ?? undefined;
        return reject(err);
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

  // `irmIndex === -1` (no channel identifiable as IRM) leaves every channel
  // with isSegmentationSource=false, and that is deliberate — see the test of
  // the same name. It is now the NORMAL outcome for a multi-page TIFF, which
  // carries no wavelength and usually no meaningful channel names, where it
  // used to be impossible because isIrmChannel treated missing metadata as
  // evidence and typed the whole stack `irm`.
  //
  // Nothing breaks: every consumer already resolves the source as
  // `find(isSegmentationSource) ?? channels[0]` (videoUploadService,
  // imageService, ChannelSwitcher), so the first channel remains the effective
  // default. The difference is that the choice is no longer dressed up as a
  // positive identification, and the user can override it per batch via
  // SegmentChannelDialog.
  return raw.map((r, i) => {
    // A channel the acquisition only refreshed every N-th frame. `frameIds` /
    // `sparseFillFrameIds` cannot be filled in here — frame Image rows do not
    // exist until `videoUploadService.finalizeContainer` creates them — so the
    // index-space map travels alone and that function mirrors it into id space.
    const gaps = r.fillFrames;
    const sparse =
      gaps && Object.keys(gaps).length > 0
        ? { sparseSource: true as const, sparseFill: gaps }
        : {};
    return {
      name: r.name,
      displayName: r.displayName ?? undefined,
      type: isIrmChannel(r.name, r.wavelengthNm ?? undefined)
        ? 'irm'
        : 'fluorescent',
      wavelengthNm: r.wavelengthNm ?? undefined,
      displayColor: defaultColorForWavelength(r.wavelengthNm ?? undefined),
      isSegmentationSource: preferIrmSource && i === irmIndex,
      ...sparse,
    };
  });
}

export async function extractTiffStack(
  sourcePath: string,
  destDir: string,
  onProgress?: ProgressCallback,
  registerChannels = false
): Promise<ExtractionResult> {
  const result = await runHelper(
    'extract_tiff_stack.py',
    registerChannels
      ? [sourcePath, destDir, '--register-channels']
      : [sourcePath, destDir],
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
  onProgress?: ProgressCallback,
  registerChannels = false
): Promise<ExtractionOutcome> {
  const raw = await runHelper<PythonNd2Result>(
    'extract_nd2.py',
    registerChannels
      ? [sourcePath, destDir, '--register-channels']
      : [sourcePath, destDir],
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

/** One (moving → reference → out) alignment job for {@link alignChannelFrames}. */
export interface ChannelAlignJob {
  /** Absolute path of the added channel's raster for one frame (moved). */
  moving: string;
  /** Absolute path of that frame's segmentation-source PNG (reference). */
  reference: string;
  /** Absolute destination path for the aligned raster. */
  out: string;
}

/**
 * Result of a batch alignment run: per-job integer shift + confidence, plus
 * (since the helper started reporting it) the outcome reason and the raw
 * correlation peak — ``[dy, dx, confidence, reason, peakDy, peakDx]``.
 *
 * Typed as three numbers plus an unknown tail so a row from an OLDER helper,
 * which emits only the triple, still parses. ``AlignShiftRow`` in
 * ``addChannelService.ts`` is the consumer side of the same contract.
 */
export interface ChannelAlignResult {
  aligned: number;
  shifts: Array<[number, number, number, ...unknown[]]>;
}

/**
 * Phase-correlate each added-channel frame onto its reference (the target
 * frame's segmentation-source PNG) and write the losslessly-shifted result to
 * ``out``. Reuses the same registration math as upload-time channel
 * registration (``channel_registration.py``). The manifest is written to a
 * temp file and its path passed to the helper (avoids CLI-length limits for
 * hundreds of frames).
 */
export async function alignChannelFrames(
  manifestPath: string
): Promise<ChannelAlignResult> {
  return runHelper<ChannelAlignResult>('add_channel_align.py', [manifestPath]);
}

/** An `Error` from a helper that exited non-zero, carrying the exit code. */
export interface HelperExitError extends Error {
  exitCode?: number;
  /** Set instead of `exitCode` when the child was KILLED. A helper that dies
   *  this way never gets to report anything, so a caller that cares whether
   *  data was already modified must treat it as "possibly mid-write". */
  signal?: NodeJS.Signals;
}

/** `correct_drift.py` exited having ALREADY rewritten some frames. The stack is
 *  in mixed coordinate spaces and `registration.json` was never composed, so
 *  the container must not be kept — see `correctDriftForContainer`. */
export const EXIT_DRIFT_REWRITE_FAILED = 4;

/** Outcome of one container's drift-correction pass. `corrected: false` carries
 *  a `reason` saying which decline it was; the helper also says so on stderr,
 *  which `runHelper` surfaces at `warn`. */
export interface DriftCorrectionResult {
  corrected: boolean;
  /** WHY, when `corrected` is false: `still` | `unmatchable` | `unanchored` |
   *  `over_limit` | `too_short` | `estimation_failed`. The last one is a
   *  malfunction, not a data condition — without it a broken estimator and a
   *  stack that genuinely holds still are the same wire message, and drift
   *  correction could stop happening across production unnoticed. */
  reason?: string;
  /** Present with `estimation_failed`: the exception that ended the estimate. */
  error?: string;
  sourceChannel?: string;
  pairsMeasured?: number;
  pairsAccepted?: number;
  anchored?: boolean;
  maxApplied?: number;
}

/**
 * Remove stage drift from an already-extracted container, in place.
 *
 * Runs AFTER extraction rather than inside it because the estimate must be
 * driven by the channel the measurements live on — which `buildChannelMeta`
 * only resolves once the extractor has returned its channel list, and which
 * a fluorescence channel of a motility assay must never be (correlating that
 * measures filament gliding and calls it drift).
 *
 * That is an intent, not a guarantee: `resolveSegmentationSource` falls back to
 * channel 0 when nothing carries an IRM mark — the normal outcome for a plain
 * multi-page TIFF, which has no wavelength to type channels by — and channel 0
 * is TIRF on seven production containers. See `correct_drift.py`.
 *
 * Rewrites the frame PNGs with a rounded, lossless integer shift and folds the
 * correction into `registration.json`. Never throws for a stack it merely
 * cannot measure; it declines and says so.
 */
export async function correctDriftInContainer(
  containerDir: string,
  channelNames: string[],
  sourceChannel: string
): Promise<DriftCorrectionResult> {
  if (!channelNames.includes(sourceChannel)) {
    throw new Error(
      `drift correction: source channel '${sourceChannel}' is not among [${channelNames.join(', ')}]`
    );
  }
  const result = await runHelper<DriftCorrectionResult>('correct_drift.py', [
    containerDir,
    sourceChannel,
    channelNames.join(','),
  ]);
  logger.info('Drift correction finished', 'VideoExtractor', {
    containerDir,
    ...result,
  });
  return result;
}
