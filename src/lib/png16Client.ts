/**
 * Pooled, off-main-thread front end for `decodeGrayPng`.
 *
 * THE PROBLEM. Decoding one 1474x1412 16-bit channel costs ~15 ms of native
 * inflate plus ~10 ms of synchronous JavaScript un-filtering. With two visible
 * channels that is ~20 ms of blocked main thread per displayed frame, and
 * during playback the editor froze: the server log shows the client firing a
 * burst of frame requests and then going silent, because the thread that would
 * issue the next request was busy un-filtering the last one.
 *
 * TWO WINS, not one. Moving the work to a worker stops it blocking the UI; a
 * POOL also lets the channels of a frame decode concurrently, so the wall-clock
 * cost of a two-channel frame is one channel's, not two.
 *
 * Blobs cross to the worker by reference and the finished sample buffer comes
 * back by TRANSFER, so neither the 2 MB compressed input nor the 4 MB output is
 * ever copied.
 *
 * DEGRADES, NEVER FAILS. No Worker support, a construction throw, a worker that
 * dies — each falls back to decoding on the main thread, which is exactly what
 * the code did before. jsdom has no Worker, so tests take the fallback.
 */

import { decodeGrayPng, type DecodedGray } from './png16';
import type { DecodeRequest, DecodeResponse } from './png16Protocol';
import { logger } from '@/lib/logger';
import { decodeWebpGray, canDecodeWebpGray } from './webpGray';

/** Upper bound on workers. Two visible channels is the common case and the
 *  reason the pool exists at all; beyond four the decode is no longer the
 *  bottleneck and the memory of several in-flight 4 MB buffers is. */
const MAX_WORKERS = 4;

interface Pending {
  resolve: (value: DecodedGray | null) => void;
  reject: (reason: unknown) => void;
}

interface PoolWorker {
  worker: Worker;
  /** Requests dispatched to this worker and not yet answered. Dispatch picks
   *  the smallest, so a slow frame does not queue behind a slower one. */
  inFlight: number;
}

/**
 * How a worker is built. Injectable ONLY because the real expression cannot run
 * under test: `new URL('./png16.worker.ts', import.meta.url)` throws
 * "'toString' called on an object that is not a valid instance of Location" in
 * jsdom, so without a seam the suite could exercise nothing but the fallback —
 * and the dispatch, pooling and failure handling below are the parts worth
 * pinning. Production never touches the setter.
 */
let workerFactory: () => Worker = () =>
  new Worker(new URL('./png16.worker.ts', import.meta.url), {
    type: 'module',
  });

let pool: PoolWorker[] | null = null;
let poolDisabled = false;
let nextId = 0;
const pending = new Map<number, Pending>();

function desiredSize(): number {
  const cores =
    typeof navigator !== 'undefined' && navigator.hardwareConcurrency
      ? navigator.hardwareConcurrency
      : 2;
  // Leave a core for the main thread; never fewer than two, or the channels of
  // one frame serialise and the pool buys nothing.
  return Math.max(2, Math.min(MAX_WORKERS, cores - 1));
}

/** Tear the pool down and route everything to the main thread from here on.
 *  Pending requests are rejected so their callers can retry inline. */
function disablePool(reason: string, err?: unknown): void {
  logger.warn(`png16Client: decoding on the main thread — ${reason}`, err);
  poolDisabled = true;
  for (const p of pool ?? []) {
    try {
      p.worker.terminate();
    } catch {
      /* already gone */
    }
  }
  pool = null;
  const stranded = [...pending.values()];
  pending.clear();
  for (const p of stranded) p.reject(new Error(reason));
}

function ensurePool(): PoolWorker[] | null {
  if (poolDisabled) return null;
  if (pool) return pool;
  if (typeof Worker === 'undefined') {
    poolDisabled = true; // no log: this is jsdom and every test would shout
    return null;
  }
  try {
    const created: PoolWorker[] = [];
    for (let i = 0; i < desiredSize(); i++) {
      const worker = workerFactory();
      worker.onmessage = (event: MessageEvent<DecodeResponse>) => {
        const msg = event.data;
        const entry = pending.get(msg.id);
        if (!entry) return;
        pending.delete(msg.id);
        const slot = created.find(c => c.worker === worker);
        if (slot) slot.inFlight = Math.max(0, slot.inFlight - 1);
        if (!msg.ok) {
          // `unsupported` is the decoder's ordinary "not a grayscale 8/16-bit
          // PNG" answer, and null is what the caller already handles.
          entry.resolve(null);
          return;
        }
        entry.resolve({
          width: msg.width,
          height: msg.height,
          bitDepth: msg.bitDepth,
          min: msg.min,
          max: msg.max,
          data: msg.is16
            ? new Uint16Array(msg.buffer)
            : new Uint8Array(msg.buffer),
        });
      };
      worker.onerror = err => disablePool('a decode worker errored', err);
      created.push({ worker, inFlight: 0 });
    }
    pool = created;
    return pool;
  } catch (err) {
    disablePool('could not start the decode workers', err);
    return null;
  }
}

/**
 * Decode a grayscale PNG off the main thread when possible.
 *
 * Same contract as `decodeGrayPng`: resolves to null for anything outside the
 * narrow grayscale 8/16-bit scope, never throws.
 */
export async function decodeGrayPngPooled(
  blob: Blob,
  /** For a WebP playback proxy: the value its 255 stands for, taken from the
   *  response's `X-Proxy-Range`. Per FRAME, so it has to come from the caller
   *  that saw the response — a container-wide lookup would be wrong for any
   *  frame whose own maximum differs, which is most of them. */
  proxyRangeMax: number | null = null
): Promise<DecodedGray | null> {
  // A playback proxy is an 8-bit WebP, and the browser's own decoder handles
  // it natively — faster than this pool's JS inflate, and without occupying a
  // worker the next 16-bit frame needs. Routed here rather than in the two
  // callers so the canvas and the decode-ahead walk both inherit it.
  if (blob.type === 'image/webp') {
    // Never falls through to the PNG path. That path does not fail loudly on
    // WebP bytes — `decodeGrayPng` returns null by contract — and the canvas's
    // null-handler is an 8-bit decoder that would hand the compositor raw
    // 0..255 proxy samples as if they were data units. Returning null here
    // means the frame does not draw, which is visible and honest.
    if (!canDecodeWebpGray()) {
      logger.warn(
        'decodeGrayPngPooled: this browser cannot decode a playback proxy'
      );
      return null;
    }
    if (proxyRangeMax === null) {
      logger.warn('decodeGrayPngPooled: proxy arrived without X-Proxy-Range');
      return null;
    }
    try {
      return await decodeWebpGray(blob, proxyRangeMax);
    } catch (err) {
      logger.warn('decodeGrayPngPooled: WebP decode failed', err);
      return null;
    }
  }
  const workers = ensurePool();
  if (!workers || workers.length === 0) return decodeGrayPng(blob);

  const slot = workers.reduce((a, b) => (b.inFlight < a.inFlight ? b : a));
  const id = ++nextId;
  slot.inFlight++;

  try {
    return await new Promise<DecodedGray | null>((resolve, reject) => {
      pending.set(id, { resolve, reject });
      const request: DecodeRequest = { id, blob };
      slot.worker.postMessage(request);
    });
  } catch (err) {
    // The pool died mid-flight. Do the work inline rather than failing the
    // frame — the caller cannot tell the difference except in timing.
    logger.warn('png16Client: retrying a decode on the main thread', err);
    return decodeGrayPng(blob);
  }
}

/** Test seam: override how workers are built. Pass null to restore the real one. */
export function __setDecodeWorkerFactoryForTests(
  factory: (() => Worker) | null
): void {
  workerFactory =
    factory ??
    (() =>
      new Worker(new URL('./png16.worker.ts', import.meta.url), {
        type: 'module',
      }));
}

/** Test seam: drop the pool so the next call re-evaluates the environment. */
export function __resetDecodePoolForTests(): void {
  for (const p of pool ?? []) p.worker.terminate();
  pool = null;
  poolDisabled = false;
  pending.clear();
}
