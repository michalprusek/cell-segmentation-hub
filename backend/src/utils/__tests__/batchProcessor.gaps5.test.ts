/**
 * batchProcessor.gaps5.test.ts
 *
 * Full coverage of batchProcessor.ts — previously 3.4% covered:
 *
 *  A. BatchProcessor.processBatch
 *     - empty items array → returns []
 *     - single batch (items.length <= batchSize) → processes all items
 *     - multiple batches → processes all batches sequentially
 *     - with concurrencyManager (concurrency option) → items processed via concurrency
 *     - without concurrency option → direct processing
 *     - item error + onItemError callback → callback called, item not in results
 *     - onBatchComplete callback called with correct batchIndex and results
 *
 *  B. BatchProcessor.processInChunks
 *     - empty items → returns []
 *     - processes all chunks correctly
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// batchProcessor uses ConcurrencyManager — use the real one (it's simple)
// Only mock logger to avoid noise

import { BatchProcessor, batchProcessor } from '../batchProcessor';

describe('BatchProcessor.processBatch', () => {
  let processor: BatchProcessor;

  beforeEach(() => {
    processor = new BatchProcessor();
  });

  it('returns empty array for empty input', async () => {
    const result = await processor.processBatch([], async x => x, {
      batchSize: 10,
    });
    expect(result).toEqual([]);
  });

  it('processes all items in a single batch', async () => {
    const items = [1, 2, 3];
    const result = await processor.processBatch(
      items,
      async (x: number) => x * 2,
      { batchSize: 10 }
    );
    expect(result).toEqual([2, 4, 6]);
  });

  it('processes items across multiple batches', async () => {
    const items = [1, 2, 3, 4, 5];
    const result = await processor.processBatch(
      items,
      async (x: number) => x * 2,
      { batchSize: 2 }
    );
    expect(result).toHaveLength(5);
    expect(result.sort((a, b) => a - b)).toEqual([2, 4, 6, 8, 10]);
  });

  it('calls onBatchComplete with correct batchIndex and results', async () => {
    const onBatchComplete = vi.fn();
    const items = [1, 2, 3, 4];

    await processor.processBatch(items, async (x: number) => x * 10, {
      batchSize: 2,
      onBatchComplete,
    });

    expect(onBatchComplete).toHaveBeenCalledTimes(2);
    expect(onBatchComplete).toHaveBeenNthCalledWith(1, 0, [10, 20]);
    expect(onBatchComplete).toHaveBeenNthCalledWith(2, 1, [30, 40]);
  });

  it('calls onItemError when processor throws, excludes failed item from results', async () => {
    const onItemError = vi.fn();
    const items = [1, 2, 3];

    const result = await processor.processBatch(
      items,
      async (x: number) => {
        if (x === 2) throw new Error('item 2 failed');
        return x * 10;
      },
      { batchSize: 10, onItemError }
    );

    // Failed item (2) excluded from results
    expect(result).toEqual([10, 30]);
    expect(onItemError).toHaveBeenCalledWith(2, expect.any(Error));
  });

  it('processes with concurrency option', async () => {
    const items = [1, 2, 3, 4];
    const result = await processor.processBatch(items, async (x: number) => x, {
      batchSize: 10,
      concurrency: 2,
    });
    expect(result.sort((a, b) => a - b)).toEqual([1, 2, 3, 4]);
  });

  it('handles no onItemError callback gracefully', async () => {
    const items = [1, 2, 3];

    // No onItemError callback — error is silently filtered from results
    const result = await processor.processBatch(
      items,
      async (x: number) => {
        if (x === 1) throw new Error('failed');
        return x;
      },
      { batchSize: 10 }
    );

    expect(result).toEqual([2, 3]);
  });
});

describe('BatchProcessor.processInChunks', () => {
  let processor: BatchProcessor;

  beforeEach(() => {
    processor = new BatchProcessor();
  });

  it('returns empty array for empty input', async () => {
    const result = await processor.processInChunks([], async chunk => chunk, 5);
    expect(result).toEqual([]);
  });

  it('processes all chunks and combines results', async () => {
    const items = [1, 2, 3, 4, 5];
    const result = await processor.processInChunks(
      items,
      async (chunk: number[]) => chunk.map(x => x * 2),
      2
    );
    expect(result).toEqual([2, 4, 6, 8, 10]);
  });
});

describe('batchProcessor singleton', () => {
  it('is a BatchProcessor instance', () => {
    expect(batchProcessor).toBeInstanceOf(BatchProcessor);
  });
});
