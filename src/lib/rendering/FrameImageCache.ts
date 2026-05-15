/**
 * URL-keyed LRU cache of warm HTMLImageElement instances for video
 * frames in the segmentation editor.
 *
 * Backs sliding-window prefetch around the current frame index so
 * scrubbing the slider or playing the timeline reads from RAM instead
 * of hitting the network. The `<img>` swap in CanvasImage /
 * MultiChannelCanvas can mount the cached element directly and skip
 * the HTTP roundtrip.
 *
 * Modeled on BoundingBoxCache (Map insertion-order LRU + hit/miss
 * stats). Key is the canonical frame URL — channel + frameId already
 * collapse into that, so a flat string keeps the API simple.
 */
const DEFAULT_MAX_ENTRIES = 200;
/** Backoff schedule for transient prefetch failures (e.g. nginx
 *  rate-limit 503 during initial mount burst). Total worst-case
 *  recovery is ~2.1 s for the entry to settle into either loaded
 *  or permanently errored. The prefetch hook tracks URLs by ref so
 *  the cache MUST self-heal here — the hook will never re-fire. */
const RETRY_DELAYS_MS = [300, 600, 1200] as const;

interface CacheEntry {
  image: HTMLImageElement;
  /** Resolves once the image fully loads. Lets prefetchers `await`
   *  the warm-up so a Play button can gate on "X frames ready". */
  ready: Promise<HTMLImageElement>;
  /** Mirrors `image.complete && image.naturalWidth > 0`, but cheap
   *  to check without touching the DOM property each call. */
  loaded: boolean;
  /** True once load fails for good (initial attempt + all retries
   *  exhausted). The cache keeps the entry so repeated prefetch
   *  calls don't spam new Image() — the next real consumer can
   *  decide whether to retry. */
  errored: boolean;
  /** How many retry attempts have been used so far. The first
   *  `RETRY_DELAYS_MS.length` errors are transparently retried
   *  before flipping `errored = true`. */
  retriesUsed: number;
}

export class FrameImageCache {
  private readonly entries = new Map<string, CacheEntry>();
  private hits = 0;
  private misses = 0;

  constructor(private readonly maxEntries: number = DEFAULT_MAX_ENTRIES) {
    if (!Number.isFinite(maxEntries) || maxEntries < 1) {
      throw new Error(
        `FrameImageCache: maxEntries must be a finite number >= 1 (got ${maxEntries})`
      );
    }
  }

  has(url: string): boolean {
    return this.entries.has(url);
  }

  /** True only when the image element has loaded successfully and is
   *  safe to swap into an `<img>` or `drawImage` source. */
  isReady(url: string): boolean {
    const entry = this.entries.get(url);
    return !!entry && entry.loaded && !entry.errored;
  }

  /** Returns the warm image element if present, promoting it to MRU.
   *  Use `isReady(url)` first if you need to know whether the element
   *  has finished loading. */
  get(url: string): HTMLImageElement | undefined {
    const entry = this.entries.get(url);
    if (!entry) {
      this.misses++;
      return undefined;
    }
    this.hits++;
    // Promote to most-recently-used.
    this.entries.delete(url);
    this.entries.set(url, entry);
    return entry.image;
  }

  /** Kick off a load for `url` if not already cached and return the
   *  ready-promise. Idempotent: existing entries return their stored
   *  promise unchanged so concurrent prefetch calls dedupe. */
  prefetch(url: string): Promise<HTMLImageElement> {
    const existing = this.entries.get(url);
    if (existing) {
      // Promote and reuse.
      this.entries.delete(url);
      this.entries.set(url, existing);
      return existing.ready;
    }

    this.misses++;
    const image = new Image();
    // `decoding="async"` lets the browser decode off the main thread
    // when the element is later mounted, smoothing the swap.
    image.decoding = 'async';
    image.loading = 'eager';
    const entry: CacheEntry = {
      image,
      loaded: false,
      errored: false,
      retriesUsed: 0,
      ready: new Promise<HTMLImageElement>((resolve, reject) => {
        image.onload = () => {
          entry.loaded = true;
          resolve(image);
        };
        image.onerror = () => {
          // Transient failure (typically rate-limit 503 during the
          // initial prefetch burst, or a flaky upstream). Retry with
          // exponential backoff before marking the entry errored.
          if (entry.retriesUsed < RETRY_DELAYS_MS.length) {
            const delay = RETRY_DELAYS_MS[entry.retriesUsed];
            entry.retriesUsed++;
            window.setTimeout(() => {
              // The entry may have been aborted/evicted while we slept;
              // never re-fire a load against a stale element.
              if (this.entries.get(url) !== entry) return;
              // Setting src='' then re-assigning the same URL forces
              // the browser to retrigger the request; assigning the
              // same value without the reset would be a no-op.
              entry.image.src = '';
              entry.image.src = url;
            }, delay);
            return;
          }
          entry.errored = true;
          reject(
            new Error(
              `FrameImageCache: failed to load ${url} after ${RETRY_DELAYS_MS.length} retries`
            )
          );
        };
      }),
    };
    // Swallow unhandled rejections — consumers that care `await`
    // the promise; consumers that just warm the cache don't.
    entry.ready.catch(() => {});
    image.src = url;
    this.entries.set(url, entry);
    this.evictIfOverflow();
    return entry.ready;
  }

  /** Abort an in-flight load by clearing the element's src. Used by
   *  prefetch hooks during cleanup so a fast scrub doesn't keep N
   *  zombie HTTP connections open. */
  abort(url: string): void {
    const entry = this.entries.get(url);
    if (!entry || entry.loaded || entry.errored) return;
    // Setting src='' is the documented way to cancel a pending HTTP
    // request issued by `new Image()`. We drop the entry so the next
    // prefetch starts fresh.
    entry.image.src = '';
    this.entries.delete(url);
  }

  invalidate(url: string): void {
    this.entries.delete(url);
  }

  clear(): void {
    for (const entry of this.entries.values()) {
      if (!entry.loaded && !entry.errored) {
        entry.image.src = '';
      }
    }
    this.entries.clear();
    this.hits = 0;
    this.misses = 0;
  }

  getStats() {
    const total = this.hits + this.misses;
    let readyCount = 0;
    let pendingCount = 0;
    for (const entry of this.entries.values()) {
      if (entry.loaded) readyCount++;
      else if (!entry.errored) pendingCount++;
    }
    return {
      size: this.entries.size,
      ready: readyCount,
      pending: pendingCount,
      hits: this.hits,
      misses: this.misses,
      hitRate: total === 0 ? 0 : this.hits / total,
    };
  }

  /** How many of the given URLs are loaded and ready right now.
   *  Used by the play-gate to decide whether the buffer is warm
   *  enough to start playback. */
  readyCount(urls: readonly string[]): number {
    let count = 0;
    for (const url of urls) {
      if (this.isReady(url)) count++;
    }
    return count;
  }

  private evictIfOverflow(): void {
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      const url = oldest.value;
      const entry = this.entries.get(url);
      if (entry && !entry.loaded && !entry.errored) {
        // Cancel in-flight before evicting so we don't leak connections.
        entry.image.src = '';
      }
      this.entries.delete(url);
    }
  }
}

/** Shared singleton — one cache for the whole editor session. The
 *  segmentation editor lives in a single route, so a single instance
 *  is enough; tests that need isolation can `new FrameImageCache()`. */
export const frameImageCache = new FrameImageCache();
