import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '@/test/utils/test-utils';
import AccountSection from '../AccountSection';

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

describe('AccountSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders change password submit button', () => {
    render(<AccountSection />);
    // The form has a submit button for changing password
    expect(screen.getByRole('button', { name: /change password/i })).toBeInTheDocument();
  });

  it('renders current password input', () => {
    render(<AccountSection />);
    expect(screen.getByLabelText(/current password/i)).toBeInTheDocument();
  });

  it('renders new password input field', () => {
    render(<AccountSection />);
    // The input has id="newPassword"
    expect(document.getElementById('newPassword')).toBeInTheDocument();
  });

  it('renders confirm password input', () => {
    render(<AccountSection />);
    expect(screen.getByLabelText(/confirm/i)).toBeInTheDocument();
  });

  it('renders change password button', () => {
    render(<AccountSection />);
    expect(screen.getByRole('button', { name: /change password/i })).toBeInTheDocument();
  });

  it('renders delete account button in danger zone', () => {
    render(<AccountSection />);
    expect(screen.getByRole('button', { name: /delete account/i })).toBeInTheDocument();
  });

  it('shows danger zone section', () => {
    render(<AccountSection />);
    // The danger zone has a destructive/red heading
    expect(screen.getByText(/danger/i)).toBeInTheDocument();
  });

  it('opens delete account dialog when delete account button is clicked', async () => {
    const user = userEvent.setup();
    render(<AccountSection />);
    const deleteButton = screen.getByRole('button', { name: /delete account/i });
    await user.click(deleteButton);
    expect(screen.getByTestId('delete-account-dialog')).toBeInTheDocument();
  });
});
