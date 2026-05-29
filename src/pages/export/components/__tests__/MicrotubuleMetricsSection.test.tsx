/**
 * MicrotubuleMetricsSection — behavioral unit tests
 *
 * Covered behaviours:
 *  - Section title and description render
 *  - Enable checkbox toggles enabled state
 *  - Inputs are disabled when section is not enabled
 *  - Thickness input: valid values propagate onChange, invalid values do not
 *  - Thickness input: blur with invalid value snaps back to last good value
 *  - Margin input: same valid/invalid/blur rules (range 0–10, integer)
 *  - Channel list: renders each channel with displayName / name fallback
 *  - Channel checkbox toggles add/remove from value.channels
 *  - Channel checkboxes disabled when section not enabled
 *  - "no channels" message shown when availableChannels is empty
 *  - Validation hint shown when enabled but no channel selected
 *  - Validation hint hidden when disabled (even if no channel)
 *  - External value changes re-sync local text fields
 */

import React, { useState } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '@/test/utils/test-utils';

import {
  MicrotubuleMetricsSection,
  type MicrotubuleMetricsOptions,
  type MicrotubuleMetricsSectionProps,
} from '../MicrotubuleMetricsSection';

// ── helpers ──────────────────────────────────────────────────────────────────

const CHANNELS = [
  { name: 'ch1', displayName: 'Green 488' },
  { name: 'ch2', displayName: 'Red 561' },
  { name: 'ch3' }, // no displayName — must fall back to name
];

function makeValue(
  overrides: Partial<MicrotubuleMetricsOptions> = {}
): MicrotubuleMetricsOptions {
  return {
    enabled: true,
    thicknessPx: 5,
    marginMultiplier: 2,
    channels: [],
    ...overrides,
  };
}

/**
 * Controlled wrapper so we can observe what onChange is called with
 * without fighting stale closures.
 */
function Wrapper({
  initial,
  onChange,
  availableChannels = CHANNELS,
}: {
  initial: MicrotubuleMetricsOptions;
  onChange?: MicrotubuleMetricsSectionProps['onChange'];
  availableChannels?: MicrotubuleMetricsSectionProps['availableChannels'];
}) {
  const [value, setValue] = useState(initial);
  const handleChange: MicrotubuleMetricsSectionProps['onChange'] = next => {
    setValue(next);
    onChange?.(next);
  };
  return (
    <MicrotubuleMetricsSection
      value={value}
      onChange={handleChange}
      availableChannels={availableChannels}
    />
  );
}

function setup(
  initial: MicrotubuleMetricsOptions = makeValue(),
  availableChannels = CHANNELS
) {
  const onChange = vi.fn();
  const user = userEvent.setup();
  const utils = render(
    <Wrapper
      initial={initial}
      onChange={onChange}
      availableChannels={availableChannels}
    />
  );
  return { user, onChange, ...utils };
}

// ── tests ────────────────────────────────────────────────────────────────────

describe('MicrotubuleMetricsSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── static content ────────────────────────────────────────────────────────

  describe('static content', () => {
    it('renders the section title', () => {
      setup();
      expect(screen.getByText('Microtubule metrics')).toBeInTheDocument();
    });

    it('renders the enable checkbox', () => {
      setup();
      expect(
        screen.getByLabelText(/compute per-channel intensity/i)
      ).toBeInTheDocument();
    });
  });

  // ── enable / disable toggle ────────────────────────────────────────────────

  describe('enabled toggle', () => {
    it('calls onChange with enabled: false when checkbox unchecked', async () => {
      const { user, onChange } = setup(makeValue({ enabled: true }));
      await user.click(screen.getByLabelText(/compute per-channel intensity/i));
      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({ enabled: false })
      );
    });

    it('calls onChange with enabled: true when checkbox checked', async () => {
      const { user, onChange } = setup(makeValue({ enabled: false }));
      await user.click(screen.getByLabelText(/compute per-channel intensity/i));
      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({ enabled: true })
      );
    });

    it('disables thickness input when section is disabled', () => {
      setup(makeValue({ enabled: false }));
      expect(screen.getByLabelText(/mt thickness/i)).toBeDisabled();
    });

    it('disables margin input when section is disabled', () => {
      setup(makeValue({ enabled: false }));
      expect(screen.getByLabelText(/background margin/i)).toBeDisabled();
    });

    it('enables inputs when section is enabled', () => {
      setup(makeValue({ enabled: true }));
      expect(screen.getByLabelText(/mt thickness/i)).not.toBeDisabled();
      expect(screen.getByLabelText(/background margin/i)).not.toBeDisabled();
    });
  });

  // ── thickness input ────────────────────────────────────────────────────────

  describe('thickness input', () => {
    it('shows the initial thickness value', () => {
      setup(makeValue({ thicknessPx: 5 }));
      expect(screen.getByLabelText(/mt thickness/i)).toHaveValue(5);
    });

    it('propagates a valid integer change', async () => {
      const { onChange } = setup(makeValue({ thicknessPx: 5 }));
      const input = screen.getByLabelText(/mt thickness/i);
      fireEvent.change(input, { target: { value: '10' } });
      await waitFor(() =>
        expect(onChange).toHaveBeenCalledWith(
          expect.objectContaining({ thicknessPx: 10 })
        )
      );
    });

    it('does NOT propagate an out-of-range value (e.g. 0)', async () => {
      const { onChange } = setup(makeValue({ thicknessPx: 5 }));
      const input = screen.getByLabelText(/mt thickness/i);
      fireEvent.change(input, { target: { value: '0' } });
      // onChange may be called for other reasons; check it was not called with
      // thicknessPx: 0
      const badCalls = onChange.mock.calls.filter(
        (c: any) => c[0].thicknessPx === 0
      );
      expect(badCalls).toHaveLength(0);
    });

    it('does NOT propagate a decimal value', async () => {
      const { onChange } = setup(makeValue({ thicknessPx: 5 }));
      const input = screen.getByLabelText(/mt thickness/i);
      fireEvent.change(input, { target: { value: '5.5' } });
      const badCalls = onChange.mock.calls.filter(
        (c: any) => String(c[0].thicknessPx) === '5.5'
      );
      expect(badCalls).toHaveLength(0);
    });

    it('snaps back to last good value on blur when empty', () => {
      setup(makeValue({ thicknessPx: 5 }));
      const input = screen.getByLabelText(/mt thickness/i);
      fireEvent.change(input, { target: { value: '' } });
      fireEvent.blur(input);
      expect(input).toHaveValue(5);
    });

    it('snaps back to last good value on blur when out-of-range', () => {
      setup(makeValue({ thicknessPx: 5 }));
      const input = screen.getByLabelText(/mt thickness/i);
      fireEvent.change(input, { target: { value: '999' } });
      fireEvent.blur(input);
      expect(input).toHaveValue(5);
    });
  });

  // ── margin input ──────────────────────────────────────────────────────────

  describe('margin input', () => {
    it('shows the initial margin value', () => {
      setup(makeValue({ marginMultiplier: 2 }));
      expect(screen.getByLabelText(/background margin/i)).toHaveValue(2);
    });

    it('propagates a valid integer change (including 0)', async () => {
      const { onChange } = setup(makeValue({ marginMultiplier: 2 }));
      const input = screen.getByLabelText(/background margin/i);
      fireEvent.change(input, { target: { value: '0' } });
      await waitFor(() =>
        expect(onChange).toHaveBeenCalledWith(
          expect.objectContaining({ marginMultiplier: 0 })
        )
      );
    });

    it('does NOT propagate an out-of-range value (> 10)', () => {
      const { onChange } = setup(makeValue({ marginMultiplier: 2 }));
      const input = screen.getByLabelText(/background margin/i);
      fireEvent.change(input, { target: { value: '11' } });
      const badCalls = onChange.mock.calls.filter(
        (c: any) => c[0].marginMultiplier === 11
      );
      expect(badCalls).toHaveLength(0);
    });

    it('snaps back to last good value on blur when invalid', () => {
      setup(makeValue({ marginMultiplier: 3 }));
      const input = screen.getByLabelText(/background margin/i);
      fireEvent.change(input, { target: { value: '99' } });
      fireEvent.blur(input);
      expect(input).toHaveValue(3);
    });
  });

  // ── channel list ──────────────────────────────────────────────────────────

  describe('channel list', () => {
    it('renders each available channel', () => {
      setup();
      expect(screen.getByText('Green 488')).toBeInTheDocument();
      expect(screen.getByText('Red 561')).toBeInTheDocument();
    });

    it('falls back to channel name when displayName absent', () => {
      setup();
      expect(screen.getByText('ch3')).toBeInTheDocument();
    });

    it('shows machine name in parentheses when displayName differs from name', () => {
      setup();
      // Green 488 has displayName !== name, so (ch1) should appear
      expect(screen.getByText('(ch1)')).toBeInTheDocument();
    });

    it('adds channel to value.channels on checkbox click', async () => {
      const { onChange } = setup(makeValue({ channels: [] }));
      const checkbox = screen.getByRole('checkbox', { name: /Green 488/i });
      fireEvent.click(checkbox);
      await waitFor(() =>
        expect(onChange).toHaveBeenCalledWith(
          expect.objectContaining({ channels: expect.arrayContaining(['ch1']) })
        )
      );
    });

    it('removes channel from value.channels when unchecked', async () => {
      const { onChange } = setup(makeValue({ channels: ['ch1'] }));
      const checkbox = screen.getByRole('checkbox', { name: /Green 488/i });
      fireEvent.click(checkbox);
      await waitFor(() => {
        const lastCall = onChange.mock.calls[onChange.mock.calls.length - 1][0];
        expect(lastCall.channels).not.toContain('ch1');
      });
    });

    it('channel checkboxes are disabled when section not enabled', () => {
      setup(makeValue({ enabled: false }));
      const checkboxes = screen.getAllByRole('checkbox');
      // First checkbox is the "enable" one; rest are channel checkboxes
      const channelCheckboxes = checkboxes.slice(1);
      channelCheckboxes.forEach(cb => expect(cb).toBeDisabled());
    });

    it('channel checkboxes are enabled when section is enabled', () => {
      setup(makeValue({ enabled: true }));
      const checkboxes = screen.getAllByRole('checkbox');
      const channelCheckboxes = checkboxes.slice(1);
      channelCheckboxes.forEach(cb => expect(cb).not.toBeDisabled());
    });
  });

  // ── empty channels ────────────────────────────────────────────────────────

  describe('when no channels available', () => {
    it('shows "no channels" message', () => {
      setup(makeValue(), []);
      expect(screen.getByText(/no per-channel metadata/i)).toBeInTheDocument();
    });

    it('does NOT show the channel checkbox list', () => {
      setup(makeValue(), []);
      // Only the "enable" checkbox should be present
      const checkboxes = screen.getAllByRole('checkbox');
      expect(checkboxes).toHaveLength(1);
    });
  });

  // ── validation hint ────────────────────────────────────────────────────────

  describe('validation hint', () => {
    it('shows "select at least one channel" when enabled and no channel selected', () => {
      setup(makeValue({ enabled: true, channels: [] }));
      expect(
        screen.getByText(/select at least one channel/i)
      ).toBeInTheDocument();
    });

    it('hides validation hint when a channel is selected', () => {
      setup(makeValue({ enabled: true, channels: ['ch1'] }));
      expect(
        screen.queryByText(/select at least one channel/i)
      ).not.toBeInTheDocument();
    });

    it('hides validation hint when section is disabled', () => {
      setup(makeValue({ enabled: false, channels: [] }));
      expect(
        screen.queryByText(/select at least one channel/i)
      ).not.toBeInTheDocument();
    });
  });

  // ── external value sync ───────────────────────────────────────────────────

  describe('external value changes re-sync fields', () => {
    it('updates thickness display when parent updates thicknessPx', async () => {
      const onChange = vi.fn();
      const { rerender } = render(
        <MicrotubuleMetricsSection
          value={makeValue({ thicknessPx: 5 })}
          onChange={onChange}
          availableChannels={CHANNELS}
        />
      );
      rerender(
        <MicrotubuleMetricsSection
          value={makeValue({ thicknessPx: 20 })}
          onChange={onChange}
          availableChannels={CHANNELS}
        />
      );
      await waitFor(() =>
        expect(screen.getByLabelText(/mt thickness/i)).toHaveValue(20)
      );
    });
  });
});
