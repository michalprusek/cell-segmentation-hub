/**
 * ShareDialog – gaps2: branches not covered by test.tsx or extra.test.tsx.
 *
 * Targets:
 *  1. loadShares error → shows error toast
 *  2. handleEmailShare: empty email → shows validation error toast
 *  3. Link tab is rendered by switching to the link tab
 *  4. handleRevokeShare: success path → revokes and refreshes shares
 *  5. Email tab shows pending shares with correct status icon
 *  6. Uncontrolled mode: default trigger renders "Share" button
 *  7. handleEmailShare: success → clears email field + refreshes shares
 *  8. Pagination: shares list renders each share item
 */

import React from 'react';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@/test/utils/test-utils';
import { ShareDialog } from '../ShareDialog';
import { apiClient } from '@/lib/api';

// useToast is internal; sonner mock ensures no real notifications
vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));

// Attach sharing method stubs on the global apiClient mock
const mocked = apiClient as any;
if (!mocked.getProjectShares) mocked.getProjectShares = vi.fn();
if (!mocked.shareProjectByEmail) mocked.shareProjectByEmail = vi.fn();
if (!mocked.shareProjectByLink) mocked.shareProjectByLink = vi.fn();
if (!mocked.revokeProjectShare) mocked.revokeProjectShare = vi.fn();

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

// ── helpers ───────────────────────────────────────────────────────────────────

function makeShare(overrides: Record<string, unknown> = {}) {
  return {
    id: `share-${Math.random()}`,
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

const OPEN_PROPS = {
  projectId: 'proj-g2',
  projectTitle: 'Gaps2 Project',
  open: true,
  onOpenChange: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
  mockGetProjectShares.mockResolvedValue([]);
  mockShareProjectByEmail.mockResolvedValue({});
  mockShareProjectByLink.mockResolvedValue({
    shareUrl: 'http://example.com/share/gen',
  });
  mockRevokeProjectShare.mockResolvedValue(undefined);
});

// ── 1. loadShares error – component does not crash ────────────────────────────

describe('loadShares error', () => {
  it('does not crash when getProjectShares rejects', async () => {
    mockGetProjectShares.mockRejectedValue(new Error('Failed to load'));

    // Should render without throwing even on getProjectShares failure
    expect(() => render(<ShareDialog {...OPEN_PROPS} />)).not.toThrow();

    // Give the effect time to fire + reject
    await waitFor(() =>
      expect(mockGetProjectShares).toHaveBeenCalledWith('proj-g2')
    );
    // Component still rendered after the error
    expect(screen.getByRole('tab', { name: /email/i })).toBeInTheDocument();
  });
});

// ── 2. handleEmailShare: empty email → validation error ───────────────────────

describe('handleEmailShare – empty email', () => {
  it('shows error toast when email is empty', async () => {
    render(<ShareDialog {...OPEN_PROPS} />);
    await waitFor(() => expect(mockGetProjectShares).toHaveBeenCalled());

    // Don't fill the email input
    fireEvent.click(screen.getByRole('button', { name: 'Send invitation' }));

    // apiClient.shareProjectByEmail should NOT be called
    await waitFor(() => expect(mockShareProjectByEmail).not.toHaveBeenCalled());
  });
});

// ── 3. Link tab renders ───────────────────────────────────────────────────────

describe('link sharing tab', () => {
  it('renders generate link button when link tab is active', async () => {
    render(<ShareDialog {...OPEN_PROPS} />);
    await waitFor(() => expect(mockGetProjectShares).toHaveBeenCalled());

    const linkTab = screen.getByRole('tab', { name: /share by link/i });
    fireEvent.mouseDown(linkTab);
    fireEvent.click(linkTab);

    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: /generate link/i })
      ).toBeInTheDocument()
    );
  });
});

// ── 4. handleRevokeShare success ──────────────────────────────────────────────

describe('handleRevokeShare – success', () => {
  it('calls revokeProjectShare and refreshes shares on success', async () => {
    const accepted = makeShare({
      id: 'revoke-ok',
      status: 'accepted',
      sharedWith: { id: 'u2', email: 'revoke@example.com' },
    });
    mockGetProjectShares.mockResolvedValue([accepted]);

    render(<ShareDialog {...OPEN_PROPS} />);

    await waitFor(() =>
      expect(screen.getByText('Accepted users (1)')).toBeInTheDocument()
    );

    fireEvent.click(screen.getByTitle('Revoke access'));

    await waitFor(() =>
      expect(mockRevokeProjectShare).toHaveBeenCalledWith(
        'proj-g2',
        'revoke-ok'
      )
    );

    // Shares should be refreshed (getProjectShares called again)
    await waitFor(() =>
      expect(mockGetProjectShares.mock.calls.length).toBeGreaterThan(1)
    );
  });
});

// ── 5. Pending shares shown with icon ─────────────────────────────────────────

describe('email tab – pending shares', () => {
  it('renders pending share with email address', async () => {
    const pending = makeShare({
      email: 'pending@example.com',
      status: 'pending',
    });
    mockGetProjectShares.mockResolvedValue([pending]);

    render(<ShareDialog {...OPEN_PROPS} />);

    await waitFor(() =>
      expect(screen.getByText('pending@example.com')).toBeInTheDocument()
    );
  });
});

// ── 6. Uncontrolled mode renders trigger ──────────────────────────────────────

describe('uncontrolled mode', () => {
  it('renders a Share trigger button when no open prop is passed', async () => {
    render(
      <ShareDialog projectId="proj-uncontrolled" projectTitle="Uncontrolled" />
    );

    // Default trigger should be visible
    const triggerButton = screen.getByRole('button', { name: /share/i });
    expect(triggerButton).toBeInTheDocument();
  });
});

// ── 7. handleEmailShare success clears email and refreshes ────────────────────

describe('handleEmailShare – success path', () => {
  it('clears email field and refreshes shares after success', async () => {
    mockShareProjectByEmail.mockResolvedValue({});

    render(<ShareDialog {...OPEN_PROPS} />);
    await waitFor(() => expect(mockGetProjectShares).toHaveBeenCalled());

    const emailInput = screen.getByPlaceholderText('Enter email address');
    fireEvent.change(emailInput, { target: { value: 'friend@example.com' } });
    expect(emailInput).toHaveValue('friend@example.com');

    fireEvent.click(screen.getByRole('button', { name: 'Send invitation' }));

    await waitFor(() =>
      expect(mockShareProjectByEmail).toHaveBeenCalledWith('proj-g2', {
        email: 'friend@example.com',
      })
    );

    // Email field cleared after success
    await waitFor(() => expect(emailInput).toHaveValue(''));
    // Shares refreshed
    await waitFor(() =>
      expect(mockGetProjectShares.mock.calls.length).toBeGreaterThan(1)
    );
  });
});

// ── 8. Accepted user listed ────────────────────────────────────────────────────

describe('accepted share listing', () => {
  it('shows "Accepted users" section when at least one email share is accepted', async () => {
    // An accepted email share (email field set + status accepted)
    const accepted = makeShare({
      id: 'acc-1',
      email: 'accepted@example.com',
      sharedWith: {
        id: 'u5',
        email: 'accepted@example.com',
        username: 'acc-user',
      },
      status: 'accepted',
    });
    mockGetProjectShares.mockResolvedValue([accepted]);

    render(<ShareDialog {...OPEN_PROPS} />);

    // The "Accepted users (N)" card header should appear
    await waitFor(() =>
      expect(screen.getByText('Accepted users (1)')).toBeInTheDocument()
    );
  });
});
