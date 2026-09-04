import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, screen, waitFor } from '@testing-library/react';
import { render } from '@/test/utils/test-utils';
import ProjectThumbnail from '@/components/project/ProjectThumbnail';

// apiClient is globally mocked in setup.ts; we only need to control the
// getProjectImages return value per test.
import apiClient from '@/lib/api';

const mockGetProjectImages = vi.mocked(apiClient.getProjectImages);

describe('ProjectThumbnail', () => {
  const fallbackSrc = '/placeholder.svg';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Rendering ────────────────────────────────────────────────────────────

  describe('Initial render', () => {
    it('renders an <img> element', () => {
      mockGetProjectImages.mockResolvedValue({
        images: [],
        total: 0,
        page: 1,
        totalPages: 1,
      });
      render(
        <ProjectThumbnail
          projectId="proj-1"
          fallbackSrc={fallbackSrc}
          imageCount={0}
        />
      );
      expect(screen.getByRole('img')).toBeInTheDocument();
    });

    it('uses fallbackSrc immediately before async fetch resolves', () => {
      // Return a promise that never resolves during this test
      mockGetProjectImages.mockReturnValue(new Promise(() => {}));
      render(
        <ProjectThumbnail
          projectId="proj-1"
          fallbackSrc={fallbackSrc}
          imageCount={1}
        />
      );
      expect(screen.getByRole('img')).toHaveAttribute('src', fallbackSrc);
    });

    it('uses /placeholder.svg as absolute fallback when fallbackSrc is empty', () => {
      mockGetProjectImages.mockReturnValue(new Promise(() => {}));
      render(
        <ProjectThumbnail projectId="proj-1" fallbackSrc="" imageCount={1} />
      );
      expect(screen.getByRole('img')).toHaveAttribute(
        'src',
        '/placeholder.svg'
      );
    });
  });

  // ── imageCount = 0: no fetch ──────────────────────────────────────────────

  describe('No images (imageCount=0)', () => {
    it('does NOT call getProjectImages when imageCount is 0', () => {
      render(
        <ProjectThumbnail
          projectId="proj-1"
          fallbackSrc={fallbackSrc}
          imageCount={0}
        />
      );
      expect(mockGetProjectImages).not.toHaveBeenCalled();
    });

    it('renders with fallbackSrc when imageCount is 0', () => {
      render(
        <ProjectThumbnail
          projectId="proj-1"
          fallbackSrc={fallbackSrc}
          imageCount={0}
        />
      );
      expect(screen.getByRole('img')).toHaveAttribute('src', fallbackSrc);
    });
  });

  // ── Successful fetch ─────────────────────────────────────────────────────

  describe('Successful fetch', () => {
    it('displays the thumbnail_url returned by the API', async () => {
      mockGetProjectImages.mockResolvedValue({
        images: [
          { thumbnail_url: '/thumbs/first.jpg', image_url: '/imgs/first.jpg' },
        ] as any,
        total: 1,
        page: 1,
        totalPages: 1,
      });
      render(
        <ProjectThumbnail
          projectId="proj-1"
          fallbackSrc={fallbackSrc}
          imageCount={3}
        />
      );
      await waitFor(() =>
        expect(screen.getByRole('img')).toHaveAttribute(
          'src',
          '/thumbs/first.jpg'
        )
      );
    });

    it('falls back to image_url when thumbnail_url is absent', async () => {
      mockGetProjectImages.mockResolvedValue({
        images: [{ thumbnail_url: null, image_url: '/imgs/full.jpg' }] as any,
        total: 1,
        page: 1,
        totalPages: 1,
      });
      render(
        <ProjectThumbnail
          projectId="proj-1"
          fallbackSrc={fallbackSrc}
          imageCount={1}
        />
      );
      await waitFor(() =>
        expect(screen.getByRole('img')).toHaveAttribute('src', '/imgs/full.jpg')
      );
    });

    it('calls getProjectImages with limit:1', async () => {
      mockGetProjectImages.mockResolvedValue({
        images: [{ thumbnail_url: '/t.jpg', image_url: '/i.jpg' }] as any,
        total: 1,
        page: 1,
        totalPages: 1,
      });
      render(
        <ProjectThumbnail
          projectId="proj-abc"
          fallbackSrc={fallbackSrc}
          imageCount={5}
        />
      );
      await waitFor(() =>
        expect(mockGetProjectImages).toHaveBeenCalledWith('proj-abc', {
          limit: 1,
        })
      );
    });
  });

  // ── Empty response ───────────────────────────────────────────────────────

  describe('Empty API response', () => {
    it('keeps fallbackSrc when API returns an empty images array', async () => {
      mockGetProjectImages.mockResolvedValue({
        images: [],
        total: 0,
        page: 1,
        totalPages: 1,
      });
      render(
        <ProjectThumbnail
          projectId="proj-1"
          fallbackSrc={fallbackSrc}
          imageCount={1}
        />
      );
      await waitFor(() => expect(mockGetProjectImages).toHaveBeenCalled());
      expect(screen.getByRole('img')).toHaveAttribute('src', fallbackSrc);
    });
  });

  // ── Error handling ───────────────────────────────────────────────────────

  describe('Error handling', () => {
    it('keeps fallbackSrc on a 404 error and does NOT call onAccessError', async () => {
      const onAccessError = vi.fn();
      const err404 = { response: { status: 404 } };
      mockGetProjectImages.mockRejectedValue(err404);
      render(
        <ProjectThumbnail
          projectId="proj-1"
          fallbackSrc={fallbackSrc}
          imageCount={1}
          onAccessError={onAccessError}
        />
      );
      await waitFor(() => expect(mockGetProjectImages).toHaveBeenCalled());
      expect(screen.getByRole('img')).toHaveAttribute('src', fallbackSrc);
      expect(onAccessError).not.toHaveBeenCalled();
    });

    it('calls onAccessError with projectId on a 403 error', async () => {
      const onAccessError = vi.fn();
      const err403 = { response: { status: 403 } };
      mockGetProjectImages.mockRejectedValue(err403);
      render(
        <ProjectThumbnail
          projectId="proj-secret"
          fallbackSrc={fallbackSrc}
          imageCount={1}
          onAccessError={onAccessError}
        />
      );
      await waitFor(() =>
        expect(onAccessError).toHaveBeenCalledWith('proj-secret', err403)
      );
    });

    it('calls onAccessError on a 500 error', async () => {
      const onAccessError = vi.fn();
      const err500 = { response: { status: 500 } };
      mockGetProjectImages.mockRejectedValue(err500);
      render(
        <ProjectThumbnail
          projectId="proj-err"
          fallbackSrc={fallbackSrc}
          imageCount={1}
          onAccessError={onAccessError}
        />
      );
      await waitFor(() =>
        expect(onAccessError).toHaveBeenCalledWith('proj-err', err500)
      );
    });

    it('keeps fallbackSrc on a network error (no .response)', async () => {
      mockGetProjectImages.mockRejectedValue(new Error('Network Error'));
      render(
        <ProjectThumbnail
          projectId="proj-1"
          fallbackSrc={fallbackSrc}
          imageCount={1}
        />
      );
      await waitFor(() => expect(mockGetProjectImages).toHaveBeenCalled());
      expect(screen.getByRole('img')).toHaveAttribute('src', fallbackSrc);
    });
  });

  // ── fetch churn ──────────────────────────────────────────────────────────

  describe('fetch is driven by the project, not by the callback identity', () => {
    it('does not refetch when the parent re-renders with a fresh onAccessError', async () => {
      mockGetProjectImages.mockResolvedValue({
        images: [],
        total: 0,
        page: 1,
        totalPages: 1,
      });

      // Mirrors `ProjectCard` / `ProjectListItem`, which both declare
      // `handleAccessError` as a plain inline function — so it is a NEW
      // function object on every render of the card, exactly as in production.
      let bump: (() => void) | undefined;
      const Parent = () => {
        const [tick, setTick] = React.useState(0);
        bump = () => setTick(t => t + 1);
        const handleAccessError = (_id: string, _error: unknown) => {};
        return (
          <div data-tick={tick}>
            <ProjectThumbnail
              projectId="proj-1"
              fallbackSrc={fallbackSrc}
              imageCount={3}
              onAccessError={handleAccessError}
            />
          </div>
        );
      };

      render(<Parent />);
      await waitFor(() =>
        expect(mockGetProjectImages).toHaveBeenCalledTimes(1)
      );

      for (let i = 0; i < 5; i++) {
        act(() => {
          bump?.();
        });
      }
      await waitFor(() => expect(screen.getByRole('img')).toBeInTheDocument());

      // Before the ref fix this was 6 — one request per parent render.
      expect(mockGetProjectImages).toHaveBeenCalledTimes(1);
    });

    it('still reports an access error through the LATEST callback', async () => {
      const first = vi.fn();
      const second = vi.fn();
      const err403 = { response: { status: 403 } };
      // Never settles until we swap the callback, so the rejection is handled
      // after the second render — proving the ref is read at call time.
      let reject: ((e: unknown) => void) | undefined;
      mockGetProjectImages.mockReturnValue(
        new Promise((_res, rej) => {
          reject = rej;
        })
      );

      const { rerender } = render(
        <ProjectThumbnail
          projectId="proj-late"
          fallbackSrc={fallbackSrc}
          imageCount={1}
          onAccessError={first}
        />
      );
      rerender(
        <ProjectThumbnail
          projectId="proj-late"
          fallbackSrc={fallbackSrc}
          imageCount={1}
          onAccessError={second}
        />
      );
      await act(async () => {
        reject?.(err403);
      });

      await waitFor(() =>
        expect(second).toHaveBeenCalledWith('proj-late', err403)
      );
      expect(first).not.toHaveBeenCalled();
      // The swap must not have re-issued the request either.
      expect(mockGetProjectImages).toHaveBeenCalledTimes(1);
    });
  });

  // ── alt text ─────────────────────────────────────────────────────────────

  it('uses the i18n "Project" string as alt text', () => {
    mockGetProjectImages.mockResolvedValue({
      images: [],
      total: 0,
      page: 1,
      totalPages: 1,
    });
    render(
      <ProjectThumbnail
        projectId="proj-1"
        fallbackSrc={fallbackSrc}
        imageCount={0}
      />
    );
    expect(screen.getByRole('img')).toHaveAttribute('alt', 'Project');
  });
});
