import { logger } from './logger';

/**
 * Bounded-concurrency map. Workers share a cursor; the first thrown error
 * short-circuits remaining work and is rethrown after in-flight tasks
 * settle. Subsequent concurrent errors are logged so they aren't lost.
 *
 * - `shouldAbort()` is polled before each item for user-initiated cancellation.
 * - `onProgress(completed, total)` fires after each successful completion.
 *   Order is non-deterministic; counts are accurate.
 */
export const mapWithConcurrency = async <T>(
  items: T[],
  concurrency: number,
  task: (item: T, index: number) => Promise<void>,
  options: {
    shouldAbort?: () => boolean;
    onProgress?: (completed: number, total: number) => void;
    abortMessage?: string;
  } = {}
): Promise<void> => {
  const total = items.length;
  if (total === 0) {
    return;
  }

  const limit = Math.max(1, Math.min(concurrency, total));
  let nextIndex = 0;
  let completed = 0;
  let firstError: unknown = undefined;
  let aborted = false;

  const worker = async (): Promise<void> => {
    while (true) {
      if (firstError !== undefined || aborted) {
        return;
      }
      if (options.shouldAbort?.()) {
        aborted = true;
        return;
      }
      const i = nextIndex++;
      if (i >= total) {
        return;
      }
      try {
        await task(items[i] as T, i);
      } catch (err) {
        if (firstError === undefined) {
          firstError = err;
        } else {
          logger.error(
            'mapWithConcurrency: secondary task error suppressed by first-error short-circuit',
            err instanceof Error ? err : new Error(String(err)),
            'concurrency'
          );
        }
        return;
      }
      completed += 1;
      options.onProgress?.(completed, total);
    }
  };

  await Promise.all(Array.from({ length: limit }, () => worker()));

  if (firstError !== undefined) {
    throw firstError;
  }
  if (aborted) {
    throw new Error(options.abortMessage ?? 'Operation aborted');
  }
};

/**
 * A counting semaphore that bounds how many async tasks run at once,
 * queueing the rest in FIFO call order (no starvation: a permit always goes
 * to whichever caller has waited longest).
 *
 * Purpose: `mapWithConcurrency` only bounds concurrency WITHIN one stage. A
 * pipeline that runs several independently-concurrency-limited stages at
 * once (e.g. via `Promise.all`) can still fire `stageA.limit + stageB.limit +
 * stageC.limit` requests simultaneously at a single shared downstream
 * service — exactly what happened to the microtubule export against the
 * ML service (single `uvicorn --workers 1`): `mt-metrics` +
 * `mt-background-rois` + a bounded-but-still-concurrent batch of kymograph
 * requests all landed on it at once, and one export alone produced 893
 * "Exceeded concurrency limit" warnings.
 *
 * A single `Semaphore` instance shared across all of a job's ML-bound stages
 * makes the limit apply to the WHOLE job rather than per-stage.
 */
export class Semaphore {
  private available: number;
  private readonly queue: Array<() => void> = [];

  constructor(concurrency: number) {
    this.available = Math.max(1, Math.floor(concurrency));
  }

  /** Run `task`, waiting for a free permit first and releasing it afterwards
   *  (success or failure) — never leaks a permit on a thrown error. */
  async run<T>(task: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await task();
    } finally {
      this.release();
    }
  }

  private acquire(): Promise<void> {
    if (this.available > 0) {
      this.available -= 1;
      return Promise.resolve();
    }
    return new Promise<void>(resolve => {
      this.queue.push(resolve);
    });
  }

  private release(): void {
    const next = this.queue.shift();
    if (next) {
      // Hand the permit straight to the next waiter rather than incrementing
      // `available` — keeps FIFO ordering exact under contention.
      next();
    } else {
      this.available += 1;
    }
  }
}

/**
 * Run `task` through `gate` when one is supplied, otherwise run it directly.
 * Lets every ML-bound call site accept an OPTIONAL shared `Semaphore` (so
 * existing unit tests that call these functions without a gate are
 * unaffected) while production code always threads one through.
 */
export async function runGated<T>(
  gate: Semaphore | undefined,
  task: () => Promise<T>
): Promise<T> {
  return gate ? gate.run(task) : task();
}
