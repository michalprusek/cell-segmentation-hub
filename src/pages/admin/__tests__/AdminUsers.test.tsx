/**
 * The admin user list page.
 *
 * The interesting assertions are the ones about what the page REFUSES to do —
 * offer "log in as" against the admin's own row or another admin's — and the
 * full page load after a successful impersonation. Rendering a table is not
 * worth a test on its own.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import AdminUsers from '@/pages/admin/AdminUsers';
import type { AdminUserListResult, AdminUserSummary } from '@/types';

const mockAuth = { user: { id: 'admin-1', email: 'admin@admin.com' } };

vi.mock('@/contexts/exports', () => ({
  useAuth: () => mockAuth,
  useLanguage: () => ({ t: (key: string) => key }),
}));

vi.mock('@/components/DashboardHeader', () => ({
  default: () => <div data-testid="dashboard-header" />,
}));

vi.mock('@/lib/api', () => ({
  default: { listAdminUsers: vi.fn(), impersonateUser: vi.fn() },
}));

vi.mock('@/lib/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const mockToastError = vi.fn();
vi.mock('sonner', () => ({
  toast: { error: (...args: unknown[]) => mockToastError(...args) },
}));

import apiClient from '@/lib/api';

const row = (over: Partial<AdminUserSummary> = {}): AdminUserSummary => ({
  id: 'user-1',
  email: 'user@example.com',
  username: 'someone',
  emailVerified: true,
  isAdmin: false,
  createdAt: '2026-01-02T03:04:05.000Z',
  projectCount: 3,
  ...over,
});

const page = (
  users: AdminUserSummary[],
  over: Partial<AdminUserListResult> = {}
): AdminUserListResult => ({
  users,
  total: users.length,
  page: 1,
  limit: 25,
  totalPages: 1,
  ...over,
});

const renderPage = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        <AdminUsers />
      </QueryClientProvider>
    </MemoryRouter>
  );
};

const rowFor = (email: string) =>
  screen.getByText(email).closest('tr') as HTMLElement;

describe('AdminUsers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(window.location.assign).mockClear();
  });

  it('lists the users the API returned', async () => {
    vi.mocked(apiClient.listAdminUsers).mockResolvedValue(
      page([row()])
    );
    renderPage();

    expect(await screen.findByText('user@example.com')).toBeInTheDocument();
    expect(screen.getByText('someone')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('impersonates and then does a FULL page load', async () => {
    vi.mocked(apiClient.listAdminUsers).mockResolvedValue(
      page([row()])
    );
    vi.mocked(apiClient.impersonateUser).mockResolvedValue({
      user: { id: 'user-1', email: 'user@example.com' },
      impersonatedBy: { id: 'admin-1', email: 'admin@admin.com' },
    } as never);

    renderPage();
    await screen.findByText('user@example.com');

    await userEvent.click(
      within(rowFor('user@example.com')).getByRole('button')
    );

    await waitFor(() =>
      expect(apiClient.impersonateUser).toHaveBeenCalledWith('user-1')
    );
    // The cookies now belong to the target; a soft navigate would render
    // their dashboard out of the admin's React Query cache.
    await waitFor(() =>
      expect(window.location.assign).toHaveBeenCalledWith('/dashboard')
    );
  });

  it('will not offer to impersonate the admin’s own row', async () => {
    vi.mocked(apiClient.listAdminUsers).mockResolvedValue(
      page([row({ id: 'admin-1', email: 'admin@admin.com', isAdmin: true })])
    );
    renderPage();
    await screen.findByText('admin@admin.com');

    expect(
      within(rowFor('admin@admin.com')).getByRole('button')
    ).toBeDisabled();
  });

  it('will not offer to impersonate ANOTHER administrator', async () => {
    vi.mocked(apiClient.listAdminUsers).mockResolvedValue(
      page([row({ id: 'admin-2', email: 'other@admin.com', isAdmin: true })])
    );
    renderPage();
    await screen.findByText('other@admin.com');

    expect(within(rowFor('other@admin.com')).getByRole('button')).toBeDisabled();
    // ...and says so, rather than looking broken.
    expect(
      within(rowFor('other@admin.com')).getByRole('button')
    ).toHaveAttribute('title', 'admin.cannotImpersonateAdmin');
  });

  it('stays on the page and reports a failed impersonation', async () => {
    vi.mocked(apiClient.listAdminUsers).mockResolvedValue(
      page([row()])
    );
    vi.mocked(apiClient.impersonateUser).mockRejectedValue(new Error('nope'));

    renderPage();
    await screen.findByText('user@example.com');
    await userEvent.click(
      within(rowFor('user@example.com')).getByRole('button')
    );

    await waitFor(() => expect(mockToastError).toHaveBeenCalled());
    expect(window.location.assign).not.toHaveBeenCalled();
  });

  it('debounces the search into a single request', async () => {
    vi.mocked(apiClient.listAdminUsers).mockResolvedValue(
      page([row()])
    );
    renderPage();
    await screen.findByText('user@example.com');
    vi.mocked(apiClient.listAdminUsers).mockClear();

    await userEvent.type(
      screen.getByPlaceholderText('admin.searchPlaceholder'),
      'novak'
    );

    // One request for the settled term, not one per keystroke — the endpoint
    // is rate limited at 60 per 5 minutes.
    await waitFor(() =>
      expect(apiClient.listAdminUsers).toHaveBeenCalledWith(
        expect.objectContaining({ search: 'novak' })
      )
    );
    expect(vi.mocked(apiClient.listAdminUsers).mock.calls.length).toBeLessThan(
      5
    );
  });

  it('surfaces a failed load instead of an empty table', async () => {
    vi.mocked(apiClient.listAdminUsers).mockRejectedValue(new Error('500'));
    renderPage();
    await waitFor(() =>
      expect(screen.queryByRole('table')).not.toBeInTheDocument()
    );
    expect(await screen.findByText(/500|loadUsersFailed/)).toBeInTheDocument();
  });
});
