/**
 * Behavioral tests for src/lib/lazyImports.ts
 *
 * lazyLoadMetricCalculations performs a real dynamic import of the metric
 * calculations module. Inside Vitest's jsdom environment the full Vite chunk
 * graph is not available, so we verify the public contract we can assert
 * reliably: it is an async function that resolves to the module namespace.
 */

import { describe, it, expect, vi } from 'vitest';
import { lazyLoadMetricCalculations } from '../lazyImports';

vi.mock('../logger', () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('lazyLoadMetricCalculations', () => {
  it('is an async function', () => {
    expect(typeof lazyLoadMetricCalculations).toBe('function');
    expect(lazyLoadMetricCalculations.constructor.name).toBe('AsyncFunction');
  });

  it('resolves to a module exposing calculateMetrics', async () => {
    const module = await lazyLoadMetricCalculations();
    expect(module).toBeTypeOf('object');
    expect(typeof module.calculateMetrics).toBe('function');
  });
});
