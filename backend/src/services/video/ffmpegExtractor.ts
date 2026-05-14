/**
 * MP4 / AVI / MOV / MKV / WebM frame extraction via the ffmpeg-static binary.
 *
 * For consumer videos (and most non-microscopy lab footage) we treat the
 * source as a single fluorescent-typed channel — the user can flip it to
 * IRM via the channels dialog if it's really a label-free recording.
 *
 * Microscopy-specific containers (multi-page TIFF, ND2) are handled by
 * Python helpers; ffmpeg is used only here for "regular" video.
 */

import { spawn } from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';
import ffmpegPath from 'ffmpeg-static';
import { logger } from '../../utils/logger';
import {
  ChannelMeta,
  ExtractionResult,
  ProgressCallback,
} from './types';

/**
 * Probe a video file via ``ffprobe`` (bundled with ffmpeg-static) to get
 * the frame count and duration without decoding the actual pixels.
 * Returns ``null`` if probing fails — the extractor will fall back to
 * counting frames after extraction.
 */
async function probeFrameCount(
  sourcePath: string
): Promise<{
  frameCount: number;
  durationMs: number;
  width: number;
  height: number;
} | null> {
  if (!ffmpegPath) return null;
  const ffprobeBinary = ffmpegPath.replace(/ffmpeg(\.exe)?$/i, 'ffprobe$1');

  return new Promise(resolve => {
    // -of json keeps named fields so we can't be tricked by ffprobe
    // versions that flip the CSV column order (some emit nb_read_packets
    // first, others width — observed across ffmpeg 4.x / 6.x).
    const args = [
      '-v',
      'error',
      '-select_streams',
      'v:0',
      '-count_packets',
      '-show_entries',
      'stream=nb_read_packets,width,height,duration',
      '-of',
      'json',
      sourcePath,
    ];
    let stdout = '';
    const child = spawn(ffprobeBinary, args);
    child.stdout.on('data', chunk => (stdout += chunk.toString()));
    child.on('error', () => resolve(null));
    child.on('close', code => {
      if (code !== 0) return resolve(null);
      try {
        const parsed = JSON.parse(stdout);
        const stream = parsed?.streams?.[0];
        if (!stream) return resolve(null);
        const width = parseInt(String(stream.width), 10);
        const height = parseInt(String(stream.height), 10);
        const durationS = parseFloat(String(stream.duration ?? 'NaN'));
        const frameCount = parseInt(String(stream.nb_read_packets), 10);
        if (
          !Number.isFinite(width) ||
          !Number.isFinite(height) ||
          !Number.isFinite(frameCount) ||
          frameCount <= 0
        ) {
          return resolve(null);
        }
        resolve({
          frameCount,
          durationMs: Number.isFinite(durationS)
            ? Math.round(durationS * 1000)
            : 0,
          width,
          height,
        });
      } catch {
        resolve(null);
      }
    });
  });
}

/**
 * Run ``ffmpeg -i <src> -vsync 0 -q:v 2 <dst>/0000/<channel>.png ...`` to
 * write each frame as a high-quality PNG. We spawn the binary directly
 * (no fluent-ffmpeg wrapper) to keep dependencies thin.
 *
 * On success the destination directory will contain
 * ``frames/0000/<channel>.png`` ... ``frames/NNNN/<channel>.png``.
 */
export async function extractWithFfmpeg(
  sourcePath: string,
  destDir: string,
  options: { channelName?: string; onProgress?: ProgressCallback } = {}
): Promise<ExtractionResult> {
  if (!ffmpegPath) {
    throw new Error(
      'ffmpeg-static binary path is not available — install ffmpeg-static.'
    );
  }
  const channelName = options.channelName ?? 'video';

  const probed = await probeFrameCount(sourcePath);
  const totalFrames = probed?.frameCount ?? -1;

  // ffmpeg can't easily write into per-frame subdirectories in one pass,
  // so we extract flat first then move into the per-frame layout.
  const flatDir = path.join(destDir, '_extract_flat');
  await fs.mkdir(flatDir, { recursive: true });

  let ffmpegStderr = '';
  await new Promise<void>((resolve, reject) => {
    const args = [
      '-hide_banner',
      '-loglevel', 'error',
      '-i', sourcePath,
      '-vsync', '0',
      '-q:v', '2',
      path.join(flatDir, '%06d.png'),
    ];
    const child = spawn(ffmpegPath as string, args);
    child.stderr.on('data', c => (ffmpegStderr += c.toString()));
    child.on('error', reject);
    child.on('close', code => {
      if (code !== 0) {
        return reject(new Error(`ffmpeg exited ${code}: ${ffmpegStderr.slice(-500)}`));
      }
      resolve();
    });
  });

  // ffmpeg can exit 0 while still warning on stderr (e.g. PTS broken,
  // codec partially unsupported). Surface non-empty stderr at warn level
  // so ops can see the partial-decode case before it becomes a user
  // complaint.
  if (ffmpegStderr.trim().length > 0) {
    logger.warn(
      `ffmpeg succeeded but emitted stderr: ${ffmpegStderr.slice(-500)}`,
      'VideoExtractor'
    );
  }

  // Move flat extraction into per-frame subdirectories matching the
  // channel-aware storage layout used by the rest of the pipeline.
  const flatFiles = (await fs.readdir(flatDir))
    .filter(f => f.endsWith('.png'))
    .sort();
  if (flatFiles.length === 0) {
    // ffmpeg succeeded but wrote no PNGs — most often a codec the build
    // doesn't support (rare with ffmpeg-static), broken PTS dropping all
    // frames at -vsync 0, or disk pressure on the temp dir. The stderr
    // tail usually carries the real signal.
    throw new Error(
      `ffmpeg produced no frames (rc=0). stderr tail: ${ffmpegStderr.slice(-500) || '(empty)'}`
    );
  }

  for (let i = 0; i < flatFiles.length; i++) {
    const frameDir = path.join(destDir, 'frames', String(i).padStart(4, '0'));
    await fs.mkdir(frameDir, { recursive: true });
    await fs.rename(
      path.join(flatDir, flatFiles[i]),
      path.join(frameDir, `${channelName}.png`)
    );
    if (options.onProgress && (i % 10 === 0 || i === flatFiles.length - 1)) {
      options.onProgress({
        progress: (i + 1) / flatFiles.length,
        currentFrame: i,
        totalFrames: flatFiles.length,
      });
    }
  }
  await fs.rmdir(flatDir).catch(() => {/* may be non-empty on rename failure */});

  const channels: ChannelMeta[] = [
    {
      name: channelName,
      type: 'fluorescent',
      isSegmentationSource: false,
    },
  ];

  logger.info('Video extracted via ffmpeg', 'VideoExtractor', {
    sourcePath,
    frames: flatFiles.length,
    width: probed?.width ?? null,
    height: probed?.height ?? null,
  });

  // For container-encoded video (mp4/avi/mov/...) we don't have any
  // physical calibration. The temporal cadence comes from FPS — if
  // ffprobe gave us a positive duration and ≥ 2 frames, we can derive
  // frame interval directly without a separate ffprobe pass for
  // r_frame_rate (which sometimes lies for VFR sources). Treat
  // durationMs <= 0 as missing rather than emitting a misleading 0 ms.
  const frameIntervalMs =
    probed?.durationMs != null &&
    probed.durationMs > 0 &&
    flatFiles.length > 1
      ? probed.durationMs / (flatFiles.length - 1)
      : null;

  return {
    frameCount: flatFiles.length,
    durationMs: probed?.durationMs ?? null,
    frameIntervalMs,
    pixelSizeUm: null,
    channels,
    width: probed?.width ?? 0,
    height: probed?.height ?? 0,
  };
}

/** Returns true if the given extension is handled by ffmpeg (not by the
 *  Python ND2 or multi-page TIFF helpers). */
export function isFfmpegFormat(ext: string): boolean {
  return ['.mp4', '.avi', '.mov', '.mkv', '.webm'].includes(ext.toLowerCase());
}
