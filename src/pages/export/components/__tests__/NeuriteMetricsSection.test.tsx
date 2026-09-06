/**
 * The neurite export section.
 *
 * The assertion that matters is the warning: turning the soma classifier off
 * is not a speed/accuracy trade, it changes which objects count as cells. A
 * user who does it without seeing that reads connection counts that are
 * systematically too high, and nothing downstream tells them so.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import NeuriteMetricsSection, {
  type NeuriteMetricsOptions,
} from '../NeuriteMetricsSection';

/** A neutral starting point for the fixtures below — NOT a claim about the
 *  product default, which lives in `AdvancedExportDialog`. */
const DEFAULTS: NeuriteMetricsOptions = { enabled: false, classify: true };

vi.mock('@/contexts/useLanguage', () => ({
  useLanguage: () => ({ t: (k: string) => k }),
}));

function setup(value: Partial<NeuriteMetricsOptions> = {}) {
  const onChange = vi.fn();
  render(
    <NeuriteMetricsSection
      value={{ ...DEFAULTS, ...value }}
      onChange={onChange}
    />
  );
  return { onChange };
}

const enableBox = () =>
  screen.getByRole('checkbox', { name: /neuriteMetrics\.enable/ });
const classifyBox = () =>
  screen.queryByRole('checkbox', { name: /neuriteMetrics\.classify/ });
const warning = () =>
  screen.queryByText('export.neuriteMetrics.classifyOffWarning');

describe('NeuriteMetricsSection', () => {
  // NOT tested here: that the export defaults to OFF and the classifier to ON.
  // `NEURITE_METRICS_DEFAULTS` lives in `AdvancedExportDialog` (the section file
  // must export only its component, or fast refresh breaks for the module), and
  // restating the values in this file would only assert that a local constant
  // equals itself. The dialog owns that claim.

  it('hides the classifier toggle until the export is enabled', () => {
    setup({ enabled: false });
    expect(classifyBox()).toBeNull();
  });

  it('shows the classifier toggle when enabled', () => {
    setup({ enabled: true });
    expect(classifyBox()).toBeTruthy();
  });

  it('does not warn while the classifier is on', () => {
    setup({ enabled: true, classify: true });
    expect(warning()).toBeNull();
  });

  it('warns when the classifier is switched off', () => {
    // The whole reason this control is a checkbox and not a silent default.
    setup({ enabled: true, classify: false });
    expect(warning()).toBeTruthy();
  });

  it('never warns while the export itself is off', () => {
    // Nothing is being computed, so there is nothing to caveat.
    setup({ enabled: false, classify: false });
    expect(warning()).toBeNull();
  });

  it('reports the enable toggle without dropping the classifier setting', async () => {
    const user = userEvent.setup();
    const { onChange } = setup({ enabled: false, classify: false });

    await user.click(enableBox());

    expect(onChange).toHaveBeenCalledWith({ enabled: true, classify: false });
  });

  it('reports the classifier toggle', async () => {
    // NOTE the claim this test does NOT make. `onChange({ ...value, classify })`
    // and `onChange({ enabled: true, classify })` are indistinguishable here,
    // because the control only renders when `enabled` is already true — a
    // mutation between them survives, and no fixture can kill it. The spread is
    // still the right code (it would carry a third option through), but this
    // file cannot claim to protect it.
    const user = userEvent.setup();
    const { onChange } = setup({ enabled: true, classify: true });

    await user.click(classifyBox()!);

    expect(onChange).toHaveBeenCalledWith({ enabled: true, classify: false });
  });
});
