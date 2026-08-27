import { describe, it, expect, vi } from 'vitest';
import { mapWithConcurrency, Semaphore, runGated } from '../concurrency';

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

describe('mapWithConcurrency', () => {
  it('processes all items in correct count and reports progress', async () => {
    const items = Array.from({ length: 20 }, (_, i) => i);
    const processed: number[] = [];
    const onProgress = vi.fn();

    await mapWithConcurrency(
      items,
      4,
      async i => {
        await sleep(1);
        processed.push(i);
      },
      { onProgress }
    );

    expect(processed.sort((a, b) => a - b)).toEqual(items);
    expect(onProgress).toHaveBeenCalledTimes(20);
    expect(onProgress).toHaveBeenLastCalledWith(20, 20);
  });

  it('respects concurrency limit (never exceeds it)', async () => {
    let inFlight = 0;
    let peak = 0;
    const items = Array.from({ length: 30 }, (_, i) => i);

    await mapWithConcurrency(items, 5, async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await sleep(2);
      inFlight -= 1;
    });

    expect(peak).toBe(5);
  });

  it('aborts when shouldAbort returns true and reports abortMessage', async () => {
    let count = 0;
    const items = Array.from({ length: 50 }, (_, i) => i);

    await expect(
      mapWithConcurrency(
        items,
        4,
        async () => {
          count += 1;
          await sleep(1);
        },
        {
          shouldAbort: () => count >= 8,
          abortMessage: 'Cancelled by user',
        }
      )
    ).rejects.toThrow('Cancelled by user');

    expect(count).toBeLessThan(items.length);
  });

  it('rethrows the first task error after in-flight tasks settle', async () => {
    const items = Array.from({ length: 10 }, (_, i) => i);

    await expect(
      mapWithConcurrency(items, 3, async i => {
        if (i === 2) throw new Error('boom');
        await sleep(1);
      })
    ).rejects.toThrow('boom');
  });

  it('handles empty input as no-op', async () => {
    const onProgress = vi.fn();
    await expect(
      mapWithConcurrency([], 4, async () => {}, { onProgress })
    ).resolves.toBeUndefined();
    expect(onProgress).not.toHaveBeenCalled();
  });

  it('caps concurrency at item count when items < limit', async () => {
    let peak = 0;
    let inFlight = 0;
    await mapWithConcurrency([1, 2, 3], 16, async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await sleep(1);
      inFlight -= 1;
    });
    expect(peak).toBeLessThanOrEqual(3);
  });
});

/**
 * The Semaphore exists because `mapWithConcurrency` bounds concurrency WITHIN
 * one stage, while the microtubule export runs several such stages at once
 * through a single `Promise.all` against a one-worker ML service. A shared
 * Semaphore makes the limit apply to the whole job. These tests pin the three
 * properties that behaviour depends on.
 */
describe('Semaphore', () => {
  it('never lets more than `concurrency` tasks run at once', async () => {
    const gate = new Semaphore(2);
    let inFlight = 0;
    let peak = 0;
    await Promise.all(
      Array.from({ length: 12 }, () =>
        gate.run(async () => {
          inFlight += 1;
          peak = Math.max(peak, inFlight);
          await sleep(3);
          inFlight -= 1;
        })
      )
    );
    expect(peak).toBe(2);
    expect(inFlight).toBe(0);
  });

  it('hands a freed permit to the longest-waiting caller (FIFO)', async () => {
    // With concurrency 1 the order tasks *finish* is the order they queued.
    // `release()` resolves the head of the queue directly instead of bumping
    // a counter, which is what makes this exact rather than best-effort.
    const gate = new Semaphore(1);
    const order: number[] = [];
    await Promise.all(
      [0, 1, 2, 3, 4].map(i =>
        gate.run(async () => {
          await sleep((5 - i) * 2); // later callers finish FASTER if unordered
          order.push(i);
        })
      )
    );
    expect(order).toEqual([0, 1, 2, 3, 4]);
  });

  it('releases the permit when a task throws, so it cannot deadlock', async () => {
    const gate = new Semaphore(1);
    await expect(
      gate.run(async () => {
        throw new Error('boom');
      })
    ).rejects.toThrow('boom');

    // If the `finally` were missing, this second call would hang forever and
    // the test would time out rather than fail an assertion.
    await expect(gate.run(async () => 'ok')).resolves.toBe('ok');
  });

  it('floors the limit at 1 so a bad config cannot deadlock every caller', async () => {
    for (const bad of [0, -3, 0.4]) {
      const gate = new Semaphore(bad);
      await expect(gate.run(async () => 'ran')).resolves.toBe('ran');
    }
  });

  it('propagates the task result and rejection unchanged', async () => {
    const gate = new Semaphore(3);
    await expect(gate.run(async () => ({ a: 1 }))).resolves.toEqual({ a: 1 });
    const err = new Error('specific');
    await expect(gate.run(async () => Promise.reject(err))).rejects.toBe(err);
  });
});

describe('runGated', () => {
  it('runs the task directly when no gate is supplied', async () => {
    // Existing unit tests call the ML-bound helpers without a gate; that path
    // must stay a plain call rather than requiring a Semaphore to be built.
    await expect(runGated(undefined, async () => 'direct')).resolves.toBe(
      'direct'
    );
  });

  it('routes through the gate when one is supplied, honouring its limit', async () => {
    const gate = new Semaphore(1);
    let inFlight = 0;
    let peak = 0;
    await Promise.all(
      Array.from({ length: 6 }, () =>
        runGated(gate, async () => {
          inFlight += 1;
          peak = Math.max(peak, inFlight);
          await sleep(2);
          inFlight -= 1;
        })
      )
    );
    expect(peak).toBe(1);
  });
});
