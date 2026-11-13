import { screen } from '@testing-library/react';
import type { UserEvent } from '@testing-library/user-event';

/** jsdom lacks these; Radix Select calls them while it is open. */
const JSDOM_GAPS = {
  hasPointerCapture: () => false,
  releasePointerCapture: () => {},
  scrollIntoView: () => {},
} as const;

/**
 * Pick a project type in the create dialog's Radix Select, the way a user
 * does: open the picker, click the option. Shared by every test that drives
 * the REAL dialog, since a project can no longer be created without one.
 *
 * The jsdom gaps Radix needs are filled only for the two clicks and removed
 * again, so no later test — in this file or any other — comes to depend on
 * them unknowingly. Only what jsdom lacked is removed; a real implementation
 * is never touched.
 */
export const chooseProjectType = async (user: UserEvent, label: string) => {
  const proto = Element.prototype as unknown as Record<string, unknown>;
  const added = Object.entries(JSDOM_GAPS)
    .filter(([name]) => !(name in proto))
    .map(([name, stub]) => {
      proto[name] = stub;
      return name;
    });

  try {
    await user.click(screen.getByRole('combobox', { name: 'Project Type' }));
    await user.click(await screen.findByRole('option', { name: label }));
  } finally {
    for (const name of added) delete proto[name];
  }
};
