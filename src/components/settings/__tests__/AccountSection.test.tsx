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

// Mock the DeleteAccountDialog using the component's import path (relative to the component, not test)
vi.mock('@/components/settings/DeleteAccountDialog', () => ({
  default: ({ isOpen }: { isOpen: boolean }) =>
    isOpen ? <div data-testid="delete-account-dialog" /> : null,
}));

vi.mock('@/lib/api', () => ({
  default: {
    getUserProfile: vi
      .fn()
      .mockResolvedValue({ preferred_theme: 'system', preferredLang: 'en' }),
    changePassword: vi.fn(),
  },
}));

const apiMock = apiClient as unknown as {
  changePassword: ReturnType<typeof vi.fn>;
};

/** Types the three password fields and returns the userEvent instance. */
async function fillPasswordForm(
  current: string,
  newPwd: string,
  confirm: string
) {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText(/current password/i), current);
  await user.type(
    document.getElementById('newPassword') as HTMLElement,
    newPwd
  );
  await user.type(screen.getByLabelText(/confirm/i), confirm);
  return user;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('AccountSection — render', () => {
  it('renders the password form fields, danger zone, and delete button', () => {
    render(<AccountSection />);
    expect(
      screen.getByRole('button', { name: /change password/i })
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/current password/i)).toBeInTheDocument();
    expect(document.getElementById('newPassword')).toBeInTheDocument();
    expect(screen.getByLabelText(/confirm/i)).toBeInTheDocument();
    expect(screen.getByText(/danger/i)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /delete account/i })
    ).toBeInTheDocument();
  });
});

describe('AccountSection — delete account dialog', () => {
  it('opens the delete account dialog when the delete button is clicked', async () => {
    const user = userEvent.setup();
    render(<AccountSection />);
    await user.click(screen.getByRole('button', { name: /delete account/i }));
    expect(screen.getByTestId('delete-account-dialog')).toBeInTheDocument();
  });
});

describe('AccountSection — validation', () => {
  it('shows error toast when current password is empty', async () => {
    const user = userEvent.setup();
    render(<AccountSection />);

    await user.type(document.getElementById('newPassword')!, 'newpass1');
    await user.type(screen.getByLabelText(/confirm/i), 'newpass1');
    await user.click(screen.getByRole('button', { name: /change password/i }));

    expect(toast.error).toHaveBeenCalled();
    expect(apiMock.changePassword).not.toHaveBeenCalled();
  });

  it('shows error toast when new password is empty', async () => {
    const user = userEvent.setup();
    render(<AccountSection />);

    await user.type(screen.getByLabelText(/current password/i), 'oldpass');
    await user.type(screen.getByLabelText(/confirm/i), 'newpass1');
    await user.click(screen.getByRole('button', { name: /change password/i }));

    expect(toast.error).toHaveBeenCalled();
  });

  it('shows error toast when new password and confirmation differ', async () => {
    render(<AccountSection />);
    const user = await fillPasswordForm(
      'current123',
      'newpass123',
      'different456'
    );
    await user.click(screen.getByRole('button', { name: /change password/i }));

    expect(toast.error).toHaveBeenCalled();
    expect(apiMock.changePassword).not.toHaveBeenCalled();
  });

  it('shows error toast when new password is fewer than 6 characters', async () => {
    render(<AccountSection />);
    const user = await fillPasswordForm('current123', 'abc', 'abc');
    await user.click(screen.getByRole('button', { name: /change password/i }));

    expect(toast.error).toHaveBeenCalled();
    expect(apiMock.changePassword).not.toHaveBeenCalled();
  });
});

describe('AccountSection — successful password change', () => {
  it('calls changePassword, shows success toast, and clears the form', async () => {
    apiMock.changePassword.mockResolvedValueOnce(undefined);

    render(<AccountSection />);
    const user = await fillPasswordForm(
      'currentPass',
      'newPassword1',
      'newPassword1'
    );
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
    await waitFor(() => {
      expect(
        (document.getElementById('currentPassword') as HTMLInputElement).value
      ).toBe('');
    });
  });
});

describe('AccountSection — API error', () => {
  it('shows error toast when changePassword rejects', async () => {
    apiMock.changePassword.mockRejectedValueOnce(new Error('Wrong password'));

    render(<AccountSection />);
    const user = await fillPasswordForm(
      'wrong',
      'newPassword1',
      'newPassword1'
    );
    await user.click(screen.getByRole('button', { name: /change password/i }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalled();
    });
  });
});

describe('AccountSection — password match indicator', () => {
  it('shows the match status when passwords match', async () => {
    const user = userEvent.setup();
    render(<AccountSection />);

    await user.type(document.getElementById('newPassword')!, 'matchPass1');
    await user.type(screen.getByLabelText(/confirm/i), 'matchPass1');

    const status = screen.getByRole('status');
    expect(status).toBeInTheDocument();
    expect(status.textContent).toMatch(/match/i);
  });

  it('marks the confirm input aria-invalid when passwords differ', async () => {
    const user = userEvent.setup();
    render(<AccountSection />);

    await user.type(document.getElementById('newPassword')!, 'passA1234');
    await user.type(screen.getByLabelText(/confirm/i), 'passB5678');

    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByLabelText(/confirm/i)).toHaveAttribute(
      'aria-invalid',
      'true'
    );
  });

  it('hides the indicator when confirmPassword is empty', async () => {
    const user = userEvent.setup();
    render(<AccountSection />);

    await user.type(document.getElementById('newPassword')!, 'somePass1');

    expect(screen.queryByRole('status')).toBeNull();
  });

  it('hides the indicator and sets no aria-describedby on initial render', () => {
    render(<AccountSection />);
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.getByLabelText(/confirm/i)).not.toHaveAttribute(
      'aria-describedby'
    );
  });

  it('links the confirm input to the status via aria-describedby when both fields have content', async () => {
    const user = userEvent.setup();
    render(<AccountSection />);

    await user.type(document.getElementById('newPassword')!, 'abc123');
    await user.type(screen.getByLabelText(/confirm/i), 'abc123');

    expect(screen.getByLabelText(/confirm/i)).toHaveAttribute(
      'aria-describedby',
      'password-match-status'
    );
  });
});
