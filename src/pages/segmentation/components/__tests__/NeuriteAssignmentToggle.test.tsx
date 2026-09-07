/**
 * The control that chooses what a stroke on a neurite frame MEANS.
 *
 * Two named modes rather than an on/off switch: "Colour by cell" ON told the
 * user what they were turning on and never what OFF meant, and the two
 * colourings answer different questions (`class` — is this segmentation right;
 * `assignment` — is this assignment right) rather than one being the absence of
 * the other.
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
  const onSetColorMode = vi.fn();
  const onAssign = vi.fn();
  render(
    <NeuriteAssignmentToggle
      colorMode="class"
      onSetColorMode={onSetColorMode}
      unassignedCount={0}
      onAssign={onAssign}
      isAssigning={false}
      canAssign
      {...props}
    />
  );
  return { onSetColorMode, onAssign };
}

const modeButton = (label: 'byClass' | 'byCell') =>
  screen.getByRole('button', {
    name: `segmentation.neurite.color.${label}`,
  });
const assignButton = () =>
  screen.getByRole('button', { name: /segmentation\.neurite\.assign$/ });
const unassigned = () =>
  screen.queryByText(/segmentation\.neurite\.unassignedCount/);

describe('NeuriteAssignmentToggle', () => {
  it('offers BOTH colourings by name, so neither is an unlabelled default', () => {
    setup();
    expect(modeButton('byClass')).toBeTruthy();
    expect(modeButton('byCell')).toBeTruthy();
  });

  it('reports a switch to the assignment colouring', async () => {
    const user = userEvent.setup();
    const { onSetColorMode } = setup({ colorMode: 'class' });

    await user.click(modeButton('byCell'));

    expect(onSetColorMode).toHaveBeenCalledWith('assignment');
  });

  it('reports a switch back to the class colouring', async () => {
    const user = userEvent.setup();
    const { onSetColorMode } = setup({ colorMode: 'assignment' });

    await user.click(modeButton('byClass'));

    expect(onSetColorMode).toHaveBeenCalledWith('class');
  });

  it('marks the active mode, and only that one', () => {
    // `aria-pressed` is the whole affordance here — the two buttons are
    // otherwise identical, so a user who cannot tell which is active is
    // looking at an unlabelled picture.
    setup({ colorMode: 'assignment' });
    expect(modeButton('byCell').getAttribute('aria-pressed')).toBe('true');
    expect(modeButton('byClass').getAttribute('aria-pressed')).toBe('false');
  });

  it('names how many neurites could not be assigned', () => {
    setup({ colorMode: 'assignment', unassignedCount: 7 });
    expect(unassigned()).toBeTruthy();
    expect(unassigned()!.textContent).toContain('7');
  });

  it('runs the assignment when the button is pressed', async () => {
    const user = userEvent.setup();
    const { onAssign } = setup();

    await user.click(assignButton());
    expect(onAssign).toHaveBeenCalledTimes(1);
  });

  it('is disabled while a run is in flight', async () => {
    // One run per frame takes tens of seconds on a large confocal field, and
    // the endpoint serialises on a single-slot executor — a second click would
    // only queue work behind the first.
    const user = userEvent.setup();
    const { onAssign } = setup({ isAssigning: true });

    expect(assignButton()).toBeDisabled();
    await user.click(assignButton());
    expect(onAssign).not.toHaveBeenCalled();
  });

  it('is disabled when the frame has no neurites to assign', () => {
    setup({ canAssign: false });
    expect(assignButton()).toBeDisabled();
  });

  it('says nothing when every neurite was assigned', () => {
    // Zero is not a warning, and rendering "0 could not be assigned" would
    // read as a problem where there is none.
    setup({ colorMode: 'assignment', unassignedCount: 0 });
    expect(unassigned()).toBeNull();
  });

  it('says nothing in the CLASS colouring', () => {
    // The count describes the colouring the user is looking at. In `class`
    // every neurite is cyan whether or not it has a soma, so the number would
    // caveat a picture that does not show it.
    setup({ colorMode: 'class', unassignedCount: 7 });
    expect(unassigned()).toBeNull();
  });
});
