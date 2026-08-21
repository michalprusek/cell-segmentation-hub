/**
 * Serving and building the 8-bit WebP playback proxies.
 *
 * The request path here is deliberately dumb: it answers "is there a proxy for
 * this frame?" and, when there is not, serves the original PNG and arranges for
 * the batch to run. It NEVER waits for an encode — one frame costs ~274 ms and
 * a container ~2.7 minutes, so blocking a frame request on it would replace a
 * slow playback with a stalled one.
 *
 * See `docs/superpowers/specs/2026-08-21-playback-proxy-design.md`.
 */

import { spawn } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import sharp from 'sharp';
import { prisma } from '../db/prismaClient';
import { logger } from '../utils/logger';
import { deriveRangeMax } from './playbackProxyRange';

const _MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const HELPERS_DIR = path.join(_MODULE_DIR, 'video', 'pythonHelpers');

/** Frames sampled to derive a channel's range. Three is enough BECAUSE the
 *  range is then rounded up to a power of two — see `deriveRangeMax` — and a
 *  frame that lands outside it anyway is served at full depth rather than
 *  clipped. */
const RANGE_SAMPLE_FRAMES = 3;

/**
 * Batches already running, keyed by container+channel.
 *
 * Without this, every frame request during the first pass would spawn its own
 * converter for the same channel: at ten requests a second that is dozens of
 * Python processes fighting over the same files on a host that also runs the ML
 * service. One batch per channel, and the rest of the pass is served the PNGs
 * it is already busy replacing.
 */
const running = new Set<string>();

/** Test seam: forget in-flight batches between suites. */
export function __resetRunningForTests(): void {
  running.clear();
}

/** The proxy that would stand in for this PNG. Pure path arithmetic. */
export function proxyPathForPng(pngAbsPath: string): string {
  return pngAbsPath.replace(/\.png$/i, '.webp');
}

export interface FrameRepresentation {
  path: string;
  contentType: string;
  isProxy: boolean;
}

/**
 * What to actually send for this frame.
 *
 * Falls back to the PNG for every reason there could be — not asked for, not
 * built yet, the frame was over range so the converter refused it. The caller
 * cannot tell those apart and does not need to: all three mean "send the
 * original", which is always correct and only ever slower.
 */
export async function resolveFrameRepresentation(
  pngAbsPath: string,
  wantProxy: boolean
): Promise<FrameRepresentation> {
  const png: FrameRepresentation = {
    path: pngAbsPath,
    contentType: 'image/png',
    isProxy: false,
  };
  if (!wantProxy) return png;

  const webp = proxyPathForPng(pngAbsPath);
  try {
    await fs.access(webp);
    return { path: webp, contentType: 'image/webp', isProxy: true };
  } catch {
    return png;
  }
}

/** Channel metadata as it is stored on the container row. */
interface StoredChannel {
  name: string;
  proxyRangeMax?: number;
  [key: string]: unknown;
}

/**
 * The value that maps to 255 for this channel, deriving and persisting it the
 * first time.
 *
 * `sharp.stats()` is used rather than a Python round-trip because it reports
 * TRUE 16-bit maxima — it is only sharp's pixel PIPELINE that narrows 16-bit to
 * 8-bit (a sample of 1566 reads back as 6), which is why the conversion itself
 * is Python's job and this is not.
 */
async function ensureRangeMax(
  containerId: string,
  channel: string,
  framesDir: string
): Promise<number | null> {
  const container = await prisma.image.findUnique({
    where: { id: containerId },
    select: { channels: true },
  });
  const channels = Array.isArray(container?.channels)
    ? (container.channels as unknown as StoredChannel[])
    : [];
  const meta = channels.find(c => c.name === channel);
  if (!meta) return null;
  if (typeof meta.proxyRangeMax === 'number') return meta.proxyRangeMax;

  let names: string[];
  try {
    names = (await fs.readdir(framesDir, { withFileTypes: true }))
      .filter(e => e.isDirectory())
      .map(e => e.name)
      .sort();
  } catch {
    return null;
  }
  if (names.length === 0) return null;

  // First, middle and last: a time-lapse drifts, so the ends and the centre
  // between them say more about the channel than any three neighbours would.
  const picks = [
    names[0],
    names[Math.floor(names.length / 2)],
    names[names.length - 1],
  ].slice(0, RANGE_SAMPLE_FRAMES);

  const maxima: number[] = [];
  for (const name of new Set(picks)) {
    const file = path.join(framesDir, name, `${channel}.png`);
    try {
      const stats = await sharp(file).stats();
      const peak = stats.channels[0]?.max;
      if (typeof peak === 'number') maxima.push(peak);
    } catch {
      // A frame this channel does not cover, or an unreadable one. Sampling
      // is best-effort; the power-of-two rounding absorbs a missed frame.
    }
  }
  if (maxima.length === 0) return null;

  const rangeMax = deriveRangeMax(maxima);
  const updated = channels.map(c =>
    c.name === channel ? { ...c, proxyRangeMax: rangeMax } : c
  );
  await prisma.image.update({
    where: { id: containerId },
    data: { channels: updated as unknown as object },
  });
  logger.info(
    `Playback proxy range for ${channel} of ${containerId}: ${rangeMax}`,
    'PlaybackProxy'
  );
  return rangeMax;
}

/**
 * Make sure this channel's proxies are being built. Returns immediately.
 *
 * Failures are logged and dropped on purpose: a container with no proxies plays
 * exactly as it did before this feature existed, so there is nothing here worth
 * failing a frame request over.
 */
export function ensureChannelProxies(
  containerId: string,
  channel: string,
  framesDir: string
): void {
  const key = `${containerId}::${channel}`;
  if (running.has(key)) return;
  running.add(key);

  void (async () => {
    try {
      const rangeMax = await ensureRangeMax(containerId, channel, framesDir);
      if (rangeMax === null) {
        logger.warn(
          `No playback proxy range for ${channel} of ${containerId}; skipping`,
          'PlaybackProxy'
        );
        return;
      }
      await runConverter(framesDir, channel, rangeMax);
    } catch (err) {
      logger.error(
        `Playback proxy batch failed for ${channel} of ${containerId}`,
        err as Error,
        'PlaybackProxy'
      );
    } finally {
      running.delete(key);
    }
  })();
}

function runConverter(
  framesDir: string,
  channel: string,
  rangeMax: number
): Promise<void> {
  const interpreter = process.env.PYTHON_BIN || 'python3';
  const script = path.join(HELPERS_DIR, 'make_playback_proxy.py');
  return new Promise<void>((resolve, reject) => {
    const child = spawn(interpreter, [
      script,
      '--frames-dir',
      framesDir,
      '--channel',
      channel,
      '--range-max',
      String(rangeMax),
    ]);
    let written = 0;
    let overRange = 0;
    let stderr = '';
    child.stdout.on('data', chunk => {
      for (const line of chunk.toString().split('\n')) {
        if (!line.trim()) continue;
        try {
          const row = JSON.parse(line) as { status?: string };
          if (row.status === 'written') written++;
          else if (row.status === 'over-range') overRange++;
        } catch {
          // Not our JSON — a warning from a library on stdout. Ignore.
        }
      }
    });
    child.stderr.on('data', c => (stderr += c.toString()));
    child.on('error', reject);
    child.on('close', code => {
      if (code !== 0) {
        reject(
          new Error(
            `make_playback_proxy exited ${code}: ${stderr.slice(-500)}`
          )
        );
        return;
      }
      logger.info(
        `Playback proxies for ${channel}: ${written} written` +
          (overRange > 0 ? `, ${overRange} left at full depth (over range)` : ''),
        'PlaybackProxy'
      );
      resolve();
    });
  });
}
