/**
 * Behavioral unit tests for UserProfileSection.
 *
 * Tested behaviours:
 *  1.  Section renders with profile data pre-filled (fullName, organization, bio).
 *  2.  Section renders with empty fields when profile is null.
 *  3.  Changing the Full Name input updates the displayed value.
 *  4.  Changing the Organization input updates the displayed value.
 *  5.  Changing the Bio input updates the displayed value.
 *  6.  Save button is labelled "Save Changes" when not loading.
 *  7.  Submitting the form calls apiClient.updateUserProfile with the
 *      correct payload (username, organization, bio).
 *  8.  While saving, the button shows "Saving..." and is disabled.
 *  9.  On success, toast.success is called.
 *  10. On API failure, toast.error is called and button returns to enabled.
 *  11. Submit is a no-op when userId is empty (early return guard).
 *
 * Skipped:
 *  - Exact toast message text (it goes through t() — value correctness is an
 *    i18n test, not a component test).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '@/test/utils/test-utils';
import UserProfileSection from '../UserProfileSection';
import type { Profile } from '@/types';

// sonner toast (imported as `import { toast } from 'sonner'` in component)
const mockToastSuccess = vi.fn();
const mockToastError = vi.fn();
vi.mock('sonner', () => ({
  toast: {
    success: (...args: unknown[]) => mockToastSuccess(...args),
    error: (...args: unknown[]) => mockToastError(...args),
  },
}));

// apiClient default export — the setup.ts already mocks `@/lib/api` globally;
// we re-mock here to control updateUserProfile per-test.
import apiClient from '@/lib/api';
const mockUpdateUserProfile = vi.mocked(apiClient.updateUserProfile);

// ── helpers ──────────────────────────────────────────────────────────────────

function makeProfile(overrides: Partial<Profile> = {}): Profile {
  return {
    id: 'p-1',
    email: 'user@example.com',
    username: 'Jane Doe',
    organization: 'UTIA',
    bio: 'Researcher',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    ...overrides,
  };
}

function setup(
  overrides: Partial<{ userId: string; profile: Profile | null }> = {}
) {
  return render(
    <UserProfileSection
      userId={overrides.userId ?? 'user-1'}
      profile={
        overrides.profile !== undefined ? overrides.profile : makeProfile()
      }
    />
  );
}

// ── tests ────────────────────────────────────────────────────────────────────

describe('UserProfileSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUpdateUserProfile.mockResolvedValue(undefined as never);
  });

  // 1
  it('pre-fills form fields from profile', () => {
    setup({
      profile: makeProfile({
        username: 'Alice',
        organization: 'CAS',
        bio: 'Biologist',
      }),
    });
    expect(screen.getByLabelText('Full Name')).toHaveValue('Alice');
    expect(screen.getByLabelText('Organization')).toHaveValue('CAS');
    expect(screen.getByDisplayValue('Biologist')).toBeInTheDocument();
  });

  // 2
  it('renders empty fields when profile is null', () => {
    setup({ profile: null });
    expect(screen.getByLabelText('Full Name')).toHaveValue('');
    expect(screen.getByLabelText('Organization')).toHaveValue('');
  });

  // 3
  it('updates Full Name field on user input', async () => {
    setup({ profile: makeProfile({ username: '' }) });
    const input = screen.getByLabelText('Full Name');
    await userEvent.clear(input);
    await userEvent.type(input, 'Bob');
    expect(input).toHaveValue('Bob');
  });

  // 4
  it('updates Organization field on user input', async () => {
    setup({ profile: makeProfile({ organization: '' }) });
    const input = screen.getByLabelText('Organization');
    await userEvent.type(input, 'NewOrg');
    expect(input).toHaveValue('NewOrg');
  });

  // 5
  it('updates Bio field on user input', async () => {
    setup({ profile: makeProfile({ bio: '' }) });
    const input = screen.getByDisplayValue('');
    await userEvent.type(input, 'My bio');
    // Bio input doesn't have an explicit label in the markup — select by current value
    expect(screen.getByDisplayValue('My bio')).toBeInTheDocument();
  });

  // 6
  it('save button is labelled "Save Changes" when not loading', () => {
    setup();
    expect(
      screen.getByRole('button', { name: 'Save Changes' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Save Changes' })
    ).not.toBeDisabled();
  });

  // 7
  it('calls apiClient.updateUserProfile with correct payload on submit', async () => {
    setup({
      userId: 'u-42',
      profile: makeProfile({
        username: 'Carol',
        organization: 'MIT',
        bio: 'Engineer',
      }),
    });
    await userEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    await waitFor(() => {
      expect(mockUpdateUserProfile).toHaveBeenCalledWith({
        username: 'Carol',
        organization: 'MIT',
        bio: 'Engineer',
      });
    });
  });

  // 8
  it('shows "Saving..." and disables button while request is pending', async () => {
    // Make the promise hang so we can observe intermediate state
    let resolve!: () => void;
    mockUpdateUserProfile.mockReturnValue(
      new Promise<never>(r => {
        resolve = r as () => void;
      })
    );

    setup();
    await userEvent.click(screen.getByRole('button', { name: 'Save Changes' }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Saving...' })).toBeDisabled();
    });

    // Resolve to clean up the pending promise
    resolve();
    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: 'Save Changes' })
      ).not.toBeDisabled();
    });
  });

  // 9
  it('calls toast.success on successful save', async () => {
    mockUpdateUserProfile.mockResolvedValue(undefined as never);
    setup();
    await userEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    await waitFor(() => expect(mockToastSuccess).toHaveBeenCalledTimes(1));
  });

  // 10
  it('calls toast.error on API failure and re-enables the button', async () => {
    mockUpdateUserProfile.mockRejectedValue(new Error('network error'));
    setup();
    await userEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    await waitFor(() => expect(mockToastError).toHaveBeenCalledTimes(1));
    expect(
      screen.getByRole('button', { name: 'Save Changes' })
    ).not.toBeDisabled();
  });

  // 11
  it('does nothing when userId is empty string', async () => {
    setup({ userId: '' });
    await userEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    await waitFor(() => {
      expect(mockUpdateUserProfile).not.toHaveBeenCalled();
    });
  });
});
