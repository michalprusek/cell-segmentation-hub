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

/** Frames sampled to seed the container's banding-guard range. Three is enough
 *  because `runConverter` widens the stored figure afterwards from the ranges
 *  the frames were actually encoded against. */
const RANGE_SAMPLE_FRAMES = 3;

/**
 * How long before a container+channel whose last attempt got nowhere is tried
 * again.
 *
 * Without it, a container whose range cannot be derived — or whose converter
 * cannot start, say `python3` missing from the image — is retried on EVERY
 * frame request. At 10 fps across two channels that is ~20 database reads,
 * ~20 directory listings and ~20 log lines a second for as long as someone
 * keeps playing, on a host shared with the ML service. The condition does not
 * change on its own, so retrying at request rate can only ever be noise.
 */
const RETRY_AFTER_MS = 10 * 60 * 1000;

/**
 * Attempts in flight, and when each key last failed.
 *
 * `inFlight` stops ten frame requests a second from spawning ten converters
 * over the same files. `lastFailedAt` stops a permanently broken container from
 * being retried at that same rate. Both are per PROCESS: a second backend
 * replica keeps its own, so "one batch per channel" means one per channel per
 * process — tolerable because the converter skips frames that already have a
 * proxy, so a duplicate batch is wasted work rather than a wrong result.
 */
const inFlight = new Set<string>();
const lastFailedAt = new Map<string, number>();

/** Test seam: forget in-flight attempts and cooldowns between suites. */
export function __resetRunningForTests(): void {
  inFlight.clear();
  lastFailedAt.clear();
}

/**
 * The range encoded in a proxy's file name, or null if this is not one.
 *
 * The converter names each frame's proxy `<channel>.p<range>.webp` — per frame,
 * because one channel's maxima ran 1950..8984 on the measured container and a
 * range fixed across the channel would leave its dimmest frame 30 of the 256
 * levels. Carrying the number in the name means the server can answer with it
 * without opening the file or keeping a side table that could fall out of step.
 */
export function proxyRangeFromName(
  fileName: string,
  channel: string
): number | null {
  const prefix = `${channel}.p`;
  if (!fileName.startsWith(prefix) || !fileName.endsWith('.webp')) {
    return null;
  }
  const digits = fileName.slice(prefix.length, -'.webp'.length);
  // Digits only: `488_nm.p2047.webp` yes, `488_nm.pXX.webp` no, and — the case
  // that matters — `488_nm_extra.p2047.webp` never matches channel `488_nm`,
  // because the prefix check already required the dot straight after the name.
  // Channel names ban dots (`CHANNEL_NAME_RE`), so that dot is unambiguous.
  if (!/^\d+$/.test(digits)) {
    return null;
  }
  const value = Number(digits);
  return Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * What to send for this frame.
 *
 * A discriminated union rather than `rangeMax: number | null` beside an
 * `isProxy: boolean`, because the combination that shape allowed — a proxy with
 * no range — is not merely untidy. It is the 256x-too-dark bug: the controller
 * would send a WebP body with no `X-Proxy-Range`, and the client would treat
 * 0..255 samples as if they were already in the data's units. There is now no
 * way to construct that state.
 */
export type FrameRepresentation =
  | { kind: 'png'; path: string; contentType: 'image/png' }
  | {
      kind: 'proxy';
      path: string;
      contentType: 'image/webp';
      /** The value this proxy's 255 stands for. Travels to the client, which
       *  multiplies it back out at decode. */
      rangeMax: number;
    };

/**
 * Resolve the frame to the representation the caller asked for.
 *
 * Falls back to the PNG for both reasons there are — not asked for, and not
 * built yet. The caller cannot tell them apart and does not need to: both mean
 * "send the original", which is always correct and only ever slower.
 */
export async function resolveFrameRepresentation(
  pngAbsPath: string,
  wantProxy: boolean
): Promise<FrameRepresentation> {
  const png: FrameRepresentation = {
    kind: 'png',
    path: pngAbsPath,
    contentType: 'image/png',
  };
  if (!wantProxy) {
    return png;
  }

  const dir = path.dirname(pngAbsPath);
  const channel = path.basename(pngAbsPath).replace(/\.png$/i, '');
  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch {
    return png;
  }
  // A frame directory holds one file per channel plus their proxies — a
  // handful of entries — so listing it costs about what stat-ing one would.
  for (const name of names) {
    const rangeMax = proxyRangeFromName(name, channel);
    if (rangeMax !== null) {
      return {
        kind: 'proxy',
        path: path.join(dir, name),
        contentType: 'image/webp',
        rangeMax,
      };
    }
  }
  return png;
}

/** Channel metadata as it is stored on the container row. */
interface StoredChannel {
  name: string;
  proxyRangeMax?: number;
  [key: string]: unknown;
}

/**
 * Seed the container-wide range the CLIENT needs, once.
 *
 * NOT the value that maps to 255 — that is per frame, chosen by the converter
 * from the frame's own peak and delivered in `X-Proxy-Range`. This single
 * number has one job: the client's banding guard needs a figure to judge
 * against before it has seen any frame of a container.
 *
 * Taken across EVERY channel and rounded up, and widened afterwards by
 * `runConverter` from the ranges frames were actually encoded against, so it
 * ends up an upper bound rather than a three-frame guess.
 *
 * `sharp.stats()` reports TRUE 16-bit maxima — it is only sharp's pixel
 * PIPELINE that narrows 16-bit to 8-bit (a sample of 1566 reads back as 6),
 * which is why the conversion itself is Python's job and this is not.
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
  if (!meta) {
    return null;
  }
  if (typeof meta.proxyRangeMax === 'number') {
    return meta.proxyRangeMax;
  }

  let names: string[];
  try {
    names = (await fs.readdir(framesDir, { withFileTypes: true }))
      .filter(e => e.isDirectory())
      .map(e => e.name)
      .sort();
  } catch {
    return null;
  }
  if (names.length === 0) {
    return null;
  }

  // First, middle and last: a time-lapse drifts, so the ends and the centre
  // between them say more about it than any three neighbours would.
  const picks = [
    names[0],
    names[Math.floor(names.length / 2)],
    names[names.length - 1],
  ].slice(0, RANGE_SAMPLE_FRAMES);

  // Every channel, not just the one being requested: one window is applied to
  // all of them, so the guard has to know about the brightest.
  const maxima: number[] = [];
  for (const name of new Set(picks)) {
    for (const c of channels) {
      const file = path.join(framesDir, name, `${c.name}.png`);
      try {
        const stats = await sharp(file).stats();
        const peak = stats.channels[0]?.max;
        if (typeof peak === 'number') {
          maxima.push(peak);
        }
      } catch {
        // A frame this channel does not cover, or an unreadable one. Sampling
        // is best-effort, and `runConverter` widens the result if it was low.
      }
    }
  }
  if (maxima.length === 0) {
    return null;
  }

  const rangeMax = deriveRangeMax(maxima);
  await storeRangeMax(containerId, rangeMax);
  logger.info(
    `Playback proxy range for ${containerId}: ${rangeMax} (from ${maxima.length} samples across ${channels.length} channels)`,
    'PlaybackProxy'
  );
  return rangeMax;
}

/** Write the container-wide range onto every channel, never lowering it. */
async function storeRangeMax(
  containerId: string,
  rangeMax: number
): Promise<void> {
  const container = await prisma.image.findUnique({
    where: { id: containerId },
    select: { channels: true },
  });
  const channels = Array.isArray(container?.channels)
    ? (container.channels as unknown as StoredChannel[])
    : [];
  if (channels.length === 0) {
    return;
  }
  const updated = channels.map(c => ({
    ...c,
    proxyRangeMax: Math.max(rangeMax, c.proxyRangeMax ?? 0),
  }));
  await prisma.image.update({
    where: { id: containerId },
    data: { channels: updated as unknown as object },
  });
}

export interface EnsureProxySupportOptions {
  /** Build the proxies as well as seeding the range. False for a request that
   *  did not ask for one — seeding is cheap enough to do for any multi-channel
   *  frame, converting is minutes of CPU for a viewer who may never press
   *  play. */
  convert: boolean;
}

/**
 * Seed what the client needs in order to ask for proxies, and optionally build
 * them. Returns immediately; the work runs on a detached promise.
 *
 * WHY THE SEEDING RUNS EVEN WHEN NO PROXY WAS ASKED FOR. These used to be one
 * step, and that made the feature unable to start. The client asks for a proxy
 * only once `proxyRangeMax` is stored, and `proxyRangeMax` was stored only when
 * a proxy was asked for — a closed loop. Every container except the one whose
 * range happened to be written by an earlier iteration of the design sat at
 * full depth forever, and no log line could report it because the call that
 * would have logged was never reached. Seeding is three `sharp.stats()` calls
 * and one row update; doing it for any multi-channel frame request is what
 * breaks the cycle.
 *
 * Failures are logged and dropped: a container with no proxies plays exactly as
 * it did before this feature existed.
 */
export function ensureProxySupport(
  containerId: string,
  channel: string,
  framesDir: string,
  { convert }: EnsureProxySupportOptions
): void {
  const key = `${containerId}::${channel}`;
  if (inFlight.has(key)) {
    return;
  }
  const failedAt = lastFailedAt.get(key);
  if (failedAt !== undefined && Date.now() - failedAt < RETRY_AFTER_MS) {
    return;
  }
  inFlight.add(key);

  void (async (): Promise<void> => {
    let failed = false;
    try {
      const rangeMax = await ensureRangeMax(containerId, channel, framesDir);
      if (rangeMax === null) {
        failed = true;
        logger.warn(
          `No playback proxy range for ${channel} of ${containerId}; the editor cannot use proxies for it`,
          'PlaybackProxy'
        );
        return;
      }
      if (convert) {
        await runConverter(containerId, framesDir, channel);
      }
    } catch (err) {
      failed = true;
      logger.error(
        `Playback proxy work failed for ${channel} of ${containerId}`,
        err as Error,
        'PlaybackProxy'
      );
    } finally {
      if (failed) {
        lastFailedAt.set(key, Date.now());
      } else {
        lastFailedAt.delete(key);
      }
      inFlight.delete(key);
    }
  })();
}

/** One frame's line of converter output. */
interface ConverterLine {
  frame?: string;
  status?: string;
  rangeMax?: number;
  message?: string;
}

function runConverter(
  containerId: string,
  framesDir: string,
  channel: string
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
    ]);
    let written = 0;
    let skipped = 0;
    // Every status the converter can emit is counted. An uncounted one used to
    // fall out of every branch, so a batch that failed sixty frames still
    // logged "240 written" and read as success.
    const errors: string[] = [];
    // Each frame is encoded against its own peak, so a frame can legitimately
    // have been given more range than the three-frame sample found. Widening
    // afterwards is what makes the client's banding guard an upper bound
    // rather than usually-an-upper-bound.
    let widest = 0;
    let stderr = '';
    child.stdout.on('data', chunk => {
      for (const line of chunk.toString().split('\n')) {
        if (!line.trim()) {
          continue;
        }
        let row: ConverterLine;
        try {
          row = JSON.parse(line) as ConverterLine;
        } catch {
          continue; // Not our JSON — a library warning on stdout.
        }
        if (row.status === 'written') {
          written++;
          if (typeof row.rangeMax === 'number' && row.rangeMax > widest) {
            widest = row.rangeMax;
          }
        } else if (row.status === 'skipped-exists') {
          skipped++;
        } else if (row.status === 'error') {
          errors.push(`${row.frame ?? '?'}: ${row.message ?? 'unknown'}`);
        }
      }
    });
    child.stderr.on('data', c => (stderr += c.toString()));
    child.on('error', reject);
    child.on('close', code => {
      if (code !== 0) {
        reject(
          new Error(`make_playback_proxy exited ${code}: ${stderr.slice(-500)}`)
        );
        return;
      }
      logger.info(
        `Playback proxies for ${channel} of ${containerId}: ${written} written, ${skipped} already present, ${errors.length} failed`,
        'PlaybackProxy'
      );
      if (errors.length > 0) {
        // The script reports per-frame failures and still exits 0, so this is
        // the only place they can surface. Those frames stay at full depth.
        logger.error(
          `Playback proxy: ${errors.length} frame(s) of ${channel} failed to convert`,
          new Error(errors.slice(0, 5).join(' | ')),
          'PlaybackProxy'
        );
      }
      if (widest > 0) {
        void storeRangeMax(containerId, widest).catch(err =>
          logger.error(
            `Playback proxy: could not widen the range for ${containerId}`,
            err as Error,
            'PlaybackProxy'
          )
        );
      }
      resolve();
    });
  });
}
