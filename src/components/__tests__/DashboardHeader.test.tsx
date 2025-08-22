import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render, mockAuthContext } from '@/test/utils/test-utils';
import DashboardHeader from '@/components/DashboardHeader';
import * as router from 'react-router-dom';

// Mock the hooks and modules
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useLocation: vi.fn(),
    useNavigate: vi.fn(),
  };
});

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: vi.fn(),
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock('@/hooks/useLocalizedModels', () => ({
  useLocalizedModels: vi.fn(),
}));

vi.mock('@/hooks/useSegmentationQueue', () => ({
  useSegmentationQueue: vi.fn(),
}));

vi.mock('@/lib/httpUtils', () => ({
  fetchWithRetry: vi.fn(),
}));

vi.mock('@/lib/logger');

// Mock child components
vi.mock('@/components/header/Logo', () => ({
  default: () => <div data-testid="logo">Logo</div>,
}));

vi.mock('@/components/header/UserProfileDropdown', () => ({
  default: ({ username }: { username: string }) => (
    <div data-testid="user-dropdown">{username}</div>
  ),
}));

vi.mock('@/components/header/MobileMenu', () => ({
  default: ({ isMenuOpen, setIsMenuOpen }: any) => (
    <div data-testid="mobile-menu" data-open={isMenuOpen}>
      <button onClick={() => setIsMenuOpen(false)}>Close</button>
    </div>
  ),
}));

describe('DashboardHeader', () => {
  const mockNavigate = vi.fn();
  const mockUseLocation = vi.mocked(router.useLocation);
  const mockUseNavigate = vi.mocked(router.useNavigate);

  const mockModelContext = {
    selectedModel: 'hrnet' as const,
    getSelectedModelInfo: () => ({
      id: 'hrnet',
      name: 'HRNet',
      displayName: 'HRNet v2',
      description: 'High-Resolution Network',
      accuracy: 95,
      speed: 'medium',
      inferenceTime: 3.1,
    }),
  };

  const mockQueueContext = {
    isConnected: true,
    queueStats: { processing: 0, waiting: 0 },
  };

  const mockFetchWithRetry = vi.fn();

  beforeEach(async () => {
    vi.clearAllMocks();

    mockUseNavigate.mockReturnValue(mockNavigate);
    mockUseLocation.mockReturnValue({
      pathname: '/dashboard',
      search: '',
      hash: '',
      state: null,
      key: 'default',
    });

    // Mock the hooks
    const { useAuth } = await import('@/contexts/AuthContext');
    const { useLocalizedModels } = await import('@/hooks/useLocalizedModels');
    const { useSegmentationQueue } = await import(
      '@/hooks/useSegmentationQueue'
    );
    const { fetchWithRetry } = await import('@/lib/httpUtils');

    vi.mocked(useAuth).mockReturnValue({
      ...mockAuthContext,
      user: {
        ...mockAuthContext.user,
        email: 'test@example.com',
      },
    });

    vi.mocked(useLocalizedModels).mockReturnValue(mockModelContext);
    vi.mocked(useSegmentationQueue).mockReturnValue(mockQueueContext);

    mockFetchWithRetry.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ status: 'idle' }),
    });
    vi.mocked(fetchWithRetry).mockImplementation(mockFetchWithRetry);

    // Mock setInterval and clearInterval
    vi.spyOn(global, 'setInterval').mockImplementation(
      (fn: any, delay: number) => {
        return setTimeout(fn, 0) as any; // Execute immediately for tests
      }
    );
    vi.spyOn(global, 'clearInterval').mockImplementation(vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the header with logo and user dropdown', () => {
    render(<DashboardHeader />);

    expect(screen.getByTestId('logo')).toBeInTheDocument();
    expect(screen.getByTestId('user-dropdown')).toBeInTheDocument();
  });

  it('displays user email as username in dropdown', () => {
    render(<DashboardHeader />);

    expect(screen.getByTestId('user-dropdown')).toHaveTextContent('test');
  });

  it('renders documentation button with correct text', () => {
    render(<DashboardHeader />);

    const docButton = screen.getByRole('button', { name: /documentation/i });
    expect(docButton).toBeInTheDocument();
    expect(docButton).toHaveClass('text-gray-600', 'dark:text-gray-300');
  });

  it('navigates to documentation when doc button is clicked', async () => {
    const user = userEvent.setup();
    render(<DashboardHeader />);

    const docButton = screen.getByRole('button', { name: /documentation/i });
    await user.click(docButton);

    expect(mockNavigate).toHaveBeenCalledWith('/documentation', {
      state: {
        from: 'Dashboard',
        path: '/dashboard',
      },
    });
  });

  it('displays model badge with status indicator', () => {
    render(<DashboardHeader />);

    const modelBadge = screen.getByText('HRNet v2');
    expect(modelBadge).toBeInTheDocument();

    const statusDot = modelBadge.parentElement?.querySelector('.w-2.h-2');
    expect(statusDot).toBeInTheDocument();
    expect(statusDot).toHaveClass('bg-green-500'); // idle status
  });

  it('navigates to settings when model badge is clicked', async () => {
    const user = userEvent.setup();
    render(<DashboardHeader />);

    const modelBadge =
      screen.getByText('HRNet v2').closest('[role]') ||
      screen.getByText('HRNet v2').parentElement;
    if (modelBadge) {
      await user.click(modelBadge);
      expect(mockNavigate).toHaveBeenCalledWith('/settings?tab=models');
    }
  });

  it('shows mobile menu button on mobile', () => {
    render(<DashboardHeader />);

    const mobileMenuButton = document.querySelector('.md\\:hidden button');
    expect(mobileMenuButton).toBeInTheDocument();
  });

  it('opens mobile menu when menu button is clicked', async () => {
    const user = userEvent.setup();
    render(<DashboardHeader />);

    const menuButton = document.querySelector('.md\\:hidden button');
    if (menuButton) {
      await user.click(menuButton);
      expect(screen.getByTestId('mobile-menu')).toHaveAttribute(
        'data-open',
        'true'
      );
    }
  });

  it('hides header on segmentation editor page', () => {
    mockUseLocation.mockReturnValue({
      pathname: '/project/123/segmentation/456',
      search: '',
      hash: '',
      state: null,
      key: 'default',
    });

    const { container } = render(<DashboardHeader />);
    expect(container.firstChild).toBeNull();
  });

  it('shows correct page info for different routes', () => {
    // Test settings page
    mockUseLocation.mockReturnValue({
      pathname: '/settings',
      search: '',
      hash: '',
      state: null,
      key: 'default',
    });

    render(<DashboardHeader />);
    const docButton = screen.getByRole('button', { name: /documentation/i });
    fireEvent.click(docButton);

    expect(mockNavigate).toHaveBeenCalledWith('/documentation', {
      state: {
        from: 'Settings',
        path: '/settings',
      },
    });
  });

  it('shows processing status when ML service is processing', async () => {
    mockQueueContext.queueStats = { processing: 2, waiting: 1 };
    mockFetchWithRetry.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ status: 'processing' }),
    });

    const { useSegmentationQueue } = await import(
      '@/hooks/useSegmentationQueue'
    );
    vi.mocked(useSegmentationQueue).mockReturnValue({
      ...mockQueueContext,
      queueStats: { processing: 2, waiting: 1 },
    });

    render(<DashboardHeader />);

    const statusDot = document.querySelector('.bg-blue-500');
    expect(statusDot).toBeInTheDocument();
  });

  it('shows error status when ML service is disconnected', async () => {
    const { useSegmentationQueue } = await import(
      '@/hooks/useSegmentationQueue'
    );
    vi.mocked(useSegmentationQueue).mockReturnValue({
      ...mockQueueContext,
      isConnected: false,
    });

    render(<DashboardHeader />);

    const statusDot = document.querySelector('.bg-red-500');
    expect(statusDot).toBeInTheDocument();
  });

  it('periodically checks ML service status', async () => {
    render(<DashboardHeader />);

    // Wait for initial call
    await waitFor(() => {
      expect(mockFetchWithRetry).toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/status'),
        {},
        expect.objectContaining({
          retries: 2,
          delay: 500,
          backoff: 2,
        })
      );
    });
  });

  it('handles ML service status fetch error', async () => {
    mockFetchWithRetry.mockRejectedValue(new Error('Network error'));

    render(<DashboardHeader />);

    await waitFor(() => {
      const statusDot = document.querySelector('.bg-red-500');
      expect(statusDot).toBeInTheDocument();
    });
  });

  it('has proper semantic HTML structure', () => {
    render(<DashboardHeader />);

    const header = screen.getByRole('banner');
    expect(header).toBeInTheDocument();
    expect(header.tagName.toLowerCase()).toBe('header');
    expect(header).toHaveClass('bg-white', 'dark:bg-gray-800');
  });

  it('has responsive layout classes', () => {
    render(<DashboardHeader />);

    const header = screen.getByRole('banner');
    const container = header.querySelector('.container');
    expect(container).toHaveClass('mx-auto', 'px-4', 'h-16');

    const desktopNav = container?.querySelector('.hidden.md\\:flex');
    expect(desktopNav).toBeInTheDocument();

    const mobileNav = container?.querySelector('.md\\:hidden');
    expect(mobileNav).toBeInTheDocument();
  });

  it('handles project detail page correctly', () => {
    mockUseLocation.mockReturnValue({
      pathname: '/project/123',
      search: '',
      hash: '',
      state: null,
      key: 'default',
    });

    render(<DashboardHeader />);

    const docButton = screen.getByRole('button', { name: /documentation/i });
    fireEvent.click(docButton);

    expect(mockNavigate).toHaveBeenCalledWith('/documentation', {
      state: {
        from: 'Project',
        path: '/project/123',
      },
    });
  });

  it('handles unknown routes gracefully', () => {
    mockUseLocation.mockReturnValue({
      pathname: '/unknown-route',
      search: '',
      hash: '',
      state: null,
      key: 'default',
    });

    render(<DashboardHeader />);

    const docButton = screen.getByRole('button', { name: /documentation/i });
    fireEvent.click(docButton);

    expect(mockNavigate).toHaveBeenCalledWith('/documentation', {
      state: undefined,
    });
  });

  it('cleans up interval on unmount', () => {
    const { unmount } = render(<DashboardHeader />);
    unmount();

    expect(global.clearInterval).toHaveBeenCalled();
  });

  it('handles user without email gracefully', async () => {
    const { useAuth } = await import('@/contexts/AuthContext');
    vi.mocked(useAuth).mockReturnValue({
      ...mockAuthContext,
      user: {
        ...mockAuthContext.user,
        email: undefined,
      },
    });

    render(<DashboardHeader />);

    expect(screen.getByTestId('user-dropdown')).toHaveTextContent('User');
  });
});
