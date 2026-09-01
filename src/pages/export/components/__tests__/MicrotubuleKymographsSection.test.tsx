/**
 * MicrotubuleKymographsSection — the line-width control.
 *
 * The export used to render every kymograph at width 1 while the editor modal
 * offered a width picker, so the picture on screen and the picture in the zip
 * could disagree. These cover the control that closes that seam:
 *
 *  - it is offered in BOTH output modes, because the ML service renders the
 *    profile plots from the same sampled matrix the kymograph is a heatmap of;
 *  - a valid width propagates, an invalid one does not, and blur snaps back
 *    (the same contract as `MicrotubuleMetricsSection`'s inputs);
 *  - the reduction picker appears only above width 1, where it can change a
 *    pixel, and shows the value it was given.
 */

import React, { useState } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { render } from '@/test/utils/test-utils';

import {
  MicrotubuleKymographsSection,
  type MicrotubuleKymographsOptions,
  type MicrotubuleKymographsSectionProps,
} from '../MicrotubuleKymographsSection';

function makeValue(
  overrides: Partial<MicrotubuleKymographsOptions> = {}
): MicrotubuleKymographsOptions {
  return {
    enabled: true,
    mode: 'kymograph',
    includeVelocityMetrics: true,
    includeSegmentedImages: true,
    lineWidth: 1,
    lineReduce: 'mean',
    ...overrides,
  };
}

/** Controlled wrapper, so a change is reflected back into the component the way
 *  the export dialog reflects it. */
function Wrapper({
  initial,
  canBuildKymograph = true,
  onChange,
}: {
  initial: MicrotubuleKymographsOptions;
  canBuildKymograph?: boolean;
  onChange?: MicrotubuleKymographsSectionProps['onChange'];
}) {
  const [value, setValue] = useState(initial);
  return (
    <MicrotubuleKymographsSection
      value={value}
      canBuildKymograph={canBuildKymograph}
      onChange={next => {
        setValue(next);
        onChange?.(next);
      }}
    />
  );
}

function setup(
  initial: MicrotubuleKymographsOptions = makeValue(),
  canBuildKymograph = true
) {
  const onChange = vi.fn();
  const utils = render(
    <Wrapper
      initial={initial}
      canBuildKymograph={canBuildKymograph}
      onChange={onChange}
    />
  );
  return { onChange, ...utils };
}

const widthInput = () => screen.getByLabelText(/line width/i);

describe('MicrotubuleKymographsSection line width', () => {
  it('shows the current width in kymograph mode', () => {
    setup(makeValue({ lineWidth: 7 }));
    expect(widthInput()).toHaveValue(7);
  });

  it('shows it in profiles mode too — a profile is a row of the same matrix', () => {
    setup(makeValue({ mode: 'profiles', lineWidth: 7 }));
    expect(widthInput()).toHaveValue(7);
  });

  it('is hidden until the kymograph export is enabled', () => {
    setup(makeValue({ enabled: false }));
    expect(screen.queryByLabelText(/line width/i)).not.toBeInTheDocument();
  });

  it('propagates a valid width', () => {
    const { onChange } = setup();
    fireEvent.change(widthInput(), { target: { value: '5' } });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ lineWidth: 5 })
    );
  });

  it('does not propagate a width outside 1…51, nor a decimal', () => {
    const { onChange } = setup();
    for (const value of ['0', '52', '5.5']) {
      fireEvent.change(widthInput(), { target: { value } });
    }
    expect(onChange).not.toHaveBeenCalled();
  });

  it('snaps back on blur when the field was left invalid', () => {
    setup(makeValue({ lineWidth: 3 }));
    fireEvent.change(widthInput(), { target: { value: '' } });
    fireEvent.blur(widthInput());
    expect(widthInput()).toHaveValue(3);
  });

  it('offers the reduction only above width 1, and shows the given value', () => {
    const { unmount } = setup(makeValue({ lineWidth: 1 }));
    // At width 1 there is one sample, so the choice cannot change a pixel.
    expect(screen.queryByLabelText(/across width/i)).not.toBeInTheDocument();
    unmount();

    setup(makeValue({ lineWidth: 5, lineReduce: 'max' }));
    expect(screen.getByLabelText(/across width/i)).toHaveTextContent('Max');
  });
});
