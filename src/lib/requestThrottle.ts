/**
 * Shared concurrency limiter for SPECULATIVE frame requests.
 *
 * WHY THIS EXISTS. The editor warms frames it expects the playhead to reach:
 * `useFrameWindowPrefetch` walks a 5-back/10-ahead window and `useDecodeAhead`
 * runs a few frames past the playhead. Both used to warm through
 * `new Image()`, which the browser serialises on its own image-loading
 * pipeline, and were changed to plain `fetch`. `fetch` has no such queue —
 * every URL in the window is issued the instant the effect runs. At 3 channels
 * a single window shift is 48 requests, the window shifts on every playback
 * tick, and nginx's `segmentation` zone (100 r/s) started rejecting: 547
 * rejections in one minute at `excess: 100.100`, i.e. roughly 200 requests per
 * second arriving, and the editor logged `all 3 channel(s) failed to load`.
 *
 * The fix is not "fetch less" — the same URLs still need warming. It is to cap
 * how many are ever in flight at once, which caps the rate at which they are
 * issued, independent of how many channels a project has.
 *
 * ONE LIMITER, SHARED. Both hooks compete for the same server budget, so they
 * must draw from the same pool. Two independent limiters would each honour
 * their own cap and jointly bust the zone.
 *
 * A SLOT IS A COMPLETE REQUEST/RESPONSE CYCLE, body read included. Releasing
 * the slot when the response headers arrive would have reintroduced the bug:
 * the issue rate is `limit / cycle-time`, and time-to-first-byte can be a few
 * milliseconds, which would let 4 slots issue hundreds of requests per second.
 * Callers therefore pass a task that both fetches AND consumes the body, and
 * the slot is held until that task settles. CPU-bound follow-on work (PNG
 * decode) belongs OUTSIDE the task — it is not a request and must not hold a
 * slot a peer could be using.
 */

/**
 * Maximum speculative requests in flight at once.
 *
 * WHY 4. Production measured ~200 r/s arriving at a 100 r/s zone, produced by
 * bursts of 16 window frames x 3 channels = 48 requests issued simultaneously
 * on every window shift. Capping issuance at 4 cuts the burst ~12x, which puts
 * the same arrival pattern at roughly 17 r/s — well inside the zone with room
 * for the rest of the app and for other tabs sharing it.
 *
 * WHY NOT LOWER. Frame-data responses are multi-megabyte PNGs whose cycle is
 * dominated by transfer; below ~4 in flight the warm window stops keeping up
 * with playback and the editor is back to stalling on the loading gate.
 *
 * WHY NOT HIGHER, and why the browser's own limit is no substitute. HTTP/2
 * multiplexes ~100 concurrent streams over ONE connection, so the browser
 * would happily issue all 48 at once; and nginx's `limit_req` counts REQUESTS,
 * not connections, so connection-level limits do not bound what it sees.
 *
 * The residual assumption is that a complete cycle for a multi-megabyte body
 * takes tens of milliseconds. If frame-data ever became small and served from
 * a warm edge cache, 4 slots could churn faster than this reasoning allows and
 * the cap would need to become a rate limiter rather than a concurrency limit.
 */
export const MAX_SPECULATIVE_REQUESTS = 4;

/** Work that occupies one slot. Must include reading the response body. */
export type ThrottledTask<T> = () => Promise<T> | T;

interface QueueEntry {
  /** Promotes this entry out of the queue and into a slot. */
  start: () => void;
  /** Drops it without ever invoking the task. */
  cancel: () => void;
}

function abortError(message: string): Error {
  if (typeof DOMException !== 'undefined') {
    return new DOMException(message, 'AbortError');
  }
  const err = new Error(message);
  err.name = 'AbortError';
  return err;
}

export class RequestThrottle {
  private readonly waiting: QueueEntry[] = [];
  private active = 0;

  constructor(readonly limit: number = MAX_SPECULATIVE_REQUESTS) {}

  /** Tasks currently occupying a slot (speculative + immediate). */
  get inFlight(): number {
    return this.active;
  }

  /** Tasks admitted to the queue that have NOT been issued yet. */
  get queued(): number {
    return this.waiting.length;
  }

  /**
   * Run `task` once a slot is free.
   *
   * `signal` cancels the WAIT as well as the work: an entry still queued when
   * its signal aborts is removed and rejected with an `AbortError` WITHOUT the
   * task ever being invoked — so when the window shifts, URLs that left it are
   * never issued at all. Once the task has started, cancellation is the task's
   * own business (its `fetch` sees the same signal and rejects, which settles
   * the promise and frees the slot).
   */
  schedule<T>(task: ThrottledTask<T>, signal?: AbortSignal): Promise<T> {
    if (signal?.aborted) {
      return Promise.reject(abortError('Aborted before being queued'));
    }
    return new Promise<T>((resolve, reject) => {
      let settled = false;
      const detach = () => {
        if (signal && onAbort) signal.removeEventListener('abort', onAbort);
      };
      const entry: QueueEntry = {
        start: () => {
          if (settled) return;
          settled = true;
          detach();
          this.run(task).then(resolve, reject);
        },
        cancel: () => {
          if (settled) return;
          settled = true;
          detach();
          reject(abortError('Aborted while queued; request was never issued'));
        },
      };
      const onAbort = () => {
        const i = this.waiting.indexOf(entry);
        if (i !== -1) this.waiting.splice(i, 1);
        entry.cancel();
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      this.waiting.push(entry);
      this.pump();
    });
  }

  /**
   * Run `task` NOW, without queueing behind speculative work.
   *
   * For the frame the user is actually looking at. It still OCCUPIES a slot,
   * so speculative work backs off for as long as it runs — the shared budget
   * stays honest — but it never waits for one, because making the user wait
   * behind up to 48 queued warms is exactly the latency this module exists to
   * avoid. Peak concurrency is therefore `limit` + the displayed frame's own
   * channel count (bounded by the channels of one mounted canvas), not
   * unbounded.
   */
  runImmediate<T>(task: ThrottledTask<T>): Promise<T> {
    return this.run(task);
  }

  private run<T>(task: ThrottledTask<T>): Promise<T> {
    this.active++;
    let started: Promise<T>;
    try {
      started = Promise.resolve(task());
    } catch (err) {
      // A task that throws synchronously never held a real request open.
      this.release();
      return Promise.reject(err);
    }
    return started.then(
      value => {
        this.release();
        return value;
      },
      err => {
        this.release();
        throw err;
      }
    );
  }

  private release(): void {
    this.active--;
    this.pump();
  }

  private pump(): void {
    // `start` increments `active` synchronously, so this terminates.
    while (this.active < this.limit && this.waiting.length > 0) {
      this.waiting.shift()?.start();
    }
  }
}

/**
 * The one limiter both prefetch hooks draw from. Module-level on purpose:
 * a per-hook instance would let each hook stay under the cap while the pair
 * of them exceeded it.
 */
export const speculativeFrameRequests = new RequestThrottle();
