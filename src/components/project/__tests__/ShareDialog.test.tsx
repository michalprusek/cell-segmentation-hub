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
// Casting via `any` avoids TS complaining about missing properties.
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

describe('ShareDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetProjectShares.mockResolvedValue([]);
    mockShareProjectByEmail.mockResolvedValue({});
    mockShareProjectByLink.mockResolvedValue({
      shareUrl: 'http://example.com/share/abc',
    });
    mockRevokeProjectShare.mockResolvedValue(undefined);
  });

  describe('Rendering', () => {
    it('loads shares when dialog opens', async () => {
      render(<ShareDialog {...DEFAULT_PROPS} />);
      await waitFor(() => {
        expect(mockGetProjectShares).toHaveBeenCalledWith('proj-1');
      });
    });

    it('renders email and link tabs', async () => {
      render(<ShareDialog {...DEFAULT_PROPS} />);
      expect(screen.getByText('Share by email')).toBeInTheDocument();
      expect(screen.getByText('Share by link')).toBeInTheDocument();
    });

    it('renders email input on email tab', async () => {
      render(<ShareDialog {...DEFAULT_PROPS} />);
      expect(
        screen.getByPlaceholderText('Enter email address')
      ).toBeInTheDocument();
    });

    it('renders Send invitation button', () => {
      render(<ShareDialog {...DEFAULT_PROPS} />);
      expect(
        screen.getByRole('button', { name: 'Send invitation' })
      ).toBeInTheDocument();
    });

    it('renders accepted users card when accepted shares exist', async () => {
      const accepted = makeShare({
        status: 'accepted',
        sharedWith: { id: 'u1', email: 'alice@example.com', username: 'alice' },
      });
      mockGetProjectShares.mockResolvedValue([accepted]);
      render(<ShareDialog {...DEFAULT_PROPS} />);
      await waitFor(() => {
        expect(screen.getByText('Accepted users (1)')).toBeInTheDocument();
      });
      expect(screen.getByText('alice')).toBeInTheDocument();
    });

    it('renders pending invitations card when pending shares exist', async () => {
      const pending = makeShare({
        status: 'pending',
        email: 'bob@example.com',
      });
      mockGetProjectShares.mockResolvedValue([pending]);
      render(<ShareDialog {...DEFAULT_PROPS} />);
      await waitFor(() => {
        expect(screen.getByText('Pending invitations (1)')).toBeInTheDocument();
      });
      expect(screen.getByText('bob@example.com')).toBeInTheDocument();
    });
  });

  describe('Email sharing', () => {
    it('calls shareProjectByEmail with trimmed email and refreshes shares', async () => {
      render(<ShareDialog {...DEFAULT_PROPS} />);
      // Wait for initial shares load
      await waitFor(() =>
        expect(mockGetProjectShares).toHaveBeenCalledTimes(1)
      );

      fireEvent.change(screen.getByPlaceholderText('Enter email address'), {
        target: { value: '  collaborator@example.com  ' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Send invitation' }));

      await waitFor(() => {
        expect(mockShareProjectByEmail).toHaveBeenCalledWith('proj-1', {
          email: 'collaborator@example.com',
        });
      });
      // Shares should be refreshed after success
      await waitFor(() =>
        expect(mockGetProjectShares).toHaveBeenCalledTimes(2)
      );
    });

    it('clears email input after successful share', async () => {
      render(<ShareDialog {...DEFAULT_PROPS} />);
      await waitFor(() =>
        expect(mockGetProjectShares).toHaveBeenCalledTimes(1)
      );

      const input = screen.getByPlaceholderText('Enter email address');
      fireEvent.change(input, { target: { value: 'foo@bar.com' } });
      fireEvent.click(screen.getByRole('button', { name: 'Send invitation' }));

      await waitFor(() => {
        expect(input).toHaveValue('');
      });
    });

    it('does not call API when email is blank', async () => {
      render(<ShareDialog {...DEFAULT_PROPS} />);
      await waitFor(() =>
        expect(mockGetProjectShares).toHaveBeenCalledTimes(1)
      );

      fireEvent.click(screen.getByRole('button', { name: 'Send invitation' }));
      // Should not be called
      expect(mockShareProjectByEmail).not.toHaveBeenCalled();
    });
  });

  describe('Revoke share', () => {
    it('calls revokeProjectShare with correct ids and refreshes shares', async () => {
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
      // Cancel invitation = revoke for pending shares; it's the XCircle button
      const cancelBtn = screen.getByTitle('Cancel invitation');
      fireEvent.click(cancelBtn);

      await waitFor(() => {
        expect(mockRevokeProjectShare).toHaveBeenCalledWith(
          'proj-1',
          'share-42'
        );
      });
      await waitFor(() =>
        expect(mockGetProjectShares).toHaveBeenCalledTimes(2)
      );
    });

    it('calls revokeProjectShare from accepted users row', async () => {
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
      const revokeBtn = screen.getByTitle('Revoke access');
      fireEvent.click(revokeBtn);

      await waitFor(() => {
        expect(mockRevokeProjectShare).toHaveBeenCalledWith(
          'proj-1',
          'share-99'
        );
      });
    });
  });

  describe('Link sharing tab', () => {
    it('switches to link tab and shows Generate link button', async () => {
      render(<ShareDialog {...DEFAULT_PROPS} />);
      const linkTab = screen.getByRole('tab', { name: /share by link/i });
      fireEvent.mouseDown(linkTab);
      fireEvent.click(linkTab);
      await waitFor(() => {
        expect(
          screen.getByRole('button', { name: /generate link/i })
        ).toBeInTheDocument();
      });
    });

    it('calls shareProjectByLink and shows generated link', async () => {
      render(<ShareDialog {...DEFAULT_PROPS} />);
      // Switch tab via Radix-compatible click on the tab role element
      const linkTab = screen.getByRole('tab', { name: /share by link/i });
      fireEvent.mouseDown(linkTab);
      fireEvent.click(linkTab);
      await waitFor(() => {
        expect(
          screen.getByRole('button', { name: /generate link/i })
        ).toBeInTheDocument();
      });
      fireEvent.click(screen.getByRole('button', { name: /generate link/i }));

      await waitFor(() => {
        expect(mockShareProjectByLink).toHaveBeenCalledWith('proj-1', {
          expiryHours: undefined,
        });
      });
      // Generated link should appear in a readonly input
      await waitFor(() => {
        const inputs = screen.getAllByDisplayValue(
          'http://example.com/share/abc'
        );
        expect(inputs.length).toBeGreaterThan(0);
      });
    });
  });

  describe('Resend invitation', () => {
    it('calls shareProjectByEmail again for pending share on resend click', async () => {
      const pending = makeShare({
        status: 'pending',
        email: 'resend@example.com',
      });
      mockGetProjectShares.mockResolvedValue([pending]);
      render(<ShareDialog {...DEFAULT_PROPS} />);

      await waitFor(() =>
        expect(screen.getByText('resend@example.com')).toBeInTheDocument()
      );
      const resendBtn = screen.getByTitle('Resend invitation');
      fireEvent.click(resendBtn);

      await waitFor(() => {
        expect(mockShareProjectByEmail).toHaveBeenCalledWith('proj-1', {
          email: 'resend@example.com',
        });
      });
    });
  });

  describe('Error handling', () => {
    it('does not crash when getProjectShares rejects', async () => {
      mockGetProjectShares.mockRejectedValue(new Error('Network error'));
      // Should render without throwing
      render(<ShareDialog {...DEFAULT_PROPS} />);
      await waitFor(() => expect(mockGetProjectShares).toHaveBeenCalled());
    });
  });
});
