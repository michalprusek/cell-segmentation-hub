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
    isAuthenticated: vi.fn(() => false),
    getUserProfile: vi.fn(),
    login: vi.fn(),
    logout: vi.fn(),
    register: vi.fn(),
    getAccessToken: vi.fn(),
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

vi.mock('@/lib/imageProcessingService', () => ({
  updateImageProcessingStatus: vi.fn(),
}));

import apiClient from '@/lib/api';
import { toast } from 'sonner';
import { updateImageProcessingStatus } from '@/lib/imageProcessingService';
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

  describe('handleProcessImage', () => {
    it('calls updateImageProcessingStatus and returns true on success', async () => {
      const images = [makeImage('img-1')];
      const onImagesChange = vi.fn();
      const mockSegResult = { polygons: [], imageWidth: 100, imageHeight: 100 };

      vi.mocked(updateImageProcessingStatus).mockImplementation(
        async ({ onComplete }) => {
          onComplete?.(mockSegResult as any);
          return { cancel: vi.fn() };
        }
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

      let returnValue: boolean | undefined;
      await act(async () => {
        returnValue = await result.current.handleProcessImage('img-1');
      });

      expect(returnValue).toBe(true);
      expect(vi.mocked(updateImageProcessingStatus)).toHaveBeenCalledTimes(1);
    });

    it('prevents duplicate processing of same image', async () => {
      const images = [makeImage('img-1')];
      const onImagesChange = vi.fn();

      // Never resolves so the image stays in-flight
      vi.mocked(updateImageProcessingStatus).mockImplementation(
        () => new Promise(() => {})
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

      // First call — fire and don't await
      act(() => {
        result.current.handleProcessImage('img-1');
      });

      // Second call immediately
      await act(async () => {
        const secondResult = await result.current.handleProcessImage('img-1');
        expect(secondResult).toBe(false);
      });

      expect(vi.mocked(toast.info)).toHaveBeenCalledTimes(1);
      expect(vi.mocked(updateImageProcessingStatus)).toHaveBeenCalledTimes(1);
    });

    it('returns false and shows error when updateImageProcessingStatus rejects', async () => {
      const images = [makeImage('img-1')];
      const onImagesChange = vi.fn();

      vi.mocked(updateImageProcessingStatus).mockRejectedValue(
        new Error('Processing failed')
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

      let returnValue: boolean | undefined;
      await act(async () => {
        returnValue = await result.current.handleProcessImage('img-1');
      });

      expect(returnValue).toBe(false);
      expect(vi.mocked(toast.error)).toHaveBeenCalledTimes(1);
    });

    it('returns false when image is not found in images list', async () => {
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

      let returnValue: boolean | undefined;
      await act(async () => {
        returnValue = await result.current.handleProcessImage('nonexistent');
      });

      expect(returnValue).toBe(false);
      expect(vi.mocked(updateImageProcessingStatus)).not.toHaveBeenCalled();
    });

    it('sets image segmentationStatus to processing immediately', async () => {
      const images = [makeImage('img-1', { segmentationStatus: 'pending' })];
      const onImagesChange = vi.fn();

      // Hang indefinitely so we can observe the immediate update
      vi.mocked(updateImageProcessingStatus).mockImplementation(
        () => new Promise(() => {})
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

      act(() => {
        result.current.handleProcessImage('img-1');
      });

      await waitFor(() => {
        expect(onImagesChange).toHaveBeenCalledWith(
          expect.arrayContaining([
            expect.objectContaining({
              id: 'img-1',
              segmentationStatus: 'processing',
            }),
          ])
        );
      });
    });

    it('tracks processingImages IDs during in-flight operations', async () => {
      const images = [makeImage('img-1')];
      const onImagesChange = vi.fn();

      vi.mocked(updateImageProcessingStatus).mockImplementation(
        () => new Promise(() => {})
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

      act(() => {
        result.current.handleProcessImage('img-1');
      });

      await waitFor(() => {
        expect(result.current.processingImages).toContain('img-1');
      });
    });

    it('removes imageId from processingImages after completion', async () => {
      const images = [makeImage('img-1')];
      const onImagesChange = vi.fn();
      const mockSegResult = { polygons: [], imageWidth: 100, imageHeight: 100 };

      vi.mocked(updateImageProcessingStatus).mockImplementation(
        async ({ onComplete }) => {
          onComplete?.(mockSegResult as any);
          return { cancel: vi.fn() };
        }
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
        await result.current.handleProcessImage('img-1');
      });

      expect(result.current.processingImages).not.toContain('img-1');
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
