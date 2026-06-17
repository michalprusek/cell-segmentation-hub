/**
 * mtKymographExporter.test.ts
 *
 * Unit tests for pickSourceChannels — the pure channel-selection helper.
 * Regression guard for the bug (commit 488ca68) where the export sampled only
 * the FIRST fluorescent channel and silently missed motion in the others.
 */
import { describe, it, expect, vi } from 'vitest';

// Side-effect-free import: the module pulls in prisma / logger / buildKymograph
// at load, none of which the pure helper needs.
vi.mock('../../../db/prismaClient', () => ({ prisma: {} }));
vi.mock('../../../utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../../../utils/concurrency', () => ({ mapWithConcurrency: vi.fn() }));
vi.mock('../../kymographService', () => ({ buildKymograph: vi.fn() }));

import { pickSourceChannels } from '../mtKymographExporter';

describe('pickSourceChannels', () => {
  it('returns ALL fluorescent channels (not just the first)', () => {
    const channels = [
      { name: 'IRM', type: 'irm', isSegmentationSource: true },
      { name: 'TIRF_640', type: 'fluorescent' },
      { name: 'TIRF_488', type: 'fluorescent' },
    ];
    // The regression: must include BOTH fluorescent channels.
    expect(pickSourceChannels(channels)).toEqual(['TIRF_640', 'TIRF_488']);
  });

  it('falls back to the segmentation source when no fluorescent channels', () => {
    const channels = [
      { name: 'ch0', type: 'irm', isSegmentationSource: true },
      { name: 'ch1', type: 'irm' },
    ];
    expect(pickSourceChannels(channels)).toEqual(['ch0']);
  });

  it('falls back to the first channel when no fluorescent and no source', () => {
    const channels = [{ name: 'ch0', type: 'irm' }, { name: 'ch1' }];
    expect(pickSourceChannels(channels)).toEqual(['ch0']);
  });

  it('returns an empty list for no channels', () => {
    expect(pickSourceChannels([])).toEqual([]);
  });
});
