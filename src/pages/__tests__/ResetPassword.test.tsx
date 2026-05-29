/**
 * ResetPassword page unit tests.
 *
 * Tested behaviors:
 * - Without token in URL: shows "Invalid Reset Link" screen
 * - With token: renders the password reset form
 * - Empty password shows toast and does NOT call API
 * - Password shorter than 8 chars shows passwordTooShort toast and does NOT call API
 * - Mismatched confirm-password shows toast and does NOT call API
 * - Valid submission calls POST /auth/reset-password with { token, newPassword }
 * - On success: shows "Password Reset Successful" screen with Back to Sign In button
 * - "Back to Sign In" button on success screen calls navigate(/sign-in)
 * - On 400/401 API error: shows toast and transitions to invalid-token screen
 * - Eye/EyeOff toggle changes password input type (text vs password)
 *
 * NOT tested:
 * - CSS blobs / animations
 * - The ArrowLeft back links (DOM-only, no logic)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import ResetPassword from '../ResetPassword';

// ---- hoisted mock references -------------------------------------------------
const { mockPost, mockNavigate } = vi.hoisted(() => ({
  mockPost: vi.fn(),
  mockNavigate: vi.fn(),
}));

// ---- mocks ------------------------------------------------------------------
vi.mock('@/lib/api', () => ({
  apiClient: {
    instance: {
      post: mockPost,
    },
  },
}));

vi.mock('@/contexts/useLanguage', () => ({
  useLanguage: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        'auth.resetPassword': 'Reset Password',
        'auth.enterNewPassword': 'Enter your new password',
        'auth.newPassword': 'New Password',
        'auth.passwordPlaceholder': '••••••••',
        'auth.passwordRequirements':
          'Password must be at least 8 characters long',
        'auth.confirmPassword': 'Confirm Password',
        'auth.confirmPasswordPlaceholder': 'Confirm your password',
        'auth.resettingPassword': 'Resetting password...',
        'auth.rememberPassword': 'Remember your password?',
        'auth.backToSignIn': 'Back to Sign In',
        'auth.invalidResetToken': 'Invalid Reset Link',
        'auth.invalidResetTokenMessage':
          'This password reset link is invalid or has expired. Please request a new password reset.',
        'auth.requestNewReset': 'Request New Reset',
        'auth.passwordResetSuccess': 'Password Reset Successful',
        'auth.passwordResetSuccessMessage':
          'Your password has been successfully reset. You can now sign in with your new password.',
        'errors.validationErrors.passwordRequired': 'Password is required',
        'errors.validationErrors.passwordTooShort':
          'Password must be at least 6 characters',
        'errors.validationErrors.passwordsDoNotMatch': 'Passwords do not match',
        'errors.operations.resetPassword':
          'Password reset failed. Check the email address provided.',
      };
      return map[key] ?? key;
    },
  }),
}));

vi.mock('react-router-dom', async () => {
  const actual =
    await vi.importActual<typeof import('react-router-dom')>(
      'react-router-dom'
    );
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

vi.mock('@/lib/logger', () => ({
  logger: { debug: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

vi.mock('@/lib/errorUtils', () => ({
  getLocalizedErrorMessage: (_err: unknown, _t: unknown, fallbackKey: string) =>
    fallbackKey,
}));

// ---- helpers -----------------------------------------------------------------
function renderResetPassword(search = '?token=valid-token-abc') {
  return render(
    <MemoryRouter initialEntries={[`/reset-password${search}`]}>
      <ResetPassword />
    </MemoryRouter>
  );
}

function fillPasswords(password: string, confirm: string) {
  fireEvent.change(screen.getByLabelText(/^new password$/i), {
    target: { value: password },
  });
  fireEvent.change(screen.getByLabelText(/^confirm password$/i), {
    target: { value: confirm },
  });
}

function submitForm() {
  fireEvent.submit(
    screen.getByRole('button', { name: /reset password/i }).closest('form')!
  );
}

// ---- tests ------------------------------------------------------------------
describe('ResetPassword', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Missing token', () => {
    it('shows Invalid Reset Link screen when no token in URL', async () => {
      const { toast } = await import('sonner');
      renderResetPassword(''); // no query string → no token
      await waitFor(() => {
        expect(
          screen.getByRole('heading', { name: /invalid reset link/i })
        ).toBeInTheDocument();
      });
      expect(toast.error).toHaveBeenCalledWith('Invalid Reset Link');
    });

    it('shows Request New Reset button on the invalid-token screen', async () => {
      renderResetPassword('');
      await waitFor(() => {
        expect(
          screen.getByRole('link', { name: /request new reset/i })
        ).toBeInTheDocument();
      });
    });

    it('does not render the password input on invalid-token screen', async () => {
      renderResetPassword('');
      await waitFor(() => {
        expect(
          screen.queryByLabelText(/^new password$/i)
        ).not.toBeInTheDocument();
      });
    });
  });

  describe('Rendering with valid token', () => {
    it('renders the reset-password form', async () => {
      renderResetPassword();
      await waitFor(() => {
        expect(screen.getByLabelText(/^new password$/i)).toBeInTheDocument();
        expect(
          screen.getByLabelText(/^confirm password$/i)
        ).toBeInTheDocument();
      });
    });

    it('renders the Reset Password heading', () => {
      renderResetPassword();
      expect(
        screen.getByRole('heading', { name: /^reset password$/i })
      ).toBeInTheDocument();
    });

    it('renders the submit button', () => {
      renderResetPassword();
      expect(
        screen.getByRole('button', { name: /reset password/i })
      ).toBeInTheDocument();
    });

    it('renders password-requirements hint text', () => {
      renderResetPassword();
      expect(
        screen.getByText(/password must be at least 8 characters long/i)
      ).toBeInTheDocument();
    });
  });

  describe('Validation', () => {
    it('shows passwordRequired toast and does not call API when password is empty', async () => {
      const { toast } = await import('sonner');
      renderResetPassword();
      fillPasswords('', '');
      submitForm();
      await waitFor(() => {
        expect(toast.error).toHaveBeenCalledWith('Password is required');
      });
      expect(mockPost).not.toHaveBeenCalled();
    });

    it('shows passwordTooShort toast for password shorter than 8 chars', async () => {
      const { toast } = await import('sonner');
      renderResetPassword();
      fillPasswords('short', 'short');
      submitForm();
      await waitFor(() => {
        expect(toast.error).toHaveBeenCalledWith(
          'Password must be at least 6 characters'
        );
      });
      expect(mockPost).not.toHaveBeenCalled();
    });

    it('accepts exactly 8 characters (boundary: length === 8)', async () => {
      mockPost.mockResolvedValue({ data: {} });
      renderResetPassword();
      fillPasswords('12345678', '12345678');
      submitForm();
      await waitFor(() => {
        expect(mockPost).toHaveBeenCalled();
      });
    });

    it('shows passwordsDoNotMatch toast when passwords differ', async () => {
      const { toast } = await import('sonner');
      renderResetPassword();
      fillPasswords('ValidPass1', 'DifferentPass2');
      submitForm();
      await waitFor(() => {
        expect(toast.error).toHaveBeenCalledWith('Passwords do not match');
      });
      expect(mockPost).not.toHaveBeenCalled();
    });
  });

  describe('API call', () => {
    it('calls POST /auth/reset-password with { token, newPassword }', async () => {
      mockPost.mockResolvedValue({ data: {} });
      renderResetPassword('?token=abc123xyz');
      fillPasswords('SecurePass1', 'SecurePass1');
      submitForm();
      await waitFor(() => {
        expect(mockPost).toHaveBeenCalledWith('/auth/reset-password', {
          token: 'abc123xyz',
          newPassword: 'SecurePass1',
        });
      });
    });

    it('calls the endpoint exactly once per submit', async () => {
      mockPost.mockResolvedValue({ data: {} });
      renderResetPassword();
      fillPasswords('GoodPass99', 'GoodPass99');
      submitForm();
      await waitFor(() => {
        expect(mockPost).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe('Success state', () => {
    it('shows Password Reset Successful heading after success', async () => {
      mockPost.mockResolvedValue({ data: {} });
      renderResetPassword();
      fillPasswords('GoodPass123', 'GoodPass123');
      submitForm();
      await waitFor(() => {
        expect(
          screen.getByRole('heading', { name: /password reset successful/i })
        ).toBeInTheDocument();
      });
    });

    it('shows toast.success on success', async () => {
      const { toast } = await import('sonner');
      mockPost.mockResolvedValue({ data: {} });
      renderResetPassword();
      fillPasswords('GoodPass123', 'GoodPass123');
      submitForm();
      await waitFor(() => {
        expect(toast.success).toHaveBeenCalledWith('Password Reset Successful');
      });
    });

    it('"Back to Sign In" button on success screen calls navigate(/sign-in)', async () => {
      mockPost.mockResolvedValue({ data: {} });
      renderResetPassword();
      fillPasswords('GoodPass123', 'GoodPass123');
      submitForm();
      await waitFor(() => {
        expect(
          screen.getByRole('heading', { name: /password reset successful/i })
        ).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: /back to sign in/i }));
      expect(mockNavigate).toHaveBeenCalledWith('/sign-in');
    });

    it('hides the form after success', async () => {
      mockPost.mockResolvedValue({ data: {} });
      renderResetPassword();
      fillPasswords('GoodPass123', 'GoodPass123');
      submitForm();
      await waitFor(() => {
        expect(
          screen.queryByLabelText(/^new password$/i)
        ).not.toBeInTheDocument();
      });
    });
  });

  describe('Error handling', () => {
    it('shows error toast on generic API failure', async () => {
      const { toast } = await import('sonner');
      mockPost.mockRejectedValue(new Error('network error'));
      renderResetPassword();
      fillPasswords('GoodPass123', 'GoodPass123');
      submitForm();
      await waitFor(() => {
        expect(toast.error).toHaveBeenCalledWith(
          'errors.operations.resetPassword'
        );
      });
    });

    it('transitions to invalid-token screen on 400 error', async () => {
      mockPost.mockRejectedValue({ response: { status: 400 } });
      renderResetPassword();
      fillPasswords('GoodPass123', 'GoodPass123');
      submitForm();
      await waitFor(() => {
        expect(
          screen.getByRole('heading', { name: /invalid reset link/i })
        ).toBeInTheDocument();
      });
    });

    it('transitions to invalid-token screen on 401 error', async () => {
      mockPost.mockRejectedValue({ response: { status: 401 } });
      renderResetPassword();
      fillPasswords('GoodPass123', 'GoodPass123');
      submitForm();
      await waitFor(() => {
        expect(
          screen.getByRole('heading', { name: /invalid reset link/i })
        ).toBeInTheDocument();
      });
    });

    it('does not navigate to sign-in on error', async () => {
      mockPost.mockRejectedValue(new Error('fail'));
      renderResetPassword();
      fillPasswords('GoodPass123', 'GoodPass123');
      submitForm();
      await waitFor(() => {
        expect(mockPost).toHaveBeenCalled();
      });
      expect(mockNavigate).not.toHaveBeenCalled();
    });

    it('re-enables the submit button after a failed request', async () => {
      mockPost.mockRejectedValue(new Error('oops'));
      renderResetPassword();
      fillPasswords('GoodPass123', 'GoodPass123');
      submitForm();
      await waitFor(() => {
        expect(mockPost).toHaveBeenCalled();
      });
      await waitFor(() => {
        expect(
          screen.getByRole('button', { name: /reset password/i })
        ).not.toBeDisabled();
      });
    });
  });

  describe('Password visibility toggle', () => {
    it('password field starts as type=password', () => {
      renderResetPassword();
      const input = screen.getByLabelText(/^new password$/i);
      expect(input).toHaveAttribute('type', 'password');
    });

    it('clicking the Eye button changes password field to type=text', () => {
      renderResetPassword();
      const input = screen.getByLabelText(/^new password$/i);
      // The toggle button is the first <button type="button"> inside the wrapper
      const toggleButtons = screen
        .getByLabelText(/^new password$/i)
        .closest('div')!
        .querySelectorAll('button[type="button"]');
      fireEvent.click(toggleButtons[0]);
      expect(input).toHaveAttribute('type', 'text');
    });

    it('clicking the Eye button a second time reverts to type=password', () => {
      renderResetPassword();
      const input = screen.getByLabelText(/^new password$/i);
      const toggleButtons = screen
        .getByLabelText(/^new password$/i)
        .closest('div')!
        .querySelectorAll('button[type="button"]');
      fireEvent.click(toggleButtons[0]);
      fireEvent.click(toggleButtons[0]);
      expect(input).toHaveAttribute('type', 'password');
    });
  });
});
