/**
 * The neurite export section.
 *
 * The assertion that matters is the warning: turning the soma classifier off
 * is not a speed/accuracy trade, it changes which objects count as cells. A
 * user who does it without seeing that reads connection counts that are
 * systematically too high, and nothing downstream tells them so.
 *
 * There is no "enable" checkbox any more. Gating the report behind one did not
 * mean "no report" — the standard closed-polygon exporter did not step aside,
 * so a neurite project exported Sphericity per dendrite instead. The two
 * sheets are simply what this project type's metrics are.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import NeuriteMetricsSection, {
  type NeuriteMetricsOptions,
} from '../NeuriteMetricsSection';

/** A neutral starting point for the fixtures below — NOT a claim about the
 *  product default, which lives in `AdvancedExportDialog`. */
const DEFAULTS: NeuriteMetricsOptions = { classify: true };

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

const classifyBox = () =>
  screen.queryByRole('checkbox', { name: /neuriteMetrics\.classify/ });
const warning = () =>
  screen.queryByText('export.neuriteMetrics.classifyOffWarning');

describe('NeuriteMetricsSection', () => {
  it('offers the classifier toggle with no export toggle in front of it', () => {
    // Would fail if the "enable" checkbox came back: the classifier control
    // used to be hidden behind it, so a user landing here saw nothing to set.
    setup();
    expect(classifyBox()).toBeInTheDocument();
    expect(
      screen.queryByRole('checkbox', { name: /neuriteMetrics\.enable$/ })
    ).not.toBeInTheDocument();
  });

  it('does not warn while the classifier is on', () => {
    setup({ classify: true });
    expect(warning()).not.toBeInTheDocument();
  });

  it('warns when the classifier is switched off', () => {
    setup({ classify: false });
    expect(warning()).toBeInTheDocument();
  });

  it('reports the classifier toggle', async () => {
    const user = userEvent.setup();
    const { onChange } = setup({ classify: true });
    await user.click(classifyBox()!);
    expect(onChange).toHaveBeenCalledWith({ classify: false });
  });
});
