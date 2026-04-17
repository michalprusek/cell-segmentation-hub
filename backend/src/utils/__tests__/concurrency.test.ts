import { describe, it, expect, jest } from '@jest/globals';
import { mapWithConcurrency } from '../concurrency';

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

describe('mapWithConcurrency', () => {
  it('processes all items in correct count and reports progress', async () => {
    const items = Array.from({ length: 20 }, (_, i) => i);
    const processed: number[] = [];
    const onProgress = jest.fn();

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
    const onProgress = jest.fn();
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
