/**
 * LRU of DECODED frame samples, bounded by bytes.
 *
 * WHY BYTES AND NOT ENTRIES. One channel of a 1474x1412 16-bit frame is 4.0 MB
 * of samples. A count-based cache tuned on a small dataset would quietly turn
 * into a gigabyte on a large one, so the budget is the thing that matters and
 * the entry count follows from it.
 *
 * WHY IT EXISTS. The frame prefetcher already warms the HTTP cache, so the
 * compressed bytes are usually local — but nothing kept the DECODED result, so
 * every frame paid the full ~25 ms decode again, including stepping back to a
 * frame shown a second ago and replaying a clip. This holds the expensive half.
 *
 * NOT a correctness layer: entries are keyed by frame id AND channel, and the
 * server's frame PNGs are immutable for a given id, so a stale hit is not a
 * thing that can happen. Adding a channel writes new frames with new ids. The
 * one id that stands for several is a STATIC channel's anchor, and that is
 * sound for the same reason: those frames hold byte-identical copies, and the
 * registry refuses to collapse the aligned case where they do not.
 */

import type { DecodedGray } from './png16';
import { resolveFrameId } from './staticFrameChannels';

/** Floor for the budget, and what it stays at until a caller reserves more.
 *
 *  This number used to be the WHOLE story, sized as "~46 frames of a single
 *  4 MB channel, or ~23 two-channel frames — comfortably more than the
 *  5-back/10-ahead prefetch window". That reasoning was right for one or two
 *  channels and quietly wrong for three: a 1474x1412 16-bit frame is 3.97 MB
 *  per channel, so three channels are 11.9 MB, and the 16-frame window alone
 *  wants 190 MB of a 192 MB budget. The window then evicts itself. Every frame
 *  becomes a miss, the decoders and request slots fill with re-decoding what
 *  just fell out, and playback stops — while the frame counter, which is only
 *  an index and waits for nothing, keeps advancing. Reported from production as
 *  "the first 15 frames play, then it stalls".
 *
 *  So the budget is no longer a guess about frame sizes. `reserveFor` raises it
 *  to fit the working set the pipeline is actually asked to hold. */
const MIN_BUDGET_BYTES = 192 * 1024 * 1024;

/** Never grow past a share of the device's memory, whatever is reserved.
 *
 *  `navigator.deviceMemory` is coarse (and absent on Safari/Firefox, hence the
 *  conservative 4 GB assumption), but the point is only to keep a pathological
 *  reservation — a huge frame times many channels — from evicting the rest of
 *  the browser instead of itself. A quarter of reported RAM leaves room for the
 *  page, the GPU textures and everything else the tab is holding. */
function deviceCeilingBytes(): number {
  const gb =
    typeof navigator !== 'undefined' &&
    typeof (navigator as { deviceMemory?: number }).deviceMemory === 'number'
      ? (navigator as { deviceMemory?: number }).deviceMemory
      : 4;
  return Math.max(MIN_BUDGET_BYTES, Math.floor((gb ?? 4) * 1024 ** 3 * 0.25));
}

export function frameCacheKey(
  frameId: string,
  channel: string,
  /** The representation these samples came from. An 8-bit proxy decode and a
   *  16-bit decode of the same frame are DIFFERENT samples and must not share
   *  an entry — a window narrow enough to force full depth would otherwise be
   *  answered from the proxy that is already cached. */
  repr?: 'proxy'
): string {
  // A STATIC channel resolves every frame to one anchor, so 300 frames share a
  // single decoded entry instead of evicting each other with copies of one
  // picture. See `staticFrameChannels`.
  const base = `${resolveFrameId(frameId, channel)}::${channel}`;
  return repr === 'proxy' ? `${base}::proxy` : base;
}

export class DecodedFrameCache {
  /** Insertion order IS the LRU order: a hit deletes and re-inserts. */
  private readonly entries = new Map<string, DecodedGray>();
  private bytes = 0;

  private budgetBytes: number;

  constructor(budgetBytes: number = MIN_BUDGET_BYTES) {
    this.budgetBytes = budgetBytes;
  }

  /** Current budget in bytes. */
  get budget(): number {
    return this.budgetBytes;
  }

  /**
   * Grow the budget so `entries` items of `entryBytes` all stay resident.
   *
   * Callers know the working set the cache is about to be asked for — the
   * prefetch window times the channel count — and the cache cannot guess it:
   * from in here, one 12 MB three-channel frame and three 4 MB single-channel
   * frames look the same. The only caller counts the decode-ahead frames and
   * the displayed one explicitly, so the 25% margin is slack on top of an
   * already-complete count rather than a stand-in for them.
   *
   * Only ever grows. Shrinking on a channel being hidden would throw away
   * frames that are about to be wanted again the moment it is shown.
   */
  reserveFor(entryBytes: number, entries: number): void {
    if (!Number.isFinite(entryBytes) || !Number.isFinite(entries)) return;
    if (entryBytes <= 0 || entries <= 0) return;
    const needed = Math.ceil(entryBytes * entries * 1.25);
    const target = Math.min(
      Math.max(needed, MIN_BUDGET_BYTES),
      deviceCeilingBytes()
    );
    if (target > this.budgetBytes) this.budgetBytes = target;
  }

  get size(): number {
    return this.entries.size;
  }

  get byteSize(): number {
    return this.bytes;
  }

  /**
   * Is `key` resident? Deliberately does NOT touch the LRU order, unlike
   * {@link get}.
   *
   * The playback buffer probe asks this about every frame of its lookahead on
   * every stalled tick. Answering with `get` would keep re-promoting frames the
   * probe merely looked at to the young end, so the frames it is waiting FOR
   * would evict ahead of the ones it has already passed.
   */
  has(key: string): boolean {
    return this.entries.has(key);
  }

  get(key: string): DecodedGray | undefined {
    const hit = this.entries.get(key);
    if (!hit) return undefined;
    // Re-insert to move it to the young end.
    this.entries.delete(key);
    this.entries.set(key, hit);
    return hit;
  }

  set(key: string, value: DecodedGray): void {
    const size = value.data.byteLength;
    // A single frame larger than the whole budget would evict everything and
    // then not fit; refuse it rather than emptying the cache for nothing.
    if (size > this.budgetBytes) return;

    const existing = this.entries.get(key);
    if (existing) {
      this.bytes -= existing.data.byteLength;
      this.entries.delete(key);
    }
    this.entries.set(key, value);
    this.bytes += size;

    // Evict from the old end until we are back inside the budget.
    for (const oldest of this.entries.keys()) {
      if (this.bytes <= this.budgetBytes) break;
      const victim = this.entries.get(oldest);
      if (!victim || oldest === key) break; // never evict what we just stored
      this.bytes -= victim.data.byteLength;
      this.entries.delete(oldest);
    }
  }

  clear(): void {
    this.entries.clear();
    this.bytes = 0;
  }
}

/**
 * In-flight decodes, keyed the same way as the cache.
 *
 * Two callers race for the same frame in the ordinary case: decode-ahead is
 * working on frame N+1 when the playhead reaches it, so the canvas looks in the
 * cache, misses (the decode has not finished), and starts a second one. Both
 * then decode 4 MB of the same samples and one result is thrown away — worse
 * than wasteful, since the duplicate occupies a worker the NEXT frame needs.
 *
 * De-duplicating here rather than in either caller is what makes it work: they
 * do not know about each other, and the cache key is the only thing they share.
 */
const inFlight = new Map<string, Promise<DecodedGray | null>>();

/**
 * Return the cached samples, join an in-flight decode, or start one — in that
 * order. `produce` is only called when this is the first request for `key`.
 */
export function getOrDecode(
  key: string,
  produce: () => Promise<DecodedGray | null>
): Promise<DecodedGray | null> {
  const cached = decodedFrameCache.get(key);
  if (cached) return Promise.resolve(cached);

  const running = inFlight.get(key);
  if (running) return running;

  const started = produce()
    .then(result => {
      if (result) decodedFrameCache.set(key, result);
      return result;
    })
    .finally(() => {
      inFlight.delete(key);
    });
  inFlight.set(key, started);
  return started;
}

/** Test seam: forget any in-flight work so suites do not join each other's. */
export function __resetInFlightForTests(): void {
  inFlight.clear();
}

/** Shared instance — the editor shows one video at a time, and a per-component
 *  cache would throw the decoded frames away on every remount (which is what a
 *  render-path flip does). */
export const decodedFrameCache = new DecodedFrameCache();
