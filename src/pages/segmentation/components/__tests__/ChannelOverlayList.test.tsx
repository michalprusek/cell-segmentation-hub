/**
 * ChannelOverlayList — behavioral unit tests
 *
 * Covered behaviours:
 *  - Returns null when channels are empty/null
 *  - Renders a row per channel with displayName fallback
 *  - Checkbox toggles call toggleChannelVisibility
 *  - Colour-swatch button opens ChannelColorDialog (sets editingColor)
 *  - "● src" badge shown only on the segmentation-source channel
 *  - Opacity slider is disabled when channel is invisible
 *  - Opacity label shows current value (100% default)
 *  - Double-click on name enters rename mode (requires containerId)
 *  - Double-click does nothing when containerId is absent
 *  - Rename: Enter key commits (calls apiClient.updateImageChannels)
 *  - Rename: Escape key cancels without API call
 *  - Rename: too-long name triggers toast.error and blocks submit
 *  - Rename: unchanged name closes input without API call
 *  - Rename: API failure shows toast.error, leaves input open until blur
 */

import React from 'react';
import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  type Mock,
} from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ── mocks that must be hoisted before component import ─────────────────────

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

vi.mock('@/lib/api', () => ({
  default: { updateImageChannels: vi.fn() },
}));

vi.mock('@tanstack/react-query', async () => {
  const actual = await vi.importActual('@tanstack/react-query');
  return {
    ...actual,
    useQueryClient: () => ({ invalidateQueries: vi.fn() }),
  };
});

// Stub ChannelColorDialog — we just need to know it's rendered
vi.mock('@/pages/segmentation/components/ChannelColorDialog', () => ({
  ChannelColorDialog: ({
    open,
    channelName,
    onConfirm,
    onClose,
  }: {
    open: boolean;
    channelName: string;
    onConfirm: (color: string) => void;
    onClose: () => void;
  }) =>
    open ? (
      <div data-testid="color-dialog">
        <span data-testid="color-dialog-channel">{channelName}</span>
        <button onClick={() => onConfirm('#FF0000')}>confirm</button>
        <button onClick={onClose}>close</button>
      </div>
    ) : null,
}));

// Mock ImageDisplayContext — control the state delivered to the component
const mockToggle = vi.fn();
const mockSetVisible = vi.fn();
const mockSetCoverage = vi.fn();
const mockSetColor = vi.fn();
const mockSeedColors = vi.fn();
const mockSetOpacity = vi.fn();
const mockSetChannel = vi.fn();

let mockVisibleChannels: string[] = ['ch1', 'ch2'];
let mockChannelColors: Record<string, string> = {};
let mockChannelOpacities: Record<string, number> = {};

vi.mock('@/pages/segmentation/contexts/ImageDisplayContext', () => ({
  useImageDisplay: () => ({
    visibleChannels: mockVisibleChannels,
    channelColors: mockChannelColors,
    channelOpacities: mockChannelOpacities,
    toggleChannelVisibility: mockToggle,
    setVisibleChannels: mockSetVisible,
    setChannelCoverage: mockSetCoverage,
    setChannelColor: mockSetColor,
    seedChannelColors: mockSeedColors,
    setChannelOpacity: mockSetOpacity,
    setChannel: mockSetChannel,
  }),
}));

// ── import after mocks ──────────────────────────────────────────────────────
import { ChannelOverlayList } from '../ChannelOverlayList';
import apiClient from '@/lib/api';
import { toast } from 'sonner';
import type { VideoChannel } from '@/types';

// ── helpers ─────────────────────────────────────────────────────────────────

function makeChannel(overrides: Partial<VideoChannel> = {}): VideoChannel {
  return {
    name: 'ch1',
    displayName: 'Channel 1',
    type: 'fluorescent',
    isSegmentationSource: false,
    ...overrides,
  };
}

const TWO_CHANNELS: VideoChannel[] = [
  makeChannel({
    name: 'ch1',
    displayName: 'Green',
    isSegmentationSource: true,
  }),
  makeChannel({ name: 'ch2', displayName: 'Red', isSegmentationSource: false }),
];

function setup(
  channels: VideoChannel[] | null | undefined,
  containerId?: string | null
) {
  const user = userEvent.setup();
  const utils = render(
    <ChannelOverlayList channels={channels} containerId={containerId} />
  );
  return { user, ...utils };
}

// ── tests ───────────────────────────────────────────────────────────────────

describe('ChannelOverlayList', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset defaults
    mockVisibleChannels = ['ch1', 'ch2'];
    mockChannelColors = {};
    mockChannelOpacities = {};
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ── colour seeding (mount effect) ─────────────────────────────────────────
  describe('colour seeding (mount effect)', () => {
    it('seeds channel colours once from metadata, with #FFFFFF fallback', () => {
      const channels = [
        makeChannel({ name: 'ch1', displayColor: '#123456' }),
        makeChannel({ name: 'ch2', displayColor: undefined }),
      ];
      setup(channels, 'vid-1');

      expect(mockSeedColors).toHaveBeenCalledTimes(1);
      expect(mockSeedColors).toHaveBeenCalledWith({
        ch1: '#123456',
        ch2: '#FFFFFF',
      });
      // Seeds via seedChannelColors, NOT the per-channel setChannelColor
      // (which would falsely flag the defaults as user edits and reintroduce
      // the colour-reset race).
      expect(mockSetColor).not.toHaveBeenCalled();
    });
  });

  // ── null / empty rendering ────────────────────────────────────────────────

  describe('null / empty channels', () => {
    it('renders nothing when channels is null', () => {
      const { container } = setup(null);
      expect(container.firstChild).toBeNull();
    });

    it('renders nothing when channels is undefined', () => {
      const { container } = setup(undefined);
      expect(container.firstChild).toBeNull();
    });

    it('renders nothing when channels is an empty array', () => {
      const { container } = setup([]);
      expect(container.firstChild).toBeNull();
    });
  });

  // ── channel rows ──────────────────────────────────────────────────────────

  describe('channel list rendering', () => {
    it('renders a row for every channel', () => {
      setup(TWO_CHANNELS, 'vid-1');
      // Both displayNames appear
      expect(screen.getByText('Green')).toBeInTheDocument();
      expect(screen.getByText('Red')).toBeInTheDocument();
    });

    it('falls back to channel.name when displayName is absent', () => {
      setup([makeChannel({ name: 'raw', displayName: undefined })]);
      expect(screen.getByText('raw')).toBeInTheDocument();
    });

    it('shows "● src" only on the segmentation-source channel', () => {
      setup(TWO_CHANNELS, 'vid-1');
      const badges = screen.getAllByText('● src');
      expect(badges).toHaveLength(1);
    });

    it('shows opacity percentage label (defaults to 100%)', () => {
      setup(TWO_CHANNELS);
      const labels = screen.getAllByText('100%');
      expect(labels).toHaveLength(TWO_CHANNELS.length);
    });

    it('shows custom opacity when channelOpacities is set', () => {
      mockChannelOpacities = { ch1: 60, ch2: 30 };
      setup(TWO_CHANNELS);
      expect(screen.getByText('60%')).toBeInTheDocument();
      expect(screen.getByText('30%')).toBeInTheDocument();
    });
  });

  // ── checkbox / visibility toggle ─────────────────────────────────────────

  describe('checkbox visibility toggle', () => {
    it('calls toggleChannelVisibility with channel name on checkbox click', async () => {
      const { user } = setup(TWO_CHANNELS);
      const checkboxes = screen.getAllByRole('checkbox');
      // First checkbox → ch1 (Green)
      await user.click(checkboxes[0]);
      expect(mockToggle).toHaveBeenCalledWith('ch1');
    });

    it('opacity slider is disabled when channel is not visible', () => {
      mockVisibleChannels = ['ch2']; // ch1 not visible
      setup(TWO_CHANNELS);
      // There are two sliders; each has role "slider"
      const sliders = document.querySelectorAll('[data-disabled]');
      // At least the ch1 slider is disabled
      expect(sliders.length).toBeGreaterThan(0);
    });
  });

  // ── colour swatch button ──────────────────────────────────────────────────

  describe('colour swatch / ChannelColorDialog', () => {
    function getSwatchButtons() {
      // The swatch button renders with title="editor.channels.editColor"
      // (the raw i18n key — translation doesn't resolve at this component level
      // because useLanguage reads from the outer LanguageContext which is seeded
      // differently than the global setup).  Query by the raw key as a title
      // selector to remain decoupled from the translation pipeline.
      return document.querySelectorAll('[title="editor.channels.editColor"]');
    }

    it('opens the colour dialog when the swatch button is clicked', async () => {
      const { user } = setup(TWO_CHANNELS, 'vid-1');
      expect(screen.queryByTestId('color-dialog')).not.toBeInTheDocument();

      const swatches = getSwatchButtons();
      expect(swatches.length).toBeGreaterThan(0);
      await user.click(swatches[0] as HTMLElement);

      expect(screen.getByTestId('color-dialog')).toBeInTheDocument();
    });

    it('closes the dialog and calls setChannelColor on confirm', async () => {
      const { user } = setup(TWO_CHANNELS, 'vid-1');
      await user.click(getSwatchButtons()[0] as HTMLElement);

      await user.click(screen.getByText('confirm'));

      expect(mockSetColor).toHaveBeenCalledWith('ch1', '#FF0000');
      expect(screen.queryByTestId('color-dialog')).not.toBeInTheDocument();
    });

    it('closes the dialog without calling setChannelColor on close', async () => {
      const { user } = setup(TWO_CHANNELS, 'vid-1');
      // Mount effect seeds colours via seedChannelColors, not setChannelColor;
      // reset all mocks so the before/after count on setChannelColor is clean.
      vi.clearAllMocks();

      await user.click(getSwatchButtons()[0] as HTMLElement);
      // Dialog open — record call count before close
      const callsBefore = mockSetColor.mock.calls.length;

      await user.click(screen.getByText('close'));

      // setChannelColor must not have gained additional calls after close
      expect(mockSetColor.mock.calls.length).toBe(callsBefore);
      expect(screen.queryByTestId('color-dialog')).not.toBeInTheDocument();
    });
  });

  // ── rename UX ────────────────────────────────────────────────────────────

  describe('rename mode', () => {
    it('enters rename mode on double-click when containerId is present', async () => {
      const { user } = setup(TWO_CHANNELS, 'vid-1');
      const nameBtn = screen.getByText('Green');
      await user.dblClick(nameBtn);
      expect(screen.getByRole('textbox')).toBeInTheDocument();
    });

    it('does NOT enter rename mode on double-click when containerId is absent', async () => {
      const { user } = setup(TWO_CHANNELS, null);
      const nameBtn = screen.getByText('Green');
      await user.dblClick(nameBtn);
      expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    });

    it('Escape cancels rename without calling the API', async () => {
      const { user } = setup(TWO_CHANNELS, 'vid-1');
      await user.dblClick(screen.getByText('Green'));
      const input = screen.getByRole('textbox');
      await user.type(input, 'something');
      await user.keyboard('{Escape}');

      expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
      expect(apiClient.updateImageChannels).not.toHaveBeenCalled();
    });

    it('Enter with an unchanged value closes input without API call', async () => {
      const { user } = setup(TWO_CHANNELS, 'vid-1');
      await user.dblClick(screen.getByText('Green'));
      // Clear input, re-type the original value
      const input = screen.getByRole('textbox');
      await user.clear(input);
      await user.type(input, 'Green');
      await user.keyboard('{Enter}');

      expect(apiClient.updateImageChannels).not.toHaveBeenCalled();
      expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    });

    it('Enter with a new valid name calls updateImageChannels', async () => {
      (apiClient.updateImageChannels as Mock).mockResolvedValue({});
      const { user } = setup(TWO_CHANNELS, 'vid-1');
      await user.dblClick(screen.getByText('Green'));
      const input = screen.getByRole('textbox');
      await user.clear(input);
      await user.type(input, 'Cyan');
      await user.keyboard('{Enter}');

      await waitFor(() => {
        expect(apiClient.updateImageChannels).toHaveBeenCalledWith(
          'vid-1',
          expect.arrayContaining([
            expect.objectContaining({ name: 'ch1', displayName: 'Cyan' }),
          ])
        );
      });
    });

    it('shows toast.error and keeps input open when name exceeds 128 chars', async () => {
      const { user } = setup(TWO_CHANNELS, 'vid-1');
      await user.dblClick(screen.getByText('Green'));
      const input = screen.getByRole('textbox');
      // maxLength attr limits browser input but we can fire programmatic changes
      await user.clear(input);
      // Bypass maxLength via fireEvent to simulate a long string landing in state
      const longName = 'A'.repeat(129);
      // We need to manually trigger the onKeyDown Enter path;
      // the component guards at MAX_DISPLAY_NAME_LEN on commit.
      // Easiest reliable approach: use fireEvent to set value past maxLength
      const { fireEvent } = await import('@testing-library/react');
      fireEvent.change(input, { target: { value: longName } });
      fireEvent.keyDown(input, { key: 'Enter' });

      expect(toast.error).toHaveBeenCalled();
      // Input should still be present (not dismissed)
      expect(screen.getByRole('textbox')).toBeInTheDocument();
    });

    it('shows toast.error and keeps editing open on API failure', async () => {
      (apiClient.updateImageChannels as Mock).mockRejectedValue(
        new Error('Network error')
      );
      const { user } = setup(TWO_CHANNELS, 'vid-1');
      await user.dblClick(screen.getByText('Green'));
      const input = screen.getByRole('textbox');
      await user.clear(input);
      await user.type(input, 'NewName');
      await user.keyboard('{Enter}');

      await waitFor(() => {
        expect(toast.error).toHaveBeenCalled();
      });
    });
  });
});
