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
 * thing that can happen. Adding a channel writes new frames with new ids.
 */

import type { DecodedGray } from './png16';

/** ~46 frames of a single 4 MB channel, or ~23 two-channel frames — comfortably
 *  more than the 5-back/10-ahead prefetch window, so a normal playback pass
 *  never evicts something it is about to want again. */
const DEFAULT_BUDGET_BYTES = 192 * 1024 * 1024;

export function frameCacheKey(frameId: string, channel: string): string {
  return `${frameId}::${channel}`;
}

export class DecodedFrameCache {
  /** Insertion order IS the LRU order: a hit deletes and re-inserts. */
  private readonly entries = new Map<string, DecodedGray>();
  private bytes = 0;

  constructor(private readonly budgetBytes = DEFAULT_BUDGET_BYTES) {}

  get size(): number {
    return this.entries.size;
  }

  get byteSize(): number {
    return this.bytes;
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

/** Shared instance — the editor shows one video at a time, and a per-component
 *  cache would throw the decoded frames away on every remount (which is what a
 *  render-path flip does). */
export const decodedFrameCache = new DecodedFrameCache();
