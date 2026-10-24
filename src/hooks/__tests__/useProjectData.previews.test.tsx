import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useProjectData, mapGalleryImage } from '@/hooks/useProjectData';
import apiClient from '@/lib/api';
import { LanguageProvider } from '@/contexts/LanguageContext';
import { AuthProvider } from '@/contexts/AuthContext';

/**
 * The project page's image list after the preview rework: ONE mapper, a
 * re-list that REPLACES local state, and live preview patches.
 */

vi.mock('@/lib/api', () => ({
  default: {
    getUserProfile: vi.fn(),
    getProject: vi.fn(),
    getProjectImagesWithThumbnails: vi.fn(),
    getSegmentationResults: vi.fn(),
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
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const P1 = '/api/images/img-1/preview?v=1111111111111111';
const P1_EDITED = '/api/images/img-1/preview?v=2222222222222222';
const P2 = '/api/images/img-2/preview?v=3333333333333333';

function row(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    name: `${id}.png`,
    url: `/api/images/${id}/display`,
    thumbnail_url: `/uploads/${id}.jpg`,
    createdAt: '2026-10-24T10:00:00.000Z',
    updatedAt: '2026-10-24T10:00:00.000Z',
    segmentationStatus: 'segmented',
    ...extra,
  };
}

function listing(rows: unknown[]) {
  return {
    images: rows,
    pagination: { page: 1, limit: 100, total: rows.length, pages: 1 },
    metadata: {
      levelOfDetail: 'low',
      totalImages: rows.length,
      imagesWithThumbnails: 0,
    },
  } as never;
}

describe('useProjectData — previews', () => {
  let queryClient: QueryClient;
  const wrapper = ({ children }: { children: ReactNode }) => (
    <MemoryRouter>
      <AuthProvider>
        <QueryClientProvider client={queryClient}>
          <LanguageProvider>{children}</LanguageProvider>
        </QueryClientProvider>
      </AuthProvider>
    </MemoryRouter>
  );

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    vi.mocked(apiClient.getProject).mockResolvedValue({
      id: 'proj-1',
      name: 'P',
      type: 'spheroid',
    } as never);
  });

  async function loaded(first: unknown[]) {
    vi.mocked(apiClient.getProjectImagesWithThumbnails).mockResolvedValueOnce(
      listing(first)
    );
    const hook = renderHook(() => useProjectData('proj-1', 'user-1'), {
      wrapper,
    });
    await waitFor(() => expect(hook.result.current.loading).toBe(false));
    return hook;
  }

  it('maps previewUrl and the video fields through the one mapper', () => {
    const image = mapGalleryImage(
      row('f-1', {
        previewUrl: P1,
        parentVideoId: 'vid-1',
        frameIndex: 7,
        channels: [{ name: 'IRM' }],
        originalPath: 'projects/p/images/vid-1/frames/0007/IRM.png',
      })
    );
    expect(image.previewUrl).toBe(P1);
    expect(image.parentVideoId).toBe('vid-1');
    expect(image.frameIndex).toBe(7);
    expect(image.segmentationStatus).toBe('completed');
  });

  it('reloadImages REPLACES local state — a preview the server no longer sends is gone', async () => {
    const { result } = await loaded([row('img-1', { previewUrl: P1 })]);
    expect(result.current.images[0].previewUrl).toBe(P1);

    // After a deleted segmentation the server sends a NEW URL; the old merge
    // "preserved" the previous one whenever the new value was falsy.
    vi.mocked(apiClient.getProjectImagesWithThumbnails).mockResolvedValueOnce(
      listing([
        row('img-1', {
          previewUrl: P1_EDITED,
          segmentationStatus: 'no_segmentation',
        }),
      ])
    );
    await act(async () => {
      await result.current.reloadImages();
    });

    expect(result.current.images[0].previewUrl).toBe(P1_EDITED);
    expect(result.current.images[0].segmentationStatus).toBe('no_segmentation');
  });

  it('drops a slower, older reload that finishes after a newer one', async () => {
    const { result } = await loaded([row('img-1', { previewUrl: P1 })]);

    let releaseOld!: (v: unknown) => void;
    vi.mocked(apiClient.getProjectImagesWithThumbnails)
      .mockImplementationOnce(() => new Promise(r => (releaseOld = r)) as never)
      .mockResolvedValueOnce(
        listing([row('img-1', { previewUrl: P1_EDITED })])
      );

    let older!: Promise<void>;
    await act(async () => {
      older = result.current.reloadImages();
      await result.current.reloadImages();
    });
    await act(async () => {
      releaseOld(listing([row('img-1', { previewUrl: P1 })]));
      await older;
    });

    expect(result.current.images[0].previewUrl).toBe(P1_EDITED);
  });

  it('applyPreviewUpdates patches only the named rows and keeps the others identical', async () => {
    const { result } = await loaded([
      row('img-1', { previewUrl: P1 }),
      row('img-2', { previewUrl: P2 }),
    ]);
    const untouched = result.current.images[1];

    act(() => {
      result.current.applyPreviewUpdates([
        { imageId: 'img-1', previewUrl: P1_EDITED },
      ]);
    });

    expect(result.current.images[0].previewUrl).toBe(P1_EDITED);
    // Same object: a memoised card for img-2 does not re-render.
    expect(result.current.images[1]).toBe(untouched);
  });

  it('applyPreviewUpdates with nothing new keeps the very same array', async () => {
    const { result } = await loaded([row('img-1', { previewUrl: P1 })]);
    const before = result.current.images;

    act(() => {
      result.current.applyPreviewUpdates([
        { imageId: 'img-1', previewUrl: P1 },
      ]);
      result.current.applyPreviewUpdates([
        { imageId: 'unknown', previewUrl: P2 },
      ]);
    });

    expect(result.current.images).toBe(before);
  });
});
