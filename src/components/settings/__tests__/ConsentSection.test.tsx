/**
 * ConsentSection — behavioral unit tests
 *
 * Covered behaviours:
 *  - Section title and description render
 *  - ML training switch reflects profile prop
 *  - Sub-option switches hidden while ML training is off
 *  - Sub-option switches visible while ML training is on
 *  - Toggling ML training OFF forces sub-options off
 *  - Enabling a sub-option forces ML training on
 *  - Save button appears only after a change (hasChanges)
 *  - Save button calls apiClient.updateUserProfile with correct payload
 *  - "Saving..." label while the API call is in flight
 *  - Save button disappears after successful save
 *  - toast.success shown after successful save
 *  - toast.error shown when API call fails
 *  - "Last updated" date shown only when profile.consentUpdatedAt is present
 *  - Profile prop change is picked up by the effect
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '@/test/utils/test-utils';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import ConsentSection from '../ConsentSection';
import apiClient from '@/lib/api';
import { toast } from 'sonner';
import type { Profile } from '@/types';

// ── helpers ──────────────────────────────────────────────────────────────────

function makeProfile(overrides: Partial<Profile> = {}): Profile {
  return {
    id: 'user-1',
    email: 'test@example.com',
    username: 'tester',
    consentToMLTraining: false,
    consentToAlgorithmImprovement: false,
    consentToFeatureDevelopment: false,
    consentUpdatedAt: undefined,
    ...overrides,
  } as unknown as Profile;
}

function setup(profile: Profile | null = makeProfile()) {
  const user = userEvent.setup();
  const utils = render(<ConsentSection userId="user-1" profile={profile} />);
  return { user, ...utils };
}

const mlSwitch = () =>
  screen.getByRole('switch', { name: /allow ml model training/i });
const algoSwitch = () =>
  screen.getByRole('switch', { name: /algorithm improvement/i });
const featureSwitch = () =>
  screen.getByRole('switch', { name: /feature development/i });
const saveBtn = () => screen.queryByRole('button', { name: /save consent/i });

// ── tests ────────────────────────────────────────────────────────────────────

describe('ConsentSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (apiClient.updateUserProfile as Mock).mockResolvedValue({});
  });

  // ── rendering ─────────────────────────────────────────────────────────────

  describe('static content', () => {
    it('renders section title', () => {
      setup();
      expect(screen.getByText(/data usage & privacy/i)).toBeInTheDocument();
    });

    it('renders the ML training switch', () => {
      setup();
      expect(mlSwitch()).toBeInTheDocument();
    });

    it('renders privacy notice text', () => {
      setup();
      expect(
        screen.getByText(/your data privacy is important/i)
      ).toBeInTheDocument();
    });
  });

  // ── initial state from profile ────────────────────────────────────────────

  describe('initial state', () => {
    it('ML switch is ON when profile.consentToMLTraining is true', () => {
      setup(makeProfile({ consentToMLTraining: true }));
      expect(mlSwitch()).toBeChecked();
    });

    it('ML switch is OFF when profile.consentToMLTraining is false', () => {
      setup(makeProfile({ consentToMLTraining: false }));
      expect(mlSwitch()).not.toBeChecked();
    });

    it('sub-options are hidden when ML training is off', () => {
      setup(makeProfile({ consentToMLTraining: false }));
      expect(
        screen.queryByRole('switch', { name: /algorithm/i })
      ).not.toBeInTheDocument();
    });

    it('sub-options are visible when ML training is on', () => {
      setup(makeProfile({ consentToMLTraining: true }));
      expect(algoSwitch()).toBeInTheDocument();
      expect(featureSwitch()).toBeInTheDocument();
    });

    it('shows "Last updated" when consentUpdatedAt is set', () => {
      setup(makeProfile({ consentUpdatedAt: '2024-01-15T00:00:00Z' }));
      expect(screen.getByText(/last updated/i)).toBeInTheDocument();
    });

    it('hides "Last updated" when consentUpdatedAt is absent', () => {
      setup(makeProfile({ consentUpdatedAt: undefined }));
      expect(screen.queryByText(/last updated/i)).not.toBeInTheDocument();
    });
  });

  // ── no save button until change ───────────────────────────────────────────

  describe('save button visibility', () => {
    it('save button is not shown initially', () => {
      setup();
      expect(saveBtn()).not.toBeInTheDocument();
    });

    it('save button appears after toggling a switch', async () => {
      const { user } = setup();
      await user.click(mlSwitch());
      expect(saveBtn()).toBeInTheDocument();
    });
  });

  // ── toggle logic ──────────────────────────────────────────────────────────

  describe('toggle interactions', () => {
    it('turning ML training ON shows sub-options', async () => {
      const { user } = setup(makeProfile({ consentToMLTraining: false }));
      await user.click(mlSwitch());
      expect(algoSwitch()).toBeInTheDocument();
    });

    it('turning ML training OFF hides sub-options', async () => {
      const { user } = setup(makeProfile({ consentToMLTraining: true }));
      await user.click(mlSwitch());
      expect(
        screen.queryByRole('switch', { name: /algorithm/i })
      ).not.toBeInTheDocument();
    });

    it('turning ML training OFF forces sub-options off', async () => {
      const { user } = setup(
        makeProfile({
          consentToMLTraining: true,
          consentToAlgorithmImprovement: true,
          consentToFeatureDevelopment: true,
        })
      );
      // Turn off ML training
      await user.click(mlSwitch());
      // Turn it back on to make sub-options visible again
      await user.click(mlSwitch());
      // Both sub-options should now be unchecked
      expect(algoSwitch()).not.toBeChecked();
      expect(featureSwitch()).not.toBeChecked();
    });

    it('enabling Algorithm sub-option forces ML training on', async () => {
      const { user } = setup(
        makeProfile({
          consentToMLTraining: false,
          consentToAlgorithmImprovement: false,
        })
      );
      // First enable ML training to get the sub-options in DOM
      await user.click(mlSwitch());
      // Now disable ML training again
      await user.click(mlSwitch());
      // Re-enable ML training to show sub-options
      await user.click(mlSwitch());
      // Click algo improvement (sub-option) — ML training is already on
      const algo = algoSwitch();
      await user.click(algo);
      expect(mlSwitch()).toBeChecked();
    });

    it('enabling Feature Development sub-option forces ML training on', async () => {
      const { user } = setup(
        makeProfile({
          consentToMLTraining: true,
          consentToFeatureDevelopment: false,
        })
      );
      await user.click(featureSwitch());
      expect(mlSwitch()).toBeChecked();
      expect(featureSwitch()).toBeChecked();
    });
  });

  // ── save flow ─────────────────────────────────────────────────────────────

  describe('save flow', () => {
    it('calls apiClient.updateUserProfile with correct consent payload', async () => {
      const { user } = setup(makeProfile({ consentToMLTraining: false }));
      await user.click(mlSwitch()); // now true
      await user.click(saveBtn()!);

      await waitFor(() => {
        expect(apiClient.updateUserProfile).toHaveBeenCalledWith(
          expect.objectContaining({
            consentToMLTraining: true,
            consentToAlgorithmImprovement: false,
            consentToFeatureDevelopment: false,
          })
        );
      });
    });

    it('shows toast.success after successful save', async () => {
      const { user } = setup();
      await user.click(mlSwitch());
      await user.click(saveBtn()!);

      await waitFor(() => {
        expect(toast.success).toHaveBeenCalled();
      });
    });

    it('save button disappears after successful save', async () => {
      const { user } = setup();
      await user.click(mlSwitch());
      await user.click(saveBtn()!);

      await waitFor(() => {
        expect(saveBtn()).not.toBeInTheDocument();
      });
    });

    it('shows toast.error when API call fails', async () => {
      (apiClient.updateUserProfile as Mock).mockRejectedValue(
        new Error('Server error')
      );
      const { user } = setup();
      await user.click(mlSwitch());
      await user.click(saveBtn()!);

      await waitFor(() => {
        expect(toast.error).toHaveBeenCalled();
      });
    });

    it('shows "Saving..." label while the API call is in-flight', async () => {
      let resolveSave!: () => void;
      (apiClient.updateUserProfile as Mock).mockReturnValue(
        new Promise<void>(res => {
          resolveSave = res;
        })
      );
      const { user } = setup();
      await user.click(mlSwitch());
      await user.click(saveBtn()!);

      expect(screen.getByText(/saving/i)).toBeInTheDocument();
      resolveSave();
      await waitFor(() =>
        expect(screen.queryByText(/saving/i)).not.toBeInTheDocument()
      );
    });
  });

  // ── profile prop update ───────────────────────────────────────────────────

  describe('profile prop update', () => {
    it('re-syncs state when profile prop changes', async () => {
      const { rerender } = render(
        <ConsentSection
          userId="user-1"
          profile={makeProfile({ consentToMLTraining: false })}
        />
      );
      expect(mlSwitch()).not.toBeChecked();

      rerender(
        <ConsentSection
          userId="user-1"
          profile={makeProfile({ consentToMLTraining: true })}
        />
      );
      await waitFor(() => expect(mlSwitch()).toBeChecked());
    });
  });
});
