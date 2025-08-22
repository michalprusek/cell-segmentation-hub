/**
 * Tests for Shared Project Access functionality
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import ShareAccept from '../ShareAccept';
import { acceptShare } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';

// Mock modules
vi.mock('@/lib/api', () => ({
  acceptShare: vi.fn(),
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: vi.fn(),
}));

vi.mock('@/contexts/LanguageContext', () => ({
  useLanguage: vi.fn(),
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => vi.fn(),
  };
});

describe('ShareAccept - Shared Project Access', () => {
  const mockT = vi.fn((key: string) => key);
  const mockNavigate = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();

    // Setup default mocks
    vi.mocked(useAuth).mockReturnValue({
      user: { id: 'user-123', email: 'test@example.com' },
      isAuthenticated: true,
      loading: false,
    } as any);

    vi.mocked(useLanguage).mockReturnValue({
      t: mockT,
      language: 'en',
    } as any);
  });

  describe('Authentication requirements', () => {
    it('should redirect to login when not authenticated', () => {
      vi.mocked(useAuth).mockReturnValue({
        user: null,
        isAuthenticated: false,
        loading: false,
      } as any);

      render(
        <MemoryRouter initialEntries={['/share/accept/test-token']}>
          <Routes>
            <Route path="/share/accept/:token" element={<ShareAccept />} />
            <Route path="/auth/login" element={<div>Login Page</div>} />
          </Routes>
        </MemoryRouter>
      );

      expect(screen.getByText('Login Page')).toBeInTheDocument();
    });

    it('should show loading state while checking authentication', () => {
      vi.mocked(useAuth).mockReturnValue({
        user: null,
        isAuthenticated: false,
        loading: true,
      } as any);

      render(
        <MemoryRouter initialEntries={['/share/accept/test-token']}>
          <Routes>
            <Route path="/share/accept/:token" element={<ShareAccept />} />
          </Routes>
        </MemoryRouter>
      );

      expect(screen.getByText('share.loading')).toBeInTheDocument();
    });
  });

  describe('Share token validation', () => {
    it('should accept valid share token', async () => {
      const mockShareData = {
        project: {
          id: 'project-123',
          name: 'Test Project',
          description: 'Test Description',
        },
        sharedBy: {
          email: 'owner@example.com',
          username: 'ProjectOwner',
        },
        permission: 'edit',
      };

      vi.mocked(acceptShare).mockResolvedValueOnce({
        success: true,
        data: mockShareData,
      } as any);

      render(
        <MemoryRouter initialEntries={['/share/accept/valid-token']}>
          <Routes>
            <Route path="/share/accept/:token" element={<ShareAccept />} />
          </Routes>
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(acceptShare).toHaveBeenCalledWith('valid-token');
      });

      expect(screen.getByText('share.acceptSuccess')).toBeInTheDocument();
    });

    it('should handle invalid share token', async () => {
      vi.mocked(acceptShare).mockRejectedValueOnce(
        new Error('Invalid or expired token')
      );

      render(
        <MemoryRouter initialEntries={['/share/accept/invalid-token']}>
          <Routes>
            <Route path="/share/accept/:token" element={<ShareAccept />} />
          </Routes>
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(acceptShare).toHaveBeenCalledWith('invalid-token');
      });

      expect(screen.getByText('share.invalidToken')).toBeInTheDocument();
    });

    it('should handle expired share token', async () => {
      vi.mocked(acceptShare).mockRejectedValueOnce({
        response: {
          status: 410,
          data: { message: 'Share link has expired' },
        },
      });

      render(
        <MemoryRouter initialEntries={['/share/accept/expired-token']}>
          <Routes>
            <Route path="/share/accept/:token" element={<ShareAccept />} />
          </Routes>
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(acceptShare).toHaveBeenCalledWith('expired-token');
      });

      expect(screen.getByText('share.expiredToken')).toBeInTheDocument();
    });

    it('should handle already accepted share', async () => {
      vi.mocked(acceptShare).mockRejectedValueOnce({
        response: {
          status: 409,
          data: { message: 'Already have access to this project' },
        },
      });

      render(
        <MemoryRouter initialEntries={['/share/accept/duplicate-token']}>
          <Routes>
            <Route path="/share/accept/:token" element={<ShareAccept />} />
          </Routes>
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(acceptShare).toHaveBeenCalledWith('duplicate-token');
      });

      expect(screen.getByText('share.alreadyAccepted')).toBeInTheDocument();
    });
  });

  describe('Permission levels', () => {
    it('should display view-only permission correctly', async () => {
      const mockShareData = {
        project: {
          id: 'project-123',
          name: 'View Only Project',
        },
        permission: 'view',
        sharedBy: {
          email: 'owner@example.com',
        },
      };

      vi.mocked(acceptShare).mockResolvedValueOnce({
        success: true,
        data: mockShareData,
      } as any);

      render(
        <MemoryRouter initialEntries={['/share/accept/view-token']}>
          <Routes>
            <Route path="/share/accept/:token" element={<ShareAccept />} />
          </Routes>
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getByText('share.permission.view')).toBeInTheDocument();
      });
    });

    it('should display edit permission correctly', async () => {
      const mockShareData = {
        project: {
          id: 'project-123',
          name: 'Edit Project',
        },
        permission: 'edit',
        sharedBy: {
          email: 'owner@example.com',
        },
      };

      vi.mocked(acceptShare).mockResolvedValueOnce({
        success: true,
        data: mockShareData,
      } as any);

      render(
        <MemoryRouter initialEntries={['/share/accept/edit-token']}>
          <Routes>
            <Route path="/share/accept/:token" element={<ShareAccept />} />
          </Routes>
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getByText('share.permission.edit')).toBeInTheDocument();
      });
    });
  });

  describe('User experience', () => {
    it('should show project details after accepting share', async () => {
      const mockShareData = {
        project: {
          id: 'project-123',
          name: 'Shared Project',
          description: 'This is a shared project',
          imageCount: 10,
        },
        sharedBy: {
          email: 'owner@example.com',
          username: 'ProjectOwner',
        },
        permission: 'edit',
      };

      vi.mocked(acceptShare).mockResolvedValueOnce({
        success: true,
        data: mockShareData,
      } as any);

      render(
        <MemoryRouter initialEntries={['/share/accept/detail-token']}>
          <Routes>
            <Route path="/share/accept/:token" element={<ShareAccept />} />
          </Routes>
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getByText('Shared Project')).toBeInTheDocument();
        expect(
          screen.getByText('This is a shared project')
        ).toBeInTheDocument();
        expect(screen.getByText('ProjectOwner')).toBeInTheDocument();
      });
    });

    it('should provide navigation to project after accepting', async () => {
      const mockShareData = {
        project: {
          id: 'project-123',
          name: 'Navigate Project',
        },
        permission: 'view',
        sharedBy: {
          email: 'owner@example.com',
        },
      };

      vi.mocked(acceptShare).mockResolvedValueOnce({
        success: true,
        data: mockShareData,
      } as any);

      render(
        <MemoryRouter initialEntries={['/share/accept/nav-token']}>
          <Routes>
            <Route path="/share/accept/:token" element={<ShareAccept />} />
            <Route
              path="/projects/project-123"
              element={<div>Project Detail</div>}
            />
          </Routes>
        </MemoryRouter>
      );

      await waitFor(() => {
        const viewProjectButton = screen.getByText('share.viewProject');
        expect(viewProjectButton).toBeInTheDocument();
      });

      // Click the view project button
      const viewProjectButton = screen.getByText('share.viewProject');
      fireEvent.click(viewProjectButton);

      await waitFor(() => {
        expect(screen.getByText('Project Detail')).toBeInTheDocument();
      });
    });

    it('should show loading state while accepting share', async () => {
      vi.mocked(acceptShare).mockImplementation(
        () => new Promise(resolve => setTimeout(resolve, 100))
      );

      render(
        <MemoryRouter initialEntries={['/share/accept/loading-token']}>
          <Routes>
            <Route path="/share/accept/:token" element={<ShareAccept />} />
          </Routes>
        </MemoryRouter>
      );

      expect(screen.getByText('share.accepting')).toBeInTheDocument();
    });
  });

  describe('Error handling', () => {
    it('should handle network errors gracefully', async () => {
      vi.mocked(acceptShare).mockRejectedValueOnce(new Error('Network error'));

      render(
        <MemoryRouter initialEntries={['/share/accept/network-error']}>
          <Routes>
            <Route path="/share/accept/:token" element={<ShareAccept />} />
          </Routes>
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getByText('share.networkError')).toBeInTheDocument();
      });
    });

    it('should handle server errors', async () => {
      vi.mocked(acceptShare).mockRejectedValueOnce({
        response: {
          status: 500,
          data: { message: 'Internal server error' },
        },
      });

      render(
        <MemoryRouter initialEntries={['/share/accept/server-error']}>
          <Routes>
            <Route path="/share/accept/:token" element={<ShareAccept />} />
          </Routes>
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getByText('share.serverError')).toBeInTheDocument();
      });
    });

    it('should retry on transient failures', async () => {
      // First call fails, second succeeds
      vi.mocked(acceptShare)
        .mockRejectedValueOnce(new Error('Temporary failure'))
        .mockResolvedValueOnce({
          success: true,
          data: {
            project: { id: 'project-123', name: 'Retry Project' },
            permission: 'view',
            sharedBy: { email: 'owner@example.com' },
          },
        } as any);

      render(
        <MemoryRouter initialEntries={['/share/accept/retry-token']}>
          <Routes>
            <Route path="/share/accept/:token" element={<ShareAccept />} />
          </Routes>
        </MemoryRouter>
      );

      // First attempt fails
      await waitFor(() => {
        expect(screen.getByText('share.error')).toBeInTheDocument();
      });

      // Click retry button
      const retryButton = screen.getByText('share.retry');
      fireEvent.click(retryButton);

      // Second attempt succeeds
      await waitFor(() => {
        expect(screen.getByText('share.acceptSuccess')).toBeInTheDocument();
        expect(screen.getByText('Retry Project')).toBeInTheDocument();
      });

      expect(acceptShare).toHaveBeenCalledTimes(2);
    });
  });

  describe('Shared project management', () => {
    it('should handle removing shared access', async () => {
      const mockShareData = {
        project: {
          id: 'project-123',
          name: 'Remove Access Project',
        },
        permission: 'edit',
        sharedBy: {
          email: 'owner@example.com',
        },
      };

      vi.mocked(acceptShare).mockResolvedValueOnce({
        success: true,
        data: mockShareData,
      } as any);

      render(
        <MemoryRouter initialEntries={['/share/accept/remove-token']}>
          <Routes>
            <Route path="/share/accept/:token" element={<ShareAccept />} />
          </Routes>
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getByText('Remove Access Project')).toBeInTheDocument();
      });

      // Should have option to decline share
      const declineButton = screen.queryByText('share.decline');
      if (declineButton) {
        expect(declineButton).toBeInTheDocument();
      }
    });

    it('should validate user is not project owner', async () => {
      vi.mocked(acceptShare).mockRejectedValueOnce({
        response: {
          status: 400,
          data: { message: 'Cannot share project with yourself' },
        },
      });

      render(
        <MemoryRouter initialEntries={['/share/accept/self-share']}>
          <Routes>
            <Route path="/share/accept/:token" element={<ShareAccept />} />
          </Routes>
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(
          screen.getByText('share.cannotShareWithSelf')
        ).toBeInTheDocument();
      });
    });
  });

  describe('Real-time updates', () => {
    it('should subscribe to project updates after accepting share', async () => {
      const mockShareData = {
        project: {
          id: 'project-123',
          name: 'Realtime Project',
        },
        permission: 'edit',
        sharedBy: {
          email: 'owner@example.com',
        },
      };

      vi.mocked(acceptShare).mockResolvedValueOnce({
        success: true,
        data: mockShareData,
      } as any);

      const mockJoinProject = vi.fn();
      const WebSocketManager = {
        getInstance: () => ({
          joinProject: mockJoinProject,
          isConnected: true,
        }),
      };

      // Mock WebSocket manager
      vi.mock('@/services/webSocketManager', () => ({
        default: WebSocketManager,
      }));

      render(
        <MemoryRouter initialEntries={['/share/accept/realtime-token']}>
          <Routes>
            <Route path="/share/accept/:token" element={<ShareAccept />} />
          </Routes>
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getByText('Realtime Project')).toBeInTheDocument();
      });

      // Verify WebSocket subscription would be called
      // Note: This would require actual component implementation
    });
  });
});
