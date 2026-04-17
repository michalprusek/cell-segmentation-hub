/**
 * Process items with bounded concurrency. Workers pull from a shared
 * cursor; the first thrown error short-circuits remaining work.
 *
 * - `shouldAbort()` is checked before each item — used for user-initiated
 *   cancellation. Throws are surfaced after all in-flight tasks settle.
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
  if (total === 0) return;

  const limit = Math.max(1, Math.min(concurrency, total));
  let nextIndex = 0;
  let completed = 0;
  let firstError: unknown = undefined;
  let aborted = false;

  const worker = async (): Promise<void> => {
    while (true) {
      if (firstError !== undefined || aborted) return;
      if (options.shouldAbort?.()) {
        aborted = true;
        return;
      }
      const i = nextIndex++;
      if (i >= total) return;
      try {
        await task(items[i] as T, i);
      } catch (err) {
        if (firstError === undefined) firstError = err;
        return;
      }
      completed += 1;
      options.onProgress?.(completed, total);
    }
  };

  await Promise.all(
    Array.from({ length: limit }, () => worker())
  );

  if (firstError !== undefined) throw firstError;
  if (aborted) {
    throw new Error(options.abortMessage ?? 'Operation aborted');
  }
};
