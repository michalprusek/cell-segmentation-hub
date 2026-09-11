/**
 * `RemoveChannelDialog` — the confirmation in front of a destructive write.
 *
 * What is worth testing here is the GUARD, not the layout. Removing a channel
 * deletes the per-frame PNGs, which for a channel added after upload are the
 * only copy; the menu item sits one row below "Add channel", so a misfire is
 * both easy and unrecoverable. Each test below names the production change
 * that would make it fail.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '@/test/utils/test-utils';
import { RemoveChannelDialog } from '@/components/project/RemoveChannelDialog';

const onConfirm = vi.fn();
const onCancel = vi.fn();

function setup(
  over: Partial<React.ComponentProps<typeof RemoveChannelDialog>> = {}
) {
  return render(
    <RemoveChannelDialog
      open
      channels={['IRM', 'TIRF_488']}
      segmentationSources={['IRM']}
      selectedCount={12}
      isSubmitting={false}
      onConfirm={onConfirm}
      onCancel={onCancel}
      {...over}
    />
  );
}

// Queried by testid, not by text: the dialog renders REAL translations, so
// matching on wording would tie these assertions to six locale files.
function confirmBox() {
  return screen.getByTestId('remove-channel-typed');
}
function confirmButton() {
  return screen.getByTestId('remove-channel-confirm');
}

beforeEach(() => vi.clearAllMocks());

describe('RemoveChannelDialog', () => {
  it('keeps confirm disabled until the channel name is typed exactly', async () => {
    // Would fail if `confirmArmed` dropped the typed comparison — i.e. if the
    // button were armed by picking a channel alone.
    const user = userEvent.setup();
    setup({ channels: ['IRM'] });

    const btn = confirmButton();
    expect(btn).toBeDisabled();

    await user.type(confirmBox(), 'IR');
    expect(confirmButton()).toBeDisabled();

    await user.type(confirmBox(), 'M');
    expect(confirmButton()).toBeEnabled();
  });

  it('does not arm on a near-miss', async () => {
    // Would fail if the comparison used `includes` or a case-insensitive
    // match — either would accept a different channel's name as confirmation.
    const user = userEvent.setup();
    setup({ channels: ['IRM'] });

    await user.type(confirmBox(), 'irm');
    expect(confirmButton()).toBeDisabled();
  });

  it('confirms with the selected channel name', async () => {
    const user = userEvent.setup();
    setup({ channels: ['IRM'] });

    await user.type(confirmBox(), 'IRM');
    await user.click(confirmButton());

    expect(onConfirm).toHaveBeenCalledWith('IRM');
  });

  it('warns when the chosen channel is a segmentation source', () => {
    // A container left with no segmentation source is silently never
    // segmented again, and nothing else in the UI says so.
    setup({ channels: ['IRM'], segmentationSources: ['IRM'] });
    expect(
      screen.getByTestId('remove-channel-seg-warning')
    ).toBeInTheDocument();
  });

  it('does not warn for a channel nothing segments from', () => {
    // The fixture has to DISCRIMINATE: a dialog that always warned would pass
    // the test above and be useless.
    setup({ channels: ['TIRF_488'], segmentationSources: ['IRM'] });
    expect(
      screen.queryByTestId('remove-channel-seg-warning')
    ).not.toBeInTheDocument();
  });

  it('clears a previously typed confirmation when reopened', async () => {
    // Would fail without the reset effect: the name left from a previous run
    // would arm the destructive button before the user read anything.
    const user = userEvent.setup();
    const { rerender } = setup({ channels: ['IRM'] });
    await user.type(confirmBox(), 'IRM');
    expect(confirmButton()).toBeEnabled();

    rerender(
      <RemoveChannelDialog
        open={false}
        channels={['IRM']}
        segmentationSources={[]}
        selectedCount={1}
        isSubmitting={false}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    );
    rerender(
      <RemoveChannelDialog
        open
        channels={['IRM']}
        segmentationSources={[]}
        selectedCount={1}
        isSubmitting={false}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    );

    expect(confirmBox()).toHaveValue('');
    expect(confirmButton()).toBeDisabled();
  });

  it('interpolates the channel name into the confirm label', () => {
    // This project's `t()` uses DOUBLE braces. A key written with single ones
    // type-checks, passes the i18n validator (the key exists in all six
    // files) and renders the literal "{channel}" to the user — which is what
    // shipped to a browser before this test existed. Nothing but reading the
    // rendered text catches it.
    // A single channel auto-selects, which is enough: what is under test is
    // the LABEL's interpolation, not the picker.
    setup({ channels: ['TIRF_488'], segmentationSources: [] });

    // The input's accessible name IS the interpolated label, so this asserts
    // the substitution rather than merely that the name appears somewhere.
    expect(confirmBox()).toHaveAccessibleName(/TIRF_488/);
    expect(document.body.textContent).not.toMatch(/\{\{?channel\}?\}/);
    expect(document.body.textContent).not.toMatch(/\{\{?frames\}?\}/);
  });

  it('does not preselect a channel when there is more than one', () => {
    // Preselecting would put a destructive default one keystroke away, and the
    // user might confirm a channel they never chose.
    setup();
    expect(confirmBox()).toBeDisabled();
  });
});
