import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ReactNode } from 'react';
import { useProjectImageActions } from '@/hooks/useProjectImageActions';
import { AuthProvider } from '@/contexts/AuthContext';
import { LanguageProvider } from '@/contexts/LanguageContext';

const mockNavigate = vi.fn();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

vi.mock('@/lib/api', () => ({
  default: {
    getUserProfile: vi.fn(),
    login: vi.fn(),
    logout: vi.fn(),
    register: vi.fn(),
    updateUserProfile: vi.fn(),
    deleteAccount: vi.fn(),
    deleteImage: vi.fn(),
  },
}));

vi.mock('@/lib/authEvents', () => ({
  authEventEmitter: { emit: vi.fn(), on: vi.fn(), off: vi.fn() },
}));

vi.mock('@/lib/tokenRefresh', () => ({
  tokenRefreshManager: {
    startTokenRefreshManager: vi.fn(),
    stopTokenRefreshManager: vi.fn(),
  },
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
  },
}));

import apiClient from '@/lib/api';
import { toast } from 'sonner';
import type { ProjectImage } from '@/types';

const makeImage = (
  id: string,
  overrides: Partial<ProjectImage> = {}
): ProjectImage => ({
  id,
  name: `image-${id}.jpg`,
  url: `http://localhost:3001/images/${id}.jpg`,
  thumbnailUrl: `http://localhost:3001/thumbs/${id}.jpg`,
  displayUrl: `http://localhost:3001/images/${id}.jpg`,
  originalPath: `/uploads/${id}.jpg`,
  thumbnailPath: `/thumbs/${id}.jpg`,
  segmentationStatus: 'pending',
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01'),
  ...overrides,
});

describe('useProjectImageActions', () => {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <MemoryRouter>
      <AuthProvider>
        <LanguageProvider>{children}</LanguageProvider>
      </AuthProvider>
    </MemoryRouter>
  );

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('handleDeleteImage', () => {
    it('calls deleteImage API and updates images on success', async () => {
      const images = [makeImage('img-1'), makeImage('img-2')];
      const onImagesChange = vi.fn();
      vi.mocked(apiClient.deleteImage).mockResolvedValue(undefined);

      const { result } = renderHook(
        () =>
          useProjectImageActions({
            projectId: 'proj-1',
            images,
            onImagesChange,
          }),
        { wrapper }
      );

      await act(async () => {
        await result.current.handleDeleteImage('img-1');
      });

      expect(vi.mocked(apiClient.deleteImage)).toHaveBeenCalledWith(
        'proj-1',
        'img-1'
      );
      expect(onImagesChange).toHaveBeenCalledWith([images[1]]);
    });

    it('shows toast error when deleteImage API fails', async () => {
      const images = [makeImage('img-1')];
      const onImagesChange = vi.fn();
      vi.mocked(apiClient.deleteImage).mockRejectedValue(
        new Error('Delete failed')
      );

      const { result } = renderHook(
        () =>
          useProjectImageActions({
            projectId: 'proj-1',
            images,
            onImagesChange,
          }),
        { wrapper }
      );

      await act(async () => {
        await result.current.handleDeleteImage('img-1');
      });

      expect(vi.mocked(toast.error)).toHaveBeenCalledTimes(1);
      expect(onImagesChange).not.toHaveBeenCalled();
    });

    it('returns early without API call when projectId is missing', async () => {
      const images = [makeImage('img-1')];
      const onImagesChange = vi.fn();

      const { result } = renderHook(
        () =>
          useProjectImageActions({
            projectId: undefined,
            images,
            onImagesChange,
          }),
        { wrapper }
      );

      await act(async () => {
        await result.current.handleDeleteImage('img-1');
      });

      expect(vi.mocked(apiClient.deleteImage)).not.toHaveBeenCalled();
      expect(onImagesChange).not.toHaveBeenCalled();
    });

    it('dispatches project-image-deleted event on successful delete', async () => {
      const images = [makeImage('img-1'), makeImage('img-2')];
      const onImagesChange = vi.fn();
      vi.mocked(apiClient.deleteImage).mockResolvedValue(undefined);

      const dispatchSpy = vi.spyOn(window, 'dispatchEvent');

      const { result } = renderHook(
        () =>
          useProjectImageActions({
            projectId: 'proj-1',
            images,
            onImagesChange,
          }),
        { wrapper }
      );

      await act(async () => {
        await result.current.handleDeleteImage('img-1');
      });

      const dispatchedEvent = dispatchSpy.mock.calls.find(
        call =>
          call[0] instanceof CustomEvent &&
          call[0].type === 'project-image-deleted'
      );
      expect(dispatchedEvent).toBeTruthy();
    });
  });

  describe('handleOpenSegmentationEditor', () => {
    it('navigates to segmentation editor route', async () => {
      const images = [makeImage('img-1')];
      const onImagesChange = vi.fn();

      const { result } = renderHook(
        () =>
          useProjectImageActions({
            projectId: 'proj-1',
            images,
            onImagesChange,
          }),
        { wrapper }
      );

      await act(async () => {
        await result.current.handleOpenSegmentationEditor('img-1');
      });

      await waitFor(() => {
        expect(mockNavigate).toHaveBeenCalledWith('/segmentation/proj-1/img-1');
      });
    });

    it('does not navigate when projectId is missing', async () => {
      const images = [makeImage('img-1')];
      const onImagesChange = vi.fn();

      const { result } = renderHook(
        () =>
          useProjectImageActions({
            projectId: undefined,
            images,
            onImagesChange,
          }),
        { wrapper }
      );

      await act(async () => {
        await result.current.handleOpenSegmentationEditor('img-1');
      });

      expect(mockNavigate).not.toHaveBeenCalled();
    });

    it('does not navigate when image is not found', async () => {
      const images: ProjectImage[] = [];
      const onImagesChange = vi.fn();

      const { result } = renderHook(
        () =>
          useProjectImageActions({
            projectId: 'proj-1',
            images,
            onImagesChange,
          }),
        { wrapper }
      );

      await act(async () => {
        await result.current.handleOpenSegmentationEditor('nonexistent');
      });

      expect(mockNavigate).not.toHaveBeenCalled();
    });
  });
});
