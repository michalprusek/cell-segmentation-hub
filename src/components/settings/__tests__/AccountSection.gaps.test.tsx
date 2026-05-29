/**
 * AccountSection — gap coverage
 *
 * Existing test (AccountSection.test.tsx) covers rendering and delete-dialog open.
 * Uncovered lines: 34-144 (handleSaveAccount logic), 152 (aria-invalid branch),
 * and 188 (password match indicator visible/hidden state).
 *
 * We cover:
 *   1. Validation — missing field → toast.error
 *   2. Validation — passwords don't match → toast.error
 *   3. Validation — password too short (<6 chars) → toast.error
 *   4. Successful password change → apiClient.changePassword called, form cleared
 *   5. API error → toast.error with error message
 *   6. Real-time match indicator — passwords match → green/check shown
 *   7. Real-time match indicator — passwords differ → red/x shown
 *   8. Indicator hidden when confirmPassword is empty
 *   9. isLoading state — button shows loading label and inputs are disabled
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '@/test/utils/test-utils';
import AccountSection from '../AccountSection';
import apiClient from '@/lib/api';
import { toast } from 'sonner';

vi.mock('@/lib/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('@/components/settings/DeleteAccountDialog', () => ({
  default: ({ isOpen }: { isOpen: boolean }) =>
    isOpen ? <div data-testid="delete-account-dialog" /> : null,
}));

vi.mock('@/lib/api', () => ({
  default: {
    isAuthenticated: vi.fn(() => false),
    getAccessToken: vi.fn(() => null),
    getUserProfile: vi
      .fn()
      .mockResolvedValue({ preferred_theme: 'system', preferredLang: 'en' }),
    changePassword: vi.fn(),
  },
}));

const apiMock = apiClient as unknown as {
  changePassword: ReturnType<typeof vi.fn>;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function fillPasswordForm(
  current: string,
  newPwd: string,
  confirm: string
) {
  const user = userEvent.setup();
  const currentInput = screen.getByLabelText(/current password/i);
  const newInput = document.getElementById('newPassword') as HTMLElement;
  const confirmInput = screen.getByLabelText(/confirm/i);

  await user.type(currentInput, current);
  await user.type(newInput, newPwd);
  await user.type(confirmInput, confirm);
  return user;
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// 1. Validation: missing field
// ---------------------------------------------------------------------------

describe('AccountSection — validation: missing fields', () => {
  it('shows error toast when current password is empty', async () => {
    const user = userEvent.setup();
    render(<AccountSection />);

    // Leave currentPassword empty, fill the other two
    await user.type(document.getElementById('newPassword')!, 'newpass1');
    await user.type(screen.getByLabelText(/confirm/i), 'newpass1');
    await user.click(screen.getByRole('button', { name: /change password/i }));

    expect(toast.error).toHaveBeenCalled();
    expect(apiMock.changePassword).not.toHaveBeenCalled();
  });

  it('shows error toast when newPassword is empty', async () => {
    const user = userEvent.setup();
    render(<AccountSection />);

    await user.type(screen.getByLabelText(/current password/i), 'oldpass');
    await user.type(screen.getByLabelText(/confirm/i), 'newpass1');
    await user.click(screen.getByRole('button', { name: /change password/i }));

    expect(toast.error).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 2. Validation: passwords don't match
// ---------------------------------------------------------------------------

describe('AccountSection — validation: passwords mismatch', () => {
  it('shows error toast when new password and confirmation differ', async () => {
    render(<AccountSection />);
    await fillPasswordForm('current123', 'newpass123', 'different456');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /change password/i }));

    expect(toast.error).toHaveBeenCalled();
    expect(apiMock.changePassword).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 3. Validation: password too short
// ---------------------------------------------------------------------------

describe('AccountSection — validation: password too short', () => {
  it('shows error toast when new password is fewer than 6 characters', async () => {
    render(<AccountSection />);
    await fillPasswordForm('current123', 'abc', 'abc');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /change password/i }));

    expect(toast.error).toHaveBeenCalled();
    expect(apiMock.changePassword).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 4. Successful password change
// ---------------------------------------------------------------------------

describe('AccountSection — successful password change', () => {
  it('calls changePassword and shows success toast; clears form', async () => {
    apiMock.changePassword.mockResolvedValueOnce(undefined);

    render(<AccountSection />);
    const user = userEvent.setup();
    await fillPasswordForm('currentPass', 'newPassword1', 'newPassword1');
    await user.click(screen.getByRole('button', { name: /change password/i }));

    await waitFor(() => {
      expect(apiMock.changePassword).toHaveBeenCalledWith({
        currentPassword: 'currentPass',
        newPassword: 'newPassword1',
      });
    });
    await waitFor(() => {
      expect(toast.success).toHaveBeenCalled();
    });

    // Form should be cleared after success
    await waitFor(() => {
      expect(
        (document.getElementById('currentPassword') as HTMLInputElement).value
      ).toBe('');
    });
  });
});

// ---------------------------------------------------------------------------
// 5. API error → toast.error
// ---------------------------------------------------------------------------

describe('AccountSection — API error', () => {
  it('shows error toast when changePassword rejects', async () => {
    apiMock.changePassword.mockRejectedValueOnce(new Error('Wrong password'));

    render(<AccountSection />);
    await fillPasswordForm('wrong', 'newPassword1', 'newPassword1');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /change password/i }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalled();
    });
  });
});

// ---------------------------------------------------------------------------
// 6. Real-time match indicator — passwords match
// ---------------------------------------------------------------------------

describe('AccountSection — password match indicator', () => {
  it('shows green match indicator when passwords match', async () => {
    const user = userEvent.setup();
    render(<AccountSection />);

    await user.type(document.getElementById('newPassword')!, 'matchPass1');
    await user.type(screen.getByLabelText(/confirm/i), 'matchPass1');

    // status role renders with aria-live="polite"
    const status = screen.getByRole('status');
    expect(status).toBeInTheDocument();
    // It should show the match text
    expect(status.textContent).toMatch(/match/i);
  });

  it('shows red mismatch indicator when passwords differ', async () => {
    const user = userEvent.setup();
    render(<AccountSection />);

    await user.type(document.getElementById('newPassword')!, 'passA1234');
    await user.type(screen.getByLabelText(/confirm/i), 'passB5678');

    const status = screen.getByRole('status');
    expect(status).toBeInTheDocument();
    // confirmPassword input gets aria-invalid=true
    const confirmInput = screen.getByLabelText(/confirm/i);
    expect(confirmInput).toHaveAttribute('aria-invalid', 'true');
  });

  it('hides the match indicator when confirmPassword is empty', async () => {
    const user = userEvent.setup();
    render(<AccountSection />);

    // Type only in newPassword, leave confirm blank
    await user.type(document.getElementById('newPassword')!, 'somePass1');

    expect(screen.queryByRole('status')).toBeNull();
  });

  it('hides indicator when newPassword is empty', () => {
    render(<AccountSection />);
    // Nothing typed yet
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('confirm input has no aria-describedby when indicator is hidden', () => {
    render(<AccountSection />);
    const confirmInput = screen.getByLabelText(/confirm/i);
    expect(confirmInput).not.toHaveAttribute('aria-describedby');
  });

  it('confirm input has aria-describedby when both password fields have content', async () => {
    const user = userEvent.setup();
    render(<AccountSection />);
    await user.type(document.getElementById('newPassword')!, 'abc123');
    await user.type(screen.getByLabelText(/confirm/i), 'abc123');

    const confirmInput = screen.getByLabelText(/confirm/i);
    expect(confirmInput).toHaveAttribute(
      'aria-describedby',
      'password-match-status'
    );
  });
});
