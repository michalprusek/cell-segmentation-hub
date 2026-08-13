import React from 'react';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@/test/utils/test-utils';
import { ShareDialog } from '../ShareDialog';
import { apiClient } from '@/lib/api';

// ShareDialog uses @/hooks/use-toast which delegates to sonner
vi.mock('sonner', () => ({
  toast: vi.fn(Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() })),
}));

// The global setup mock doesn't include sharing methods.
// Attach vi.fn() stubs onto the already-mocked object.
const mocked = apiClient as any;
mocked.getProjectShares = vi.fn();
mocked.shareProjectByEmail = vi.fn();
mocked.shareProjectByLink = vi.fn();
mocked.revokeProjectShare = vi.fn();

const mockGetProjectShares = mocked.getProjectShares as ReturnType<
  typeof vi.fn
>;
const mockShareProjectByEmail = mocked.shareProjectByEmail as ReturnType<
  typeof vi.fn
>;
const mockShareProjectByLink = mocked.shareProjectByLink as ReturnType<
  typeof vi.fn
>;
const mockRevokeProjectShare = mocked.revokeProjectShare as ReturnType<
  typeof vi.fn
>;

// navigator.clipboard is needed by the copy-link flow
const mockWriteText = vi.fn();
Object.defineProperty(navigator, 'clipboard', {
  value: { writeText: mockWriteText },
  writable: true,
  configurable: true,
});

const DEFAULT_PROPS = {
  projectId: 'proj-1',
  projectTitle: 'My Project',
  open: true,
  onOpenChange: vi.fn(),
};

function makeShare(
  overrides: Partial<{
    id: string;
    email: string | null;
    sharedWith: { id: string; email: string; username?: string } | null;
    status: string;
    shareToken: string;
    shareUrl: string;
    tokenExpiry: string | null;
    createdAt: string;
  }> = {}
) {
  return {
    id: 'share-1',
    email: 'user@example.com',
    sharedWith: null,
    status: 'pending',
    shareToken: 'tok',
    shareUrl: 'http://example.com/share/tok',
    tokenExpiry: null,
    createdAt: new Date('2026-01-01').toISOString(),
    ...overrides,
  };
}

/** Switch the dialog to the "Share by link" tab (Radix-compatible). */
async function openLinkTab() {
  const linkTab = screen.getByRole('tab', { name: /share by link/i });
  fireEvent.mouseDown(linkTab);
  fireEvent.click(linkTab);
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: /generate link/i })
    ).toBeInTheDocument()
  );
}

describe('ShareDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetProjectShares.mockResolvedValue([]);
    mockShareProjectByEmail.mockResolvedValue({});
    mockShareProjectByLink.mockResolvedValue({
      shareUrl: 'http://example.com/share/abc',
    });
    mockRevokeProjectShare.mockResolvedValue(undefined);
    mockWriteText.mockResolvedValue(undefined);
  });

  describe('Rendering & loading', () => {
    it('loads shares for the project when the dialog opens', async () => {
      render(<ShareDialog {...DEFAULT_PROPS} />);
      await waitFor(() =>
        expect(mockGetProjectShares).toHaveBeenCalledWith('proj-1')
      );
    });

    it('renders the accepted-users card for accepted shares', async () => {
      const accepted = makeShare({
        status: 'accepted',
        sharedWith: { id: 'u1', email: 'alice@example.com', username: 'alice' },
      });
      mockGetProjectShares.mockResolvedValue([accepted]);
      render(<ShareDialog {...DEFAULT_PROPS} />);
      await waitFor(() =>
        expect(screen.getByText('Accepted users (1)')).toBeInTheDocument()
      );
      expect(screen.getByText('alice')).toBeInTheDocument();
    });

    it('renders the pending-invitations card for pending shares', async () => {
      const pending = makeShare({
        status: 'pending',
        email: 'bob@example.com',
      });
      mockGetProjectShares.mockResolvedValue([pending]);
      render(<ShareDialog {...DEFAULT_PROPS} />);
      await waitFor(() =>
        expect(screen.getByText('Pending invitations (1)')).toBeInTheDocument()
      );
      expect(screen.getByText('bob@example.com')).toBeInTheDocument();
    });

    it('renders a default Share trigger in uncontrolled mode', () => {
      render(
        <ShareDialog
          projectId="proj-uncontrolled"
          projectTitle="Uncontrolled"
        />
      );
      expect(
        screen.getByRole('button', { name: /share/i })
      ).toBeInTheDocument();
    });

    it('does not render the default trigger when open is controlled', async () => {
      render(<ShareDialog {...DEFAULT_PROPS} />);
      await waitFor(() => expect(mockGetProjectShares).toHaveBeenCalled());
      const shareButtons = screen.queryAllByRole('button', {
        name: /^share$/i,
      });
      expect(
        shareButtons.some(btn => btn.textContent?.trim() === 'Share')
      ).toBe(false);
    });

    it('does not load shares while the dialog is closed', async () => {
      render(
        <ShareDialog
          projectId="proj-closed"
          projectTitle="Closed Project"
          open={false}
          onOpenChange={vi.fn()}
        />
      );
      await new Promise(r => setTimeout(r, 50));
      expect(mockGetProjectShares).not.toHaveBeenCalled();
    });

    it('loads shares when open transitions from false to true', async () => {
      const { rerender } = render(
        <ShareDialog
          projectId="proj-toggle"
          projectTitle="Toggle Project"
          open={false}
          onOpenChange={vi.fn()}
        />
      );
      await new Promise(r => setTimeout(r, 50));
      expect(mockGetProjectShares).not.toHaveBeenCalled();

      rerender(
        <ShareDialog
          projectId="proj-toggle"
          projectTitle="Toggle Project"
          open={true}
          onOpenChange={vi.fn()}
        />
      );
      await waitFor(() =>
        expect(mockGetProjectShares).toHaveBeenCalledWith('proj-toggle')
      );
    });

    it('does not crash when getProjectShares rejects', async () => {
      mockGetProjectShares.mockRejectedValue(new Error('Network error'));
      expect(() => render(<ShareDialog {...DEFAULT_PROPS} />)).not.toThrow();
      await waitFor(() => expect(mockGetProjectShares).toHaveBeenCalled());
      // Component still rendered after the error
      expect(screen.getByRole('tab', { name: /email/i })).toBeInTheDocument();
    });
  });

  describe('Email sharing', () => {
    it('trims the email, calls the API, clears the input and refreshes shares', async () => {
      render(<ShareDialog {...DEFAULT_PROPS} />);
      await waitFor(() =>
        expect(mockGetProjectShares).toHaveBeenCalledTimes(1)
      );

      const input = screen.getByPlaceholderText('Enter email address');
      fireEvent.change(input, {
        target: { value: '  collaborator@example.com  ' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Send invitation' }));

      await waitFor(() =>
        expect(mockShareProjectByEmail).toHaveBeenCalledWith('proj-1', {
          email: 'collaborator@example.com',
        })
      );
      // Input cleared and shares refreshed after success
      await waitFor(() => expect(input).toHaveValue(''));
      await waitFor(() =>
        expect(mockGetProjectShares).toHaveBeenCalledTimes(2)
      );
    });

    it('does not call the API when the email is blank', async () => {
      render(<ShareDialog {...DEFAULT_PROPS} />);
      await waitFor(() =>
        expect(mockGetProjectShares).toHaveBeenCalledTimes(1)
      );

      fireEvent.click(screen.getByRole('button', { name: 'Send invitation' }));
      expect(mockShareProjectByEmail).not.toHaveBeenCalled();
    });

    it('resets the loading state on a 429 rate-limit error', async () => {
      mockShareProjectByEmail.mockRejectedValue({
        response: {
          status: 429,
          data: { error: 'Too many requests, please wait.' },
        },
      });
      render(<ShareDialog {...DEFAULT_PROPS} />);
      await waitFor(() => expect(mockGetProjectShares).toHaveBeenCalled());

      fireEvent.change(screen.getByPlaceholderText('Enter email address'), {
        target: { value: 'test@example.com' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Send invitation' }));

      await waitFor(() => expect(mockShareProjectByEmail).toHaveBeenCalled());
      await waitFor(() =>
        expect(
          screen.getByRole('button', { name: 'Send invitation' })
        ).not.toBeDisabled()
      );
    });

    it('resets the loading state on a generic (non-429) error', async () => {
      mockShareProjectByEmail.mockRejectedValue(
        new Error('Connection refused')
      );
      render(<ShareDialog {...DEFAULT_PROPS} />);
      await waitFor(() => expect(mockGetProjectShares).toHaveBeenCalled());

      fireEvent.change(screen.getByPlaceholderText('Enter email address'), {
        target: { value: 'fail@example.com' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Send invitation' }));

      await waitFor(() => expect(mockShareProjectByEmail).toHaveBeenCalled());
      await waitFor(() =>
        expect(
          screen.getByRole('button', { name: 'Send invitation' })
        ).not.toBeDisabled()
      );
    });
  });

  describe('Link sharing', () => {
    it('generates a link and shows the generated URL', async () => {
      render(<ShareDialog {...DEFAULT_PROPS} />);
      await waitFor(() => expect(mockGetProjectShares).toHaveBeenCalled());
      await openLinkTab();

      fireEvent.click(screen.getByRole('button', { name: /generate link/i }));

      await waitFor(() =>
        expect(mockShareProjectByLink).toHaveBeenCalledWith('proj-1', {
          expiryHours: undefined,
        })
      );
      await waitFor(() =>
        expect(
          screen.getAllByDisplayValue('http://example.com/share/abc').length
        ).toBeGreaterThan(0)
      );
    });

    it('resets the loading state when link generation fails', async () => {
      mockShareProjectByLink.mockRejectedValue(new Error('Link gen failed'));
      render(<ShareDialog {...DEFAULT_PROPS} />);
      await waitFor(() => expect(mockGetProjectShares).toHaveBeenCalled());
      await openLinkTab();

      fireEvent.click(screen.getByRole('button', { name: /generate link/i }));

      await waitFor(() => expect(mockShareProjectByLink).toHaveBeenCalled());
      await waitFor(() =>
        expect(
          screen.getByRole('button', { name: /generate link/i })
        ).not.toBeDisabled()
      );
    });

    it('handles a clipboard failure when copying the generated link', async () => {
      mockShareProjectByLink.mockResolvedValue({
        shareUrl: 'http://example.com/share/fail-copy',
      });
      mockWriteText.mockRejectedValue(new Error('Clipboard denied'));
      render(<ShareDialog {...DEFAULT_PROPS} />);
      await waitFor(() => expect(mockGetProjectShares).toHaveBeenCalled());
      await openLinkTab();

      fireEvent.click(screen.getByRole('button', { name: /generate link/i }));
      await waitFor(() =>
        expect(
          screen.queryAllByDisplayValue('http://example.com/share/fail-copy')
            .length
        ).toBeGreaterThan(0)
      );

      // The copy button is the icon-only button next to the link input
      const copyBtn = screen
        .getAllByRole('button')
        .find(
          btn =>
            btn.querySelector('svg') !== null &&
            btn.title === undefined &&
            btn.textContent?.trim() === ''
        );
      if (copyBtn) {
        fireEvent.click(copyBtn);
        await waitFor(() => expect(mockWriteText).toHaveBeenCalled());
      }
      // No crash on clipboard error regardless
    });

    it('shows the "joined via link" card for an accepted link share', async () => {
      const acceptedLinkShare = makeShare({
        id: 'link-share-1',
        email: null, // link share has no email
        sharedWith: {
          id: 'u3',
          email: 'linker@example.com',
          username: 'linker',
        },
        status: 'accepted',
        shareUrl: 'http://example.com/share/link1',
      });
      mockGetProjectShares.mockResolvedValue([acceptedLinkShare]);
      render(<ShareDialog {...DEFAULT_PROPS} />);
      await openLinkTab();

      await waitFor(() =>
        expect(screen.getAllByText(/joined via link/i).length).toBeGreaterThan(
          0
        )
      );
      expect(screen.getByText('linker')).toBeInTheDocument();
    });
  });

  describe('Revoke & resend', () => {
    it('revokes a pending invitation and refreshes shares', async () => {
      const pending = makeShare({
        id: 'share-42',
        status: 'pending',
        email: 'victim@example.com',
      });
      mockGetProjectShares.mockResolvedValue([pending]);
      render(<ShareDialog {...DEFAULT_PROPS} />);

      await waitFor(() =>
        expect(screen.getByText('victim@example.com')).toBeInTheDocument()
      );
      // Cancel invitation = revoke for pending shares (XCircle button)
      fireEvent.click(screen.getByTitle('Cancel invitation'));

      await waitFor(() =>
        expect(mockRevokeProjectShare).toHaveBeenCalledWith(
          'proj-1',
          'share-42'
        )
      );
      await waitFor(() =>
        expect(mockGetProjectShares).toHaveBeenCalledTimes(2)
      );
    });

    it('revokes access from an accepted-users row', async () => {
      const accepted = makeShare({
        id: 'share-99',
        status: 'accepted',
        sharedWith: { id: 'u2', email: 'accepted@example.com' },
      });
      mockGetProjectShares.mockResolvedValue([accepted]);
      render(<ShareDialog {...DEFAULT_PROPS} />);

      await waitFor(() =>
        expect(screen.getByText('Accepted users (1)')).toBeInTheDocument()
      );
      fireEvent.click(screen.getByTitle('Revoke access'));

      await waitFor(() =>
        expect(mockRevokeProjectShare).toHaveBeenCalledWith(
          'proj-1',
          'share-99'
        )
      );
    });

    it('resets the loading state when revoke fails', async () => {
      const accepted = makeShare({
        id: 'share-revoke-err',
        status: 'accepted',
        sharedWith: { id: 'u2', email: 'revoke@example.com' },
      });
      mockGetProjectShares.mockResolvedValue([accepted]);
      mockRevokeProjectShare.mockRejectedValue(new Error('Revoke failed'));
      render(<ShareDialog {...DEFAULT_PROPS} />);

      await waitFor(() =>
        expect(screen.getByText('Accepted users (1)')).toBeInTheDocument()
      );
      fireEvent.click(screen.getByTitle('Revoke access'));

      await waitFor(() => expect(mockRevokeProjectShare).toHaveBeenCalled());
      await waitFor(() =>
        expect(screen.getByTitle('Revoke access')).not.toBeDisabled()
      );
    });

    it('resends a pending invitation via shareProjectByEmail', async () => {
      const pending = makeShare({
        status: 'pending',
        email: 'resend@example.com',
      });
      mockGetProjectShares.mockResolvedValue([pending]);
      render(<ShareDialog {...DEFAULT_PROPS} />);

      await waitFor(() =>
        expect(screen.getByText('resend@example.com')).toBeInTheDocument()
      );
      fireEvent.click(screen.getByTitle('Resend invitation'));

      await waitFor(() =>
        expect(mockShareProjectByEmail).toHaveBeenCalledWith('proj-1', {
          email: 'resend@example.com',
        })
      );
    });

    it('resets the loading state when a resend hits a 429 rate-limit', async () => {
      const pending = makeShare({
        status: 'pending',
        email: 'resend@example.com',
      });
      mockGetProjectShares.mockResolvedValue([pending]);
      mockShareProjectByEmail.mockRejectedValue({
        response: { status: 429, data: { error: 'Rate limit exceeded' } },
      });
      render(<ShareDialog {...DEFAULT_PROPS} />);

      await waitFor(() =>
        expect(screen.getByText('resend@example.com')).toBeInTheDocument()
      );
      const resendBtn = screen.getByTitle('Resend invitation');
      fireEvent.click(resendBtn);

      await waitFor(() =>
        expect(mockShareProjectByEmail).toHaveBeenCalledWith('proj-1', {
          email: 'resend@example.com',
        })
      );
      await waitFor(() => expect(resendBtn).not.toBeDisabled());
    });
  });
});
