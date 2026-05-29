/**
 * ForgotPassword page unit tests.
 *
 * Tested behaviors:
 * - Form renders email field and submit button
 * - Empty email shows emailRequired toast and does NOT call API
 * - Malformed email shows invalidEmail toast and does NOT call API
 * - Valid email calls POST /auth/request-password-reset with normalised
 *   (trimmed + lowercased) email
 * - On success: shows success screen with email displayed, Back to Sign In btn
 * - "Try Again" button in success screen resets to the form
 * - 429 rate-limit error shows the API-provided message
 * - 404 not-found error shows the API-provided message
 * - Generic error falls back to getLocalizedErrorMessage
 * - Back to Sign In (in form footer) navigates to /sign-in
 *
 * NOT tested:
 * - CSS blobs / animations
 * - The ArrowLeft icon link (no logic)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import ForgotPassword from '../ForgotPassword';

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
        'auth.forgotPassword': 'Forgot Password?',
        'auth.enterEmailForReset': 'Enter your email address to reset password',
        'auth.emailAddress': 'Email address',
        'auth.emailPlaceholder': 'you@example.com',
        'auth.sending': 'Sending...',
        'auth.sendNewPassword': 'Send New Password',
        'auth.rememberPassword': 'Remember your password?',
        'auth.backToSignIn': 'Back to Sign In',
        'auth.emailSent': 'Email Sent',
        'auth.checkEmailForNewPassword': 'Check your email for new password',
        'auth.resetPasswordEmailSent':
          'If email exists, an email with new password was sent',
        'auth.didntReceiveEmail': "Didn't receive email?",
        'auth.tryAgain': 'Try Again',
        'errors.validationErrors.emailRequired': 'Email is required',
        'errors.validationErrors.invalidEmail':
          'Please enter a valid email address',
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
function renderForgotPassword() {
  return render(
    <MemoryRouter initialEntries={['/forgot-password']}>
      <ForgotPassword />
    </MemoryRouter>
  );
}

function submitEmail(email: string) {
  fireEvent.change(screen.getByLabelText(/email address/i), {
    target: { value: email },
  });
  fireEvent.submit(
    screen.getByRole('button', { name: /send new password/i }).closest('form')!
  );
}

// ---- tests ------------------------------------------------------------------
describe('ForgotPassword', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Rendering', () => {
    it('renders heading and email field', () => {
      renderForgotPassword();
      expect(
        screen.getByRole('heading', { name: /forgot password/i })
      ).toBeInTheDocument();
      expect(screen.getByLabelText(/email address/i)).toBeInTheDocument();
    });

    it('renders the Send New Password submit button', () => {
      renderForgotPassword();
      expect(
        screen.getByRole('button', { name: /send new password/i })
      ).toBeInTheDocument();
    });

    it('renders the Back to Sign In link in the form footer', () => {
      renderForgotPassword();
      const link = screen.getByRole('link', { name: /back to sign in/i });
      expect(link).toHaveAttribute('href', '/sign-in');
    });
  });

  describe('Validation', () => {
    it('shows emailRequired toast when email is blank', async () => {
      const { toast } = await import('sonner');
      renderForgotPassword();
      submitEmail('   '); // whitespace-only → normalizes to ''
      await waitFor(() => {
        expect(toast.error).toHaveBeenCalledWith('Email is required');
      });
      expect(mockPost).not.toHaveBeenCalled();
    });

    it('shows invalidEmail toast for malformed email', async () => {
      const { toast } = await import('sonner');
      renderForgotPassword();
      submitEmail('not-an-email');
      await waitFor(() => {
        expect(toast.error).toHaveBeenCalledWith(
          'Please enter a valid email address'
        );
      });
      expect(mockPost).not.toHaveBeenCalled();
    });

    it('shows invalidEmail toast for email missing TLD', async () => {
      const { toast } = await import('sonner');
      renderForgotPassword();
      submitEmail('user@nodot');
      await waitFor(() => {
        expect(toast.error).toHaveBeenCalledWith(
          'Please enter a valid email address'
        );
      });
      expect(mockPost).not.toHaveBeenCalled();
    });

    it('does NOT show toast for a valid email', async () => {
      mockPost.mockResolvedValue({ data: {} });
      const { toast } = await import('sonner');
      renderForgotPassword();
      submitEmail('user@example.com');
      await waitFor(() => {
        expect(mockPost).toHaveBeenCalled();
      });
      expect(toast.error).not.toHaveBeenCalled();
    });
  });

  describe('API call', () => {
    it('calls POST /auth/request-password-reset with normalised email', async () => {
      mockPost.mockResolvedValue({ data: {} });
      renderForgotPassword();
      submitEmail('  USER@Example.COM  ');
      await waitFor(() => {
        expect(mockPost).toHaveBeenCalledWith('/auth/request-password-reset', {
          email: 'user@example.com',
        });
      });
    });

    it('calls the endpoint exactly once per submit', async () => {
      mockPost.mockResolvedValue({ data: {} });
      renderForgotPassword();
      submitEmail('a@b.co');
      await waitFor(() => {
        expect(mockPost).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe('Success state', () => {
    it('shows Email Sent heading after successful submission', async () => {
      mockPost.mockResolvedValue({ data: {} });
      renderForgotPassword();
      submitEmail('success@example.com');
      await waitFor(() => {
        expect(
          screen.getByRole('heading', { name: /email sent/i })
        ).toBeInTheDocument();
      });
    });

    it('displays the submitted email in the success screen', async () => {
      mockPost.mockResolvedValue({ data: {} });
      renderForgotPassword();
      submitEmail('shown@example.com');
      await waitFor(() => {
        expect(screen.getByText('shown@example.com')).toBeInTheDocument();
      });
    });

    it('shows toast.success with resetPasswordEmailSent message', async () => {
      const { toast } = await import('sonner');
      mockPost.mockResolvedValue({ data: {} });
      renderForgotPassword();
      submitEmail('ok@example.com');
      await waitFor(() => {
        expect(toast.success).toHaveBeenCalledWith(
          'If email exists, an email with new password was sent'
        );
      });
    });

    it('"Try Again" button resets back to the form', async () => {
      mockPost.mockResolvedValue({ data: {} });
      renderForgotPassword();
      submitEmail('retry@example.com');
      await waitFor(() => {
        expect(
          screen.getByRole('heading', { name: /email sent/i })
        ).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: /try again/i }));

      await waitFor(() => {
        // Form is back
        expect(screen.getByLabelText(/email address/i)).toBeInTheDocument();
      });
      // Email field should be cleared
      expect(
        (screen.getByLabelText(/email address/i) as HTMLInputElement).value
      ).toBe('');
    });

    it('"Back to Sign In" button in success screen calls navigate(/sign-in)', async () => {
      mockPost.mockResolvedValue({ data: {} });
      renderForgotPassword();
      submitEmail('backtosignin@example.com');
      await waitFor(() => {
        expect(
          screen.getByRole('heading', { name: /email sent/i })
        ).toBeInTheDocument();
      });

      // The success screen has a <Button onClick={handleBackToSignIn}>
      fireEvent.click(screen.getByRole('button', { name: /back to sign in/i }));
      expect(mockNavigate).toHaveBeenCalledWith('/sign-in');
    });
  });

  describe('Error handling', () => {
    it('shows 429 rate-limit message from API response', async () => {
      const { toast } = await import('sonner');
      mockPost.mockRejectedValue({
        response: {
          status: 429,
          data: { error: 'Too many requests — please wait' },
        },
      });
      renderForgotPassword();
      submitEmail('ratelimit@example.com');
      await waitFor(() => {
        expect(toast.error).toHaveBeenCalledWith(
          'Too many requests — please wait'
        );
      });
    });

    it('shows 404 not-found message from API response', async () => {
      const { toast } = await import('sonner');
      mockPost.mockRejectedValue({
        response: {
          status: 404,
          data: { message: 'Email not found' },
        },
      });
      renderForgotPassword();
      submitEmail('notfound@example.com');
      await waitFor(() => {
        expect(toast.error).toHaveBeenCalledWith('Email not found');
      });
    });

    it('falls back to getLocalizedErrorMessage for generic errors', async () => {
      const { toast } = await import('sonner');
      mockPost.mockRejectedValue(new Error('network failure'));
      renderForgotPassword();
      submitEmail('fail@example.com');
      await waitFor(() => {
        expect(toast.error).toHaveBeenCalledWith(
          'errors.operations.resetPassword'
        );
      });
    });

    it('does not navigate on error', async () => {
      mockPost.mockRejectedValue({ response: { status: 500 } });
      renderForgotPassword();
      submitEmail('err@example.com');
      await waitFor(() => {
        expect(mockPost).toHaveBeenCalled();
      });
      expect(mockNavigate).not.toHaveBeenCalled();
    });

    it('re-enables the submit button after an error', async () => {
      mockPost.mockRejectedValue(new Error('oops'));
      renderForgotPassword();
      submitEmail('oops@example.com');
      await waitFor(() => {
        expect(mockPost).toHaveBeenCalled();
      });
      await waitFor(() => {
        expect(
          screen.getByRole('button', { name: /send new password/i })
        ).not.toBeDisabled();
      });
    });
  });
});
