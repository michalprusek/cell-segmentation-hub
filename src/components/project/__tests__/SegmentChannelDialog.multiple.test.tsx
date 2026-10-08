/**
 * `SegmentChannelDialog` in its two modes.
 *
 * The mode decides the SHAPE of what is confirmed — one name as a string, or
 * the ticked channels as an array — and the API client keys the request on
 * that shape. So a regression here does not look like a broken dialog; it
 * looks like the wrong channels being segmented.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '@/test/utils/test-utils';
import { SegmentChannelDialog } from '@/components/project/SegmentChannelDialog';

const onConfirm = vi.fn();
const onCancel = vi.fn();
const CHANNELS = ['Channel_1', 'Channel_2', 'Channel_3'];

function setup(
  over: Partial<React.ComponentProps<typeof SegmentChannelDialog>> = {}
) {
  return render(
    <SegmentChannelDialog
      open
      channels={CHANNELS}
      defaultChannel=""
      onConfirm={onConfirm}
      onCancel={onCancel}
      {...over}
    />
  );
}

const confirmButton = () =>
  screen.getByRole('button', { name: /channelPicker\.confirm|segment/i });

beforeEach(() => {
  onConfirm.mockReset();
  onCancel.mockReset();
});

describe('merging model: checkboxes', () => {
  it('ticks nothing on open and will not confirm an empty choice', () => {
    setup({ multiple: true, defaultChannel: 'Channel_2' });
    const boxes = screen.getAllByRole('checkbox');
    expect(boxes).toHaveLength(3);
    // Not even the container's marked source: a default the user merely
    // confirms is the dangerous one.
    for (const box of boxes) {
      expect(box).toHaveAttribute('aria-checked', 'false');
    }
    expect(screen.queryByRole('radio')).toBeNull();
    expect(confirmButton()).toBeDisabled();
  });

  it('confirms with every ticked channel, in LISTED order, as an array', async () => {
    const user = userEvent.setup();
    setup({ multiple: true });
    // Ticked in the opposite order to the list.
    await user.click(screen.getByRole('checkbox', { name: 'Channel_3' }));
    await user.click(screen.getByRole('checkbox', { name: 'Channel_1' }));
    await user.click(confirmButton());
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledWith(['Channel_1', 'Channel_3']);
  });

  it('a single ticked channel is still an array', async () => {
    const user = userEvent.setup();
    setup({ multiple: true });
    await user.click(screen.getByRole('checkbox', { name: 'Channel_2' }));
    await user.click(confirmButton());
    expect(onConfirm).toHaveBeenCalledWith(['Channel_2']);
  });

  it('unticking the last channel disables Confirm again', async () => {
    const user = userEvent.setup();
    setup({ multiple: true });
    const box = screen.getByRole('checkbox', { name: 'Channel_2' });
    await user.click(box);
    expect(confirmButton()).toBeEnabled();
    await user.click(box);
    expect(confirmButton()).toBeDisabled();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('forgets the previous choice when it is opened again', async () => {
    const user = userEvent.setup();
    const view = setup({ multiple: true });
    await user.click(screen.getByRole('checkbox', { name: 'Channel_1' }));
    const props = {
      channels: CHANNELS,
      defaultChannel: '',
      multiple: true,
      onConfirm,
      onCancel,
    };
    view.rerender(<SegmentChannelDialog open={false} {...props} />);
    view.rerender(<SegmentChannelDialog open {...props} />);
    expect(screen.getByRole('checkbox', { name: 'Channel_1' })).toHaveAttribute(
      'aria-checked',
      'false'
    );
  });

  it('says that the channels are merged', () => {
    setup({ multiple: true });
    expect(
      screen.getByText(/channelPicker\.titleMerge|merge/i, {
        selector: 'h2',
      })
    ).toBeInTheDocument();
  });
});

describe('every other model: one channel', () => {
  it('offers radios and confirms with a STRING', async () => {
    const user = userEvent.setup();
    setup();
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(confirmButton()).toBeDisabled();
    await user.click(screen.getByRole('radio', { name: 'Channel_2' }));
    await user.click(confirmButton());
    expect(onConfirm).toHaveBeenCalledWith('Channel_2');
  });

  it('preselects the marked source', () => {
    setup({ defaultChannel: 'Channel_3' });
    expect(screen.getByRole('radio', { name: 'Channel_3' })).toBeChecked();
    expect(confirmButton()).toBeEnabled();
  });
});
