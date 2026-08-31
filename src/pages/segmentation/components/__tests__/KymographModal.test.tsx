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
 * Performance behaviours (the reason this modal was reworked — a 300-frame
 * kymograph took 18.6–29.4 s end to end):
 *  - Velocity analysis is NOT requested on open (detectVelocity: false)
 *  - The "Analyse velocities" call-to-action is offered once the image loads
 *  - Clicking it issues exactly one follow-up request with detectVelocity: true
 *  - The kymograph image stays on screen while the velocity pass runs
 *  - A velocity request that cannot start reads as pending, not "none found"
 *  - A superseded request is aborted (AbortSignal) and shows no error
 *  - Unmounting aborts the in-flight request
 *  - Switching velocity analysis back off re-requests nothing
 *  - A failed velocity pass leaves the kymograph and its downloads intact
 *  - Recolouring an UNRELATED channel does not rebuild the kymograph
 *  - Changing an image input (frameIndex) does discard the stale image
 *  - A fresh open refetches rather than serving a cached (possibly stale)
 *    kymograph — the polyline can be edited between two opens
 *
 * NOT tested (genuinely untestable without real browser):
 *  - URL.createObjectURL / anchor download actually saves a file
 *  - Radix Dialog focus trapping / portal positioning
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  onlineManager,
  QueryClient,
  QueryClientProvider,
} from '@tanstack/react-query';
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
// Mutable so a test can reproduce what the real context does when the user
// recolours a channel: `setChannelColor` mints a BRAND NEW record object
// (ImageDisplayContext.tsx `{ ...s.channelColors, [channel]: color }`).
let mockChannelColors: Record<string, string> = {
  CH1: '#FF0000',
  CH2: '#00FF00',
};
vi.mock('../../contexts/ImageDisplayContext', () => ({
  useImageDisplay: () => ({ channelColors: mockChannelColors }),
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

/**
 * Harness for the tests that need the modal to re-render WITHOUT tearing down
 * the surrounding providers. RTL's `rerender` re-renders the wrapper too, and
 * `AllProviders` builds a fresh `QueryClient` on every render — so a `rerender`
 * would wipe the React Query cache and make every "did it refetch?" assertion
 * pass for the wrong reason. Keeping the state below the providers avoids that.
 */
type ModalProps = React.ComponentProps<typeof KymographModal>;
let forceRerender: () => void = () => {};
let patchProps: (p: Partial<ModalProps>) => void = () => {};

const Harness: React.FC<{ base: ModalProps }> = ({ base }) => {
  const [, force] = React.useReducer((n: number) => n + 1, 0);
  const [patch, setPatch] = React.useState<Partial<ModalProps>>({});
  forceRerender = force;
  patchProps = p => setPatch(prev => ({ ...prev, ...p }));
  return <KymographModal {...base} {...patch} />;
};

/** The axios request config the component passes as the 3rd `post` argument. */
const requestConfig = () =>
  mockApiPost.mock.calls.at(-1)?.[2] as { signal?: AbortSignal } | undefined;

const requestBody = (call = -1) =>
  mockApiPost.mock.calls.at(call)?.[1] as Record<string, unknown>;

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('KymographModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockChannelColors = { CH1: '#FF0000', CH2: '#00FF00' };
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

    it('spins instead of re-showing a cached error while the retry runs', async () => {
      // React Query keeps the failure on the cache entry, so returning to a key
      // that failed earlier must not paint that stale message over an in-flight
      // retry — the effect this replaced cleared the error on every request.
      const user = userEvent.setup();
      mockApiPost
        .mockRejectedValueOnce(new Error('boom-1'))
        .mockRejectedValueOnce(new Error('boom-2'))
        .mockReturnValue(new Promise(() => {}));

      render(<KymographModal {...defaultProps} />);
      await screen.findByText('boom-1');

      const checkbox = screen.getByRole('checkbox', {
        name: /Velocity analysis/i,
      });
      await user.click(checkbox); // key B — fails too
      await screen.findByText('boom-2');
      await user.click(checkbox); // back to key A, whose error is cached

      await waitFor(() => expect(mockApiPost).toHaveBeenCalledTimes(3));
      expect(screen.getByText(/Computing kymograph/i)).toBeInTheDocument();
      expect(screen.queryByText('boom-1')).not.toBeInTheDocument();
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
        expect.objectContaining({ sourceChannel: 'FL' }),
        expect.anything()
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
        expect.objectContaining({ sourceChannel: 'IRM' }),
        expect.anything()
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
        expect.objectContaining({ sourceChannel: 'RAW' }),
        expect.anything()
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

  describe('Download buttons (payload guards)', () => {
    it('keeps the CSV button disabled when the response carries no CSV', async () => {
      // Rather than handing the user a 0-byte "kymograph.csv" if the intensity
      // matrix ever stops being returned.
      mockApiPost.mockResolvedValue({
        data: { data: { ...mockResult, csvBase64: '' } },
      });
      render(<KymographModal {...defaultProps} />);
      await waitFor(() =>
        expect(screen.getByRole('button', { name: /PNG/i })).not.toBeDisabled()
      );
      expect(screen.getByRole('button', { name: /CSV/i })).toBeDisabled();
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
        }),
        expect.anything()
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
        expect.objectContaining({ channelColor: '#FF0000' }),
        expect.anything()
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
        expect.objectContaining({ channelColor: '#FFFFFF' }),
        expect.anything()
      );
    });
  });

  // ── Performance behaviours ─────────────────────────────────────────────────
  // A 300-frame kymograph cost the user 18.6–29.4 s end to end. Half of that
  // was velocity analysis nobody asked for; the rest was piled-up superseded
  // requests and rebuilds triggered by unrelated editor state.

  describe('Velocity analysis is opt-in', () => {
    it('does not request velocity analysis on open', () => {
      render(<KymographModal {...defaultProps} />);
      expect(mockApiPost).toHaveBeenCalledTimes(1);
      expect(requestBody()).toMatchObject({ detectVelocity: false });
      expect(requestBody()).not.toHaveProperty('intensityWidth');
    });

    it('offers the analyse-velocities action once the image has loaded', async () => {
      mockApiPost.mockResolvedValue({ data: { data: mockResult } });
      render(<KymographModal {...defaultProps} />);
      await waitFor(() =>
        expect(
          screen.getByRole('button', { name: /Analyse velocities/i })
        ).toBeInTheDocument()
      );
    });

    it('requests velocities exactly once when the action is clicked', async () => {
      const user = userEvent.setup();
      mockApiPost.mockResolvedValue({ data: { data: mockResult } });
      render(<KymographModal {...defaultProps} />);

      const cta = await screen.findByRole('button', {
        name: /Analyse velocities/i,
      });
      await user.click(cta);

      await waitFor(() => expect(mockApiPost).toHaveBeenCalledTimes(2));
      expect(requestBody()).toMatchObject({
        detectVelocity: true,
        intensityWidth: 3,
      });
    });

    it('keeps the kymograph on screen while velocities are computed', async () => {
      const user = userEvent.setup();
      mockApiPost.mockResolvedValueOnce({ data: { data: mockResult } });
      // Second (velocity) request never settles.
      mockApiPost.mockReturnValue(new Promise(() => {}));
      render(<KymographModal {...defaultProps} />);

      await user.click(
        await screen.findByRole('button', { name: /Analyse velocities/i })
      );

      // The PNG does not depend on the velocity flags, so it must NOT be
      // replaced by the full-viewer spinner — only the table area waits.
      await waitFor(() =>
        expect(screen.getByText(/Analysing velocities/i)).toBeInTheDocument()
      );
      expect(screen.getByAltText(/Kymograph for poly-42/i)).toBeInTheDocument();
      expect(
        screen.queryByText(/Computing kymograph/i)
      ).not.toBeInTheDocument();
    });

    it('reads a velocity request that cannot start as pending, not as "none found"', async () => {
      // React Query pauses rather than fails a request made while the browser
      // is offline. An empty track list from a request that never ran would be
      // a false scientific negative — there is no evidence either way yet.
      const user = userEvent.setup();
      mockApiPost.mockResolvedValueOnce({ data: { data: mockResult } });
      render(<KymographModal {...defaultProps} />);
      const cta = await screen.findByRole('button', {
        name: /Analyse velocities/i,
      });

      onlineManager.setOnline(false);
      try {
        await user.click(cta);
        await waitFor(() =>
          expect(screen.getByText(/Analysing velocities/i)).toBeInTheDocument()
        );
        expect(
          screen.queryByText(/No moving particles detected/i)
        ).not.toBeInTheDocument();
      } finally {
        onlineManager.setOnline(true);
      }
    });

    it('discards the image when an image input changes (frameIndex)', async () => {
      mockApiPost.mockResolvedValueOnce({ data: { data: mockResult } });
      mockApiPost.mockReturnValue(new Promise(() => {}));
      render(<Harness base={defaultProps} />);
      await screen.findByAltText(/Kymograph for poly-42/i);

      act(() => patchProps({ frameIndex: 5 }));

      await waitFor(() =>
        expect(screen.getByText(/Computing kymograph/i)).toBeInTheDocument()
      );
      expect(
        screen.queryByAltText(/Kymograph for poly-42/i)
      ).not.toBeInTheDocument();
      expect(requestBody()).toMatchObject({ frameIndex: 5 });
    });
  });

  describe('Request cancellation', () => {
    it('passes an AbortSignal with the request', () => {
      render(<KymographModal {...defaultProps} />);
      expect(requestConfig()?.signal).toBeInstanceOf(AbortSignal);
    });

    it('aborts the superseded request and shows no error', async () => {
      const signals: AbortSignal[] = [];
      mockApiPost.mockImplementation(
        (_url: string, _body: unknown, config: { signal: AbortSignal }) => {
          signals.push(config.signal);
          return new Promise((_resolve, reject) => {
            config.signal.addEventListener('abort', () =>
              // What axios rejects with once the signal fires.
              reject(new DOMException('canceled', 'AbortError'))
            );
          });
        }
      );
      render(<Harness base={defaultProps} />);
      await waitFor(() => expect(signals).toHaveLength(1));

      // Scrub to another frame while the first rebuild is still running — the
      // user complaint was that every such change stacked another full run.
      act(() => patchProps({ frameIndex: 7 }));

      await waitFor(() => expect(signals[0].aborted).toBe(true));
      expect(signals).toHaveLength(2);
      // An abort is not a failure: the viewer waits for the new request.
      expect(screen.queryByText(/canceled/i)).not.toBeInTheDocument();
      expect(screen.getByText(/Computing kymograph/i)).toBeInTheDocument();
    });

    it('aborts the in-flight request when the modal unmounts', async () => {
      const signals: AbortSignal[] = [];
      mockApiPost.mockImplementation(
        (_url: string, _body: unknown, config: { signal: AbortSignal }) => {
          signals.push(config.signal);
          return new Promise(() => {});
        }
      );
      const { unmount } = render(<KymographModal {...defaultProps} />);
      await waitFor(() => expect(signals).toHaveLength(1));

      unmount();

      await waitFor(() => expect(signals[0].aborted).toBe(true));
    });
  });

  describe('Refetch scope', () => {
    it('does not rebuild the kymograph when an UNRELATED channel is recoloured', async () => {
      mockApiPost.mockResolvedValue({ data: { data: mockResult } });
      render(
        <Harness
          base={{
            ...defaultProps,
            channels: makeChannels([{ name: 'CH1' }, { name: 'CH2' }]),
          }}
        />
      );
      await screen.findByAltText(/Kymograph for poly-42/i);
      expect(mockApiPost).toHaveBeenCalledTimes(1);

      // The editor recolours CH2 — the source channel is CH1. The context
      // hands out a brand-new record object, exactly as the real one does.
      mockChannelColors = { ...mockChannelColors, CH2: '#0000FF' };
      act(() => forceRerender());
      // Give a refetch the chance to fire before declaring that none did — a
      // `waitFor(…toHaveBeenCalledTimes(1))` would pass on its first tick.
      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 0));
      });

      expect(mockApiPost).toHaveBeenCalledTimes(1);
    });

    it('refetches on a fresh open instead of serving a cached kymograph', async () => {
      // The user can edit the polyline between two opens, so a cache entry must
      // never outlive the modal — `VideoModeOverlay` mounts it per open.
      // Both mounts share ONE QueryClient here, which is what the real app does.
      mockApiPost.mockResolvedValue({ data: { data: mockResult } });
      const client = new QueryClient({
        defaultOptions: { queries: { retry: false } },
      });
      const SharedCache: React.FC<{ children: React.ReactNode }> = ({
        children,
      }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      );

      const first = render(
        <SharedCache>
          <KymographModal {...defaultProps} />
        </SharedCache>
      );
      await screen.findByAltText(/Kymograph for poly-42/i);
      expect(mockApiPost).toHaveBeenCalledTimes(1);
      first.unmount();

      render(
        <SharedCache>
          <KymographModal {...defaultProps} />
        </SharedCache>
      );
      await waitFor(() => expect(mockApiPost).toHaveBeenCalledTimes(2));
    });

    it('does not re-request anything when velocity analysis is switched off', async () => {
      // The velocity response is a strict superset of the plain one, so going
      // back to "image only" is a display change, not a rebuild.
      const user = userEvent.setup();
      mockApiPost.mockResolvedValue({
        data: { data: { ...mockResult, tracks: [] } },
      });
      render(<KymographModal {...defaultProps} />);

      await user.click(
        await screen.findByRole('button', { name: /Analyse velocities/i })
      );
      await waitFor(() => expect(mockApiPost).toHaveBeenCalledTimes(2));

      await user.click(
        screen.getByRole('checkbox', { name: /Velocity analysis/i })
      );
      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 0));
      });

      expect(mockApiPost).toHaveBeenCalledTimes(2);
      expect(screen.getByAltText(/Kymograph for poly-42/i)).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: /Analyse velocities/i })
      ).toBeInTheDocument();
    });

    it('keeps the kymograph and its downloads when the velocity pass fails', async () => {
      // The image came from a different query, so a velocity failure must not
      // take it — or the download of the PNG the user already has — with it.
      const user = userEvent.setup();
      mockApiPost.mockResolvedValueOnce({ data: { data: mockResult } });
      mockApiPost.mockRejectedValue(new Error('velocity blew up'));
      render(<KymographModal {...defaultProps} />);

      await user.click(
        await screen.findByRole('button', { name: /Analyse velocities/i })
      );

      await waitFor(() =>
        expect(screen.getByText('velocity blew up')).toBeInTheDocument()
      );
      expect(screen.getByAltText(/Kymograph for poly-42/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /PNG/i })).not.toBeDisabled();
      expect(screen.getByRole('button', { name: /CSV/i })).not.toBeDisabled();
    });

    it('DOES rebuild when the source channel itself is recoloured', async () => {
      mockApiPost.mockResolvedValue({ data: { data: mockResult } });
      render(
        <Harness
          base={{
            ...defaultProps,
            channels: makeChannels([{ name: 'CH1' }, { name: 'CH2' }]),
          }}
        />
      );
      await screen.findByAltText(/Kymograph for poly-42/i);

      mockChannelColors = { ...mockChannelColors, CH1: '#00FFFF' };
      act(() => forceRerender());

      await waitFor(() => expect(mockApiPost).toHaveBeenCalledTimes(2));
      expect(requestBody()).toMatchObject({ channelColor: '#00FFFF' });
    });
  });
});
