/**
 * KymographModal — behavioral unit tests
 *
 * Covered behaviours:
 *  - Renders dialog when open=true with polylineId in title
 *  - Does not call the API when open=false
 *  - Loading spinner shown while API call is in flight
 *  - Error message shown when API call rejects
 *  - Kymograph image rendered with correct base64 src on success
 *  - Tracked / untracked label shown after load
 *  - PNG and CSV download buttons disabled while loading
 *  - PNG and CSV download buttons enabled after result loads
 *  - Channel selector rendered only when channels.length > 1
 *  - Channel selector NOT rendered for single channel
 *  - Channel selector NOT rendered when channels is null
 *  - Default channel prefers fluorescent channel
 *  - Default channel falls back to segmentation source when no fluorescent channel
 *  - Default channel falls back to first channel when none special
 *  - Download PNG triggers blob creation and anchor click
 *  - API payload includes videoContainerId, polylineId, frameIndex
 *  - channelColor from ImageDisplayContext sent in payload
 *  - channelColor defaults to #FFFFFF when channel not in context map
 *
 * NOT tested (genuinely untestable without real browser):
 *  - URL.createObjectURL / anchor download actually saves a file
 *  - Radix Dialog focus trapping / portal positioning
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
// Use the project's AllProviders wrapper so AuthProvider + LanguageProvider are present
import { render } from '@/test/utils/test-utils';
import type { VideoChannel } from '@/types';

// ── Mocks must be hoisted before component import ─────────────────────────────

// The component calls `apiClient.post(...)` using the default export.
// Override `post` in the mock while keeping the rest of the global mock intact.
const mockApiPost = vi.fn();
vi.mock('@/lib/api', () => ({
  default: {
    login: vi.fn(),
    logout: vi.fn(),
    register: vi.fn(),
    refreshAccessToken: vi.fn(),
    getUserProfile: vi
      .fn()
      .mockResolvedValue({ preferred_theme: 'system', preferredLang: 'en' }),
    updateUserProfile: vi.fn(),
    changePassword: vi.fn(),
    getUserStorageStats: vi.fn(),
    deleteAccount: vi.fn(),
    getProjects: vi.fn(() =>
      Promise.resolve({ projects: [], total: 0, page: 1, totalPages: 1 })
    ),
    createProject: vi.fn(),
    getProject: vi.fn(),
    updateProject: vi.fn(),
    deleteProject: vi.fn(),
    getProjectImages: vi.fn(() =>
      Promise.resolve({ images: [], total: 0, page: 1, totalPages: 1 })
    ),
    uploadImages: vi.fn(() => Promise.resolve([])),
    getImage: vi.fn(),
    deleteImage: vi.fn(),
    requestBatchSegmentation: vi.fn(),
    getSegmentationResults: vi.fn(() => Promise.resolve(null)),
    updateSegmentationResults: vi.fn(() => Promise.resolve({ polygons: [] })),
    deleteSegmentationResults: vi.fn(),
    addImageToQueue: vi.fn(),
    addBatchToQueue: vi.fn(),
    getQueueStats: vi.fn(() =>
      Promise.resolve({
        total: 0,
        queued: 0,
        processing: 0,
        completed: 0,
        failed: 0,
      })
    ),
    getQueueItems: vi.fn(() => Promise.resolve([])),
    removeFromQueue: vi.fn(),
    submitFeedback: vi.fn(() =>
      Promise.resolve({ id: 'fb-test', emailQueued: true })
    ),
    // The method the component actually uses:
    post: (...args: unknown[]) => mockApiPost(...args),
    get: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
  apiClient: {
    post: (...args: unknown[]) => mockApiPost(...args),
    get: vi.fn(),
  },
}));

// ── Mock ImageDisplayContext ──────────────────────────────────────────────────
vi.mock('../../contexts/ImageDisplayContext', () => ({
  useImageDisplay: () => ({
    channelColors: { CH1: '#FF0000', CH2: '#00FF00' },
  }),
}));

import { KymographModal } from '../KymographModal';

// ── Helpers ───────────────────────────────────────────────────────────────────

const mockResult = {
  pngBase64: btoa('fake-png-bytes'),
  csvBase64: btoa('fake-csv-bytes'),
  frameCount: 10,
  lengthPx: 200,
  tracked: true,
  sourceChannel: 'CH1',
};

function makeChannels(overrides: Partial<VideoChannel>[] = []): VideoChannel[] {
  return overrides.map((o, i) => ({
    name: `CH${i + 1}`,
    displayName: `Channel ${i + 1}`,
    type: 'fluorescent' as const,
    isSegmentationSource: false,
    frameCount: 5,
    ...o,
  }));
}

const defaultProps = {
  open: true,
  onClose: vi.fn(),
  videoContainerId: 'vid-1',
  polylineId: 'poly-42',
  frameIndex: 0,
  channels: makeChannels([{ name: 'CH1' }]),
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('KymographModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: return a pending promise so we can test loading state
    mockApiPost.mockReturnValue(new Promise(() => {}));

    global.URL.createObjectURL = vi.fn(() => 'blob:mock');
    global.URL.revokeObjectURL = vi.fn();
  });

  describe('Dialog open / closed', () => {
    it('renders polylineId in the title when open=true', async () => {
      mockApiPost.mockResolvedValue({ data: { data: mockResult } });
      render(<KymographModal {...defaultProps} polylineId="poly-99" />);
      // Title contains the polylineId text
      expect(screen.getByText(/poly-99/)).toBeInTheDocument();
    });

    it('does not call the API when open=false', () => {
      render(<KymographModal {...defaultProps} open={false} />);
      expect(mockApiPost).not.toHaveBeenCalled();
    });
  });

  describe('Loading state', () => {
    it('shows computing spinner while request is in flight', () => {
      render(<KymographModal {...defaultProps} />);
      expect(screen.getByText(/Computing kymograph/i)).toBeInTheDocument();
    });

    it('PNG button is disabled while loading', () => {
      render(<KymographModal {...defaultProps} />);
      expect(screen.getByRole('button', { name: /PNG/i })).toBeDisabled();
    });

    it('CSV button is disabled while loading', () => {
      render(<KymographModal {...defaultProps} />);
      expect(screen.getByRole('button', { name: /CSV/i })).toBeDisabled();
    });
  });

  describe('Error state', () => {
    it('shows error message when API rejects', async () => {
      mockApiPost.mockRejectedValue(new Error('network timeout'));
      render(<KymographModal {...defaultProps} />);
      await waitFor(() =>
        expect(screen.getByText('network timeout')).toBeInTheDocument()
      );
    });
  });

  describe('Successful load', () => {
    it('renders kymograph image with base64 src after load', async () => {
      mockApiPost.mockResolvedValue({ data: { data: mockResult } });
      render(<KymographModal {...defaultProps} />);
      await waitFor(() =>
        expect(
          screen.getByAltText(/Kymograph for poly-42/i)
        ).toBeInTheDocument()
      );
      const img = screen.getByAltText(
        /Kymograph for poly-42/i
      ) as HTMLImageElement;
      expect(img.src).toContain('data:image/png;base64,');
    });

    it('shows tracked label when result.tracked=true', async () => {
      mockApiPost.mockResolvedValue({
        data: { data: { ...mockResult, tracked: true } },
      });
      render(<KymographModal {...defaultProps} />);
      await waitFor(() =>
        expect(screen.getByText(/Tracked across frames/i)).toBeInTheDocument()
      );
    });

    it('shows untracked label when result.tracked=false', async () => {
      mockApiPost.mockResolvedValue({
        data: { data: { ...mockResult, tracked: false } },
      });
      render(<KymographModal {...defaultProps} />);
      await waitFor(() =>
        expect(screen.getByText(/Static line/i)).toBeInTheDocument()
      );
    });

    it('enables PNG button after result loads', async () => {
      mockApiPost.mockResolvedValue({ data: { data: mockResult } });
      render(<KymographModal {...defaultProps} />);
      await waitFor(() =>
        expect(screen.getByRole('button', { name: /PNG/i })).not.toBeDisabled()
      );
    });

    it('enables CSV button after result loads', async () => {
      mockApiPost.mockResolvedValue({ data: { data: mockResult } });
      render(<KymographModal {...defaultProps} />);
      await waitFor(() =>
        expect(screen.getByRole('button', { name: /CSV/i })).not.toBeDisabled()
      );
    });
  });

  describe('Channel selector', () => {
    it('channel selector rendered when channels.length > 1', () => {
      render(
        <KymographModal
          {...defaultProps}
          channels={makeChannels([{ name: 'CH1' }, { name: 'CH2' }])}
        />
      );
      expect(screen.getByText('Source channel')).toBeInTheDocument();
    });

    it('channel selector NOT rendered for single channel', () => {
      render(
        <KymographModal
          {...defaultProps}
          channels={makeChannels([{ name: 'CH1' }])}
        />
      );
      expect(screen.queryByText('Source channel')).not.toBeInTheDocument();
    });

    it('channel selector NOT rendered when channels is null', () => {
      render(<KymographModal {...defaultProps} channels={null} />);
      expect(screen.queryByText('Source channel')).not.toBeInTheDocument();
    });
  });

  describe('Default channel selection', () => {
    it('prefers fluorescent channel as default', () => {
      render(
        <KymographModal
          {...defaultProps}
          channels={makeChannels([
            {
              name: 'IRM',
              type: 'irm' as VideoChannel['type'],
              isSegmentationSource: true,
            },
            {
              name: 'FL',
              type: 'fluorescent' as VideoChannel['type'],
              isSegmentationSource: false,
            },
          ])}
        />
      );
      expect(mockApiPost).toHaveBeenCalledWith(
        '/segmentation/kymograph',
        expect.objectContaining({ sourceChannel: 'FL' })
      );
    });

    it('falls back to segmentation source when no fluorescent channel', () => {
      render(
        <KymographModal
          {...defaultProps}
          channels={makeChannels([
            {
              name: 'IRM',
              type: 'irm' as VideoChannel['type'],
              isSegmentationSource: true,
            },
            {
              name: 'BF',
              type: 'brightfield' as VideoChannel['type'],
              isSegmentationSource: false,
            },
          ])}
        />
      );
      expect(mockApiPost).toHaveBeenCalledWith(
        '/segmentation/kymograph',
        expect.objectContaining({ sourceChannel: 'IRM' })
      );
    });

    it('falls back to first channel when no special channels', () => {
      render(
        <KymographModal
          {...defaultProps}
          channels={makeChannels([
            {
              name: 'RAW',
              type: 'brightfield' as VideoChannel['type'],
              isSegmentationSource: false,
            },
            {
              name: 'OTHER',
              type: 'brightfield' as VideoChannel['type'],
              isSegmentationSource: false,
            },
          ])}
        />
      );
      expect(mockApiPost).toHaveBeenCalledWith(
        '/segmentation/kymograph',
        expect.objectContaining({ sourceChannel: 'RAW' })
      );
    });
  });

  describe('Download buttons', () => {
    it('PNG download triggers blob creation and anchor click', async () => {
      const user = userEvent.setup();
      mockApiPost.mockResolvedValue({ data: { data: mockResult } });

      const clickSpy = vi.fn();
      const origCreate = document.createElement.bind(document);
      vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
        const el = origCreate(tag);
        if (tag === 'a') el.click = clickSpy;
        return el;
      });

      render(<KymographModal {...defaultProps} />);
      await waitFor(() =>
        expect(screen.getByRole('button', { name: /PNG/i })).not.toBeDisabled()
      );

      await user.click(screen.getByRole('button', { name: /PNG/i }));
      expect(clickSpy).toHaveBeenCalled();
      expect(global.URL.createObjectURL).toHaveBeenCalled();

      vi.restoreAllMocks();
    });
  });

  describe('API payload', () => {
    it('sends videoContainerId, polylineId, frameIndex in the payload', () => {
      render(<KymographModal {...defaultProps} frameIndex={3} />);
      expect(mockApiPost).toHaveBeenCalledWith(
        '/segmentation/kymograph',
        expect.objectContaining({
          videoContainerId: 'vid-1',
          polylineId: 'poly-42',
          frameIndex: 3,
        })
      );
    });

    it('passes channelColor from ImageDisplayContext (CH1 → #FF0000)', () => {
      render(
        <KymographModal
          {...defaultProps}
          channels={makeChannels([{ name: 'CH1', type: 'fluorescent' }])}
        />
      );
      expect(mockApiPost).toHaveBeenCalledWith(
        '/segmentation/kymograph',
        expect.objectContaining({ channelColor: '#FF0000' })
      );
    });

    it('defaults channelColor to #FFFFFF when channel not in context map', () => {
      render(
        <KymographModal
          {...defaultProps}
          channels={makeChannels([{ name: 'UNKNOWN_CH', type: 'fluorescent' }])}
        />
      );
      expect(mockApiPost).toHaveBeenCalledWith(
        '/segmentation/kymograph',
        expect.objectContaining({ channelColor: '#FFFFFF' })
      );
    });
  });
});
