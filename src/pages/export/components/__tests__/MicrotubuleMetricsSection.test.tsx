/**
 * MicrotubuleMetricsSection — behavioral unit tests
 *
 * The section was simplified: per-channel intensity (incl. the integrated sum)
 * is now ALWAYS computed for every channel, so there is no longer an enable
 * checkbox or a channel picker. Only the band thickness + background margin
 * inputs remain (always editable), plus an always-on info note.
 *
 * Covered behaviours:
 *  - Section title + always-on intensity note render
 *  - No enable checkbox / no channel checkboxes are rendered
 *  - Thickness input: valid values propagate, invalid do not, blur snaps back
 *  - Margin input: same valid/invalid/blur rules (range 0–10, integer)
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

function makeValue(
  overrides: Partial<MicrotubuleMetricsOptions> = {}
): MicrotubuleMetricsOptions {
  return {
    thicknessPx: 5,
    marginMultiplier: 2,
    ...overrides,
  };
}

/** Controlled wrapper so we can observe onChange without fighting stale closures. */
function Wrapper({
  initial,
  onChange,
}: {
  initial: MicrotubuleMetricsOptions;
  onChange?: MicrotubuleMetricsSectionProps['onChange'];
}) {
  const [value, setValue] = useState(initial);
  const handleChange: MicrotubuleMetricsSectionProps['onChange'] = next => {
    setValue(next);
    onChange?.(next);
  };
  return <MicrotubuleMetricsSection value={value} onChange={handleChange} />;
}

function setup(initial: MicrotubuleMetricsOptions = makeValue()) {
  const onChange = vi.fn();
  const user = userEvent.setup();
  const utils = render(<Wrapper initial={initial} onChange={onChange} />);
  return { user, onChange, ...utils };
}

// ── tests ────────────────────────────────────────────────────────────────────

describe('MicrotubuleMetricsSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('static content', () => {
    it('renders the section title', () => {
      setup();
      expect(screen.getByText('Microtubule metrics')).toBeInTheDocument();
    });

    it('renders the always-on per-channel intensity note', () => {
      setup();
      expect(
        screen.getByText(/always computed for every channel/i)
      ).toBeInTheDocument();
    });

    it('renders NO enable checkbox and NO channel checkboxes', () => {
      // The simplified section has no checkboxes at all — intensity is always on.
      setup();
      expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
    });
  });

  describe('thickness input', () => {
    it('shows the initial thickness value and is always editable', () => {
      setup(makeValue({ thicknessPx: 5 }));
      const input = screen.getByLabelText(/mt thickness/i);
      expect(input).toHaveValue(5);
      expect(input).not.toBeDisabled();
    });

    it('propagates a valid integer change', async () => {
      const { onChange } = setup(makeValue({ thicknessPx: 5 }));
      fireEvent.change(screen.getByLabelText(/mt thickness/i), {
        target: { value: '10' },
      });
      await waitFor(() =>
        expect(onChange).toHaveBeenCalledWith(
          expect.objectContaining({ thicknessPx: 10 })
        )
      );
    });

    it('does NOT propagate an out-of-range value (0)', () => {
      const { onChange } = setup(makeValue({ thicknessPx: 5 }));
      fireEvent.change(screen.getByLabelText(/mt thickness/i), {
        target: { value: '0' },
      });
      expect(
        onChange.mock.calls.filter(
          (c: unknown[]) => (c[0] as { thicknessPx?: number }).thicknessPx === 0
        )
      ).toHaveLength(0);
    });

    it('does NOT propagate a decimal value', () => {
      const { onChange } = setup(makeValue({ thicknessPx: 5 }));
      fireEvent.change(screen.getByLabelText(/mt thickness/i), {
        target: { value: '5.5' },
      });
      expect(
        onChange.mock.calls.filter(
          (c: unknown[]) =>
            String((c[0] as { thicknessPx?: number }).thicknessPx) === '5.5'
        )
      ).toHaveLength(0);
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

  describe('margin input', () => {
    it('shows the initial margin value', () => {
      setup(makeValue({ marginMultiplier: 2 }));
      expect(screen.getByLabelText(/background margin/i)).toHaveValue(2);
    });

    it('propagates a valid integer change (including 0)', async () => {
      const { onChange } = setup(makeValue({ marginMultiplier: 2 }));
      fireEvent.change(screen.getByLabelText(/background margin/i), {
        target: { value: '0' },
      });
      await waitFor(() =>
        expect(onChange).toHaveBeenCalledWith(
          expect.objectContaining({ marginMultiplier: 0 })
        )
      );
    });

    it('does NOT propagate an out-of-range value (> 10)', () => {
      const { onChange } = setup(makeValue({ marginMultiplier: 2 }));
      fireEvent.change(screen.getByLabelText(/background margin/i), {
        target: { value: '11' },
      });
      expect(
        onChange.mock.calls.filter(
          (c: unknown[]) =>
            (c[0] as { marginMultiplier?: number }).marginMultiplier === 11
        )
      ).toHaveLength(0);
    });

    it('snaps back to last good value on blur when invalid', () => {
      setup(makeValue({ marginMultiplier: 3 }));
      const input = screen.getByLabelText(/background margin/i);
      fireEvent.change(input, { target: { value: '99' } });
      fireEvent.blur(input);
      expect(input).toHaveValue(3);
    });
  });

  describe('external value changes re-sync fields', () => {
    it('updates thickness display when parent updates thicknessPx', async () => {
      const onChange = vi.fn();
      const { rerender } = render(
        <MicrotubuleMetricsSection
          value={makeValue({ thicknessPx: 5 })}
          onChange={onChange}
        />
      );
      rerender(
        <MicrotubuleMetricsSection
          value={makeValue({ thicknessPx: 20 })}
          onChange={onChange}
        />
      );
      await waitFor(() =>
        expect(screen.getByLabelText(/mt thickness/i)).toHaveValue(20)
      );
    });
  });
});
