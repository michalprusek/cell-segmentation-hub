/**
 * The switch between the two colourings a neurite frame can have.
 *
 * The assertion that earns its keep is the unassigned count: a neurite with no
 * soma is a RESULT, not a gap, and without the number a user would have to hunt
 * for cyan strokes among the coloured ones to find out how much of the frame
 * the assignment could not resolve.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import NeuriteAssignmentToggle from '../NeuriteAssignmentToggle';

vi.mock('@/contexts/useLanguage', () => ({
  useLanguage: () => ({
    // Return the key plus any interpolation, so a count assertion can see the
    // number without depending on a translated sentence.
    t: (k: string, vars?: Record<string, unknown>) =>
      vars ? `${k}:${JSON.stringify(vars)}` : k,
  }),
}));

function setup(
  props: Partial<React.ComponentProps<typeof NeuriteAssignmentToggle>> = {}
) {
  const onSetColorBySoma = vi.fn();
  render(
    <NeuriteAssignmentToggle
      colorBySoma={false}
      onSetColorBySoma={onSetColorBySoma}
      unassignedCount={0}
      onAssign={vi.fn()}
      isAssigning={false}
      canAssign
      {...props}
    />
  );
  return { onSetColorBySoma };
}

const toggle = () => screen.getByRole('switch');
const unassigned = () =>
  screen.queryByText(/segmentation\.neurite\.unassignedCount/);

describe('NeuriteAssignmentToggle', () => {
  it('reports the switch flipping on', async () => {
    const user = userEvent.setup();
    const { onSetColorBySoma } = setup({ colorBySoma: false });

    await user.click(toggle());

    expect(onSetColorBySoma).toHaveBeenCalledWith(true);
  });

  it('reports it flipping off', async () => {
    const user = userEvent.setup();
    const { onSetColorBySoma } = setup({ colorBySoma: true });

    await user.click(toggle());

    expect(onSetColorBySoma).toHaveBeenCalledWith(false);
  });

  it('names how many neurites could not be assigned', async () => {
    setup({ colorBySoma: true, unassignedCount: 7 });
    expect(unassigned()).toBeTruthy();
    expect(unassigned()!.textContent).toContain('7');
  });

  it('runs the assignment when the button is pressed', async () => {
    const user = userEvent.setup();
    const onAssign = vi.fn();
    render(
      <NeuriteAssignmentToggle
        colorBySoma={false}
        onSetColorBySoma={vi.fn()}
        unassignedCount={0}
        onAssign={onAssign}
        isAssigning={false}
        canAssign
      />
    );

    await user.click(screen.getByRole('button'));
    expect(onAssign).toHaveBeenCalledTimes(1);
  });

  it('is disabled while a run is in flight', async () => {
    // One run per frame takes tens of seconds on a large confocal field, and
    // the endpoint serialises on a single-slot executor — a second click would
    // only queue work behind the first.
    const user = userEvent.setup();
    const onAssign = vi.fn();
    render(
      <NeuriteAssignmentToggle
        colorBySoma={false}
        onSetColorBySoma={vi.fn()}
        unassignedCount={0}
        onAssign={onAssign}
        isAssigning
        canAssign
      />
    );

    expect(screen.getByRole('button')).toBeDisabled();
    await user.click(screen.getByRole('button'));
    expect(onAssign).not.toHaveBeenCalled();
  });

  it('is disabled when the frame has no neurites to assign', () => {
    render(
      <NeuriteAssignmentToggle
        colorBySoma={false}
        onSetColorBySoma={vi.fn()}
        unassignedCount={0}
        onAssign={vi.fn()}
        isAssigning={false}
        canAssign={false}
      />
    );
    expect(screen.getByRole('button')).toBeDisabled();
  });

  it('says nothing when every neurite was assigned', () => {
    // Zero is not a warning, and rendering "0 could not be assigned" would
    // read as a problem where there is none.
    setup({ colorBySoma: true, unassignedCount: 0 });
    expect(unassigned()).toBeNull();
  });

  it('says nothing while the colouring is off', () => {
    // The count describes the colouring the user is looking at. Announcing it
    // over the class colouring would caveat a picture it does not describe.
    setup({ colorBySoma: false, unassignedCount: 7 });
    expect(unassigned()).toBeNull();
  });
});
