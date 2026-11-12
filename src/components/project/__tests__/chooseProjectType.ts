import { screen } from '@testing-library/react';
import type { UserEvent } from '@testing-library/user-event';

/**
 * Pick a project type in the create dialog's Radix Select, the way a user
 * does: open the picker, click the option. Shared by every test that drives
 * the REAL dialog, since a project can no longer be created without one.
 *
 * jsdom lacks the pointer-capture and scrollIntoView APIs Radix calls; they
 * are stubbed here rather than in the global setup so no other suite starts
 * depending on them unknowingly.
 */
export const chooseProjectType = async (user: UserEvent, label: string) => {
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};

  await user.click(screen.getByRole('combobox', { name: 'Project Type' }));
  await user.click(await screen.findByRole('option', { name: label }));
};
