import { describe, it, expect } from 'vitest';
import { pickDefaultSegmentationChannel } from '../segmentationChannelDefault';

describe('pickDefaultSegmentationChannel', () => {
  it('prefers the marked source over an alphabetically earlier channel', () => {
    // The list reaches the project page sorted by name. "First" used to win.
    expect(
      pickDefaultSegmentationChannel(['488_nm', '640_nm', 'IRM'], ['IRM'])
    ).toBe('IRM');
  });

  it('preselects nothing when no channel is a marked source', () => {
    expect(pickDefaultSegmentationChannel(['ch0', 'ch1'], [])).toBe('');
    expect(pickDefaultSegmentationChannel(['ch0', 'ch1'], undefined)).toBe('');
    expect(pickDefaultSegmentationChannel(['ch0', 'ch1'], null)).toBe('');
  });

  it('ignores a marked source that is not among the channels offered', () => {
    expect(pickDefaultSegmentationChannel(['ch0', 'ch1'], ['IRM'])).toBe('');
  });

  it('takes the first offered one when several are marked', () => {
    expect(
      pickDefaultSegmentationChannel(['488_nm', 'BF', 'IRM'], ['IRM', 'BF'])
    ).toBe('BF');
  });
});
