/**
 * EditorHeader — behavioral unit tests
 *
 * Covered:
 *  - Renders project title and image name in breadcrumb
 *  - Home button calls navigate('/dashboard')
 *  - Back (project folder) button calls navigate('/project/<id>')
 *  - Prev/Next nav buttons disabled at first/last image
 *  - Prev/Next buttons call onNavigate with correct direction
 *  - WebSocket connected/disconnected indicator shown
 *  - SegmentationStatusIndicator rendered when imageId supplied
 *  - SegmentationStatusIndicator NOT rendered when imageId omitted
 *  - Single-image mode: shows static X / Y progress display
 *  - Video mode (videoFrameCount > 1 + wiring): shows frame number input
 *  - Video mode: frame number input calls onVideoFrameChange with clamped index
 *  - Video mode: Slider rendered and calls onVideoFrameChange
 *  - Video mode: Play button rendered when videoIsPlaying=false
 *  - Video mode: Pause button rendered when videoIsPlaying=true
 *  - Video mode: Play/Pause button calls onVideoToggle
 *  - Unsaved-changes prompt: opens instead of navigating, save-then-leave
 *    ordering, discard, cancel, and a failed save holding the dialog open
 *
 * NOT tested:
 *  - startTransition side-effects — no observable JSDOM output.
 *  - framer-motion animation values (CSS, not DOM-queryable).
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '@/test/utils/test-utils';
import EditorHeader from '../EditorHeader';

// ---------------------------------------------------------------------------
// Mock heavy / side-effect dependencies
// ---------------------------------------------------------------------------

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual =
    await vi.importActual<typeof import('react-router-dom')>(
      'react-router-dom'
    );
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

// Stub SegmentationStatusIndicator — its own tests cover the internals
vi.mock('../SegmentationStatusIndicator', () => ({
  default: ({ imageId }: { imageId: string }) => (
    <div data-testid="seg-status-indicator" data-image-id={imageId} />
  ),
}));

// Stub framer-motion to avoid rAF flakiness
vi.mock('framer-motion', () => ({
  motion: {
    header: ({
      children,
      ...rest
    }: React.HTMLAttributes<HTMLElement> & { children?: React.ReactNode }) => (
      <header {...rest}>{children}</header>
    ),
  },
}));

// ---------------------------------------------------------------------------
// Shared defaults
// ---------------------------------------------------------------------------

const baseProps = {
  projectId: 'proj-1',
  projectTitle: 'My Project',
  imageName: 'cell_001.tif',
  currentImageIndex: 2,
  totalImages: 10,
  onNavigate: vi.fn(),
};

// ---------------------------------------------------------------------------

describe('EditorHeader', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ---- Breadcrumb rendering ------------------------------------------------

  describe('breadcrumb', () => {
    it('displays the project title', () => {
      render(<EditorHeader {...baseProps} />);
      expect(screen.getByText('My Project')).toBeInTheDocument();
    });

    it('displays the image name', () => {
      render(<EditorHeader {...baseProps} />);
      expect(screen.getByText('cell_001.tif')).toBeInTheDocument();
    });
  });

  // ---- Navigation buttons --------------------------------------------------

  describe('Home button', () => {
    it('calls navigate("/dashboard") when clicked', async () => {
      const user = userEvent.setup();
      render(<EditorHeader {...baseProps} />);
      // Home button has a Home icon — find by role with no text; use
      // the first ghost button (home is leftmost)
      const homeBtn = screen.getAllByRole('button')[0];
      await user.click(homeBtn);
      expect(mockNavigate).toHaveBeenCalledWith('/dashboard');
    });
  });

  describe('project folder button', () => {
    it('calls navigate("/project/proj-1") when clicked', async () => {
      const user = userEvent.setup();
      render(<EditorHeader {...baseProps} />);
      // The folder button contains the project title text
      const folderBtn = screen
        .getByText('My Project')
        .closest('button') as HTMLButtonElement;
      await user.click(folderBtn);
      expect(mockNavigate).toHaveBeenCalledWith('/project/proj-1');
    });
  });

  describe('Prev / Next buttons', () => {
    it('Prev button disabled at first image (index 0)', () => {
      render(<EditorHeader {...baseProps} currentImageIndex={0} />);
      const prevBtn = screen.getByRole('button', { name: /back/i });
      expect(prevBtn).toBeDisabled();
    });

    it('Next button disabled at last image', () => {
      render(
        <EditorHeader {...baseProps} currentImageIndex={9} totalImages={10} />
      );
      const nextBtn = screen.getByRole('button', { name: /next/i });
      expect(nextBtn).toBeDisabled();
    });

    it('Prev button calls onNavigate("prev") when enabled', async () => {
      const user = userEvent.setup();
      const onNavigate = vi.fn();
      render(
        <EditorHeader
          {...baseProps}
          currentImageIndex={5}
          onNavigate={onNavigate}
        />
      );
      await user.click(screen.getByRole('button', { name: /back/i }));
      expect(onNavigate).toHaveBeenCalledWith('prev');
    });

    it('Next button calls onNavigate("next") when enabled', async () => {
      const user = userEvent.setup();
      const onNavigate = vi.fn();
      render(
        <EditorHeader
          {...baseProps}
          currentImageIndex={5}
          totalImages={10}
          onNavigate={onNavigate}
        />
      );
      await user.click(screen.getByRole('button', { name: /next/i }));
      expect(onNavigate).toHaveBeenCalledWith('next');
    });
  });

  // ---- WebSocket indicator ------------------------------------------------

  describe('WebSocket status indicator', () => {
    it('shows Online when isWebSocketConnected=true', () => {
      render(<EditorHeader {...baseProps} isWebSocketConnected={true} />);
      expect(screen.getByText('Online')).toBeInTheDocument();
    });

    it('shows Offline when isWebSocketConnected=false', () => {
      render(<EditorHeader {...baseProps} isWebSocketConnected={false} />);
      expect(screen.getByText('Offline')).toBeInTheDocument();
    });
  });

  // ---- SegmentationStatusIndicator ----------------------------------------

  describe('SegmentationStatusIndicator', () => {
    it('renders when imageId is provided', () => {
      render(<EditorHeader {...baseProps} imageId="img-42" />);
      expect(screen.getByTestId('seg-status-indicator')).toBeInTheDocument();
      expect(screen.getByTestId('seg-status-indicator').dataset.imageId).toBe(
        'img-42'
      );
    });

    it('does NOT render when imageId is omitted', () => {
      render(<EditorHeader {...baseProps} />);
      expect(
        screen.queryByTestId('seg-status-indicator')
      ).not.toBeInTheDocument();
    });
  });

  // ---- Single-image mode (progress) ---------------------------------------

  describe('single-image mode', () => {
    it('shows current+1 / totalImages as static text', () => {
      render(
        <EditorHeader {...baseProps} currentImageIndex={2} totalImages={10} />
      );
      // currentImageIndex + 1 = 3, displayed as "3"
      expect(screen.getByText('3')).toBeInTheDocument();
      expect(screen.getByText('10')).toBeInTheDocument();
    });

    it('does NOT render a frame number input (no video props)', () => {
      render(<EditorHeader {...baseProps} />);
      // The frame input in video mode has aria-label "Frame"
      expect(
        screen.queryByRole('spinbutton', { name: /frame/i })
      ).not.toBeInTheDocument();
    });
  });

  // ---- Video mode ---------------------------------------------------------

  describe('video mode', () => {
    const videoProps = {
      ...baseProps,
      videoFrameCount: 100,
      videoFrameIndex: 4,
      onVideoFrameChange: vi.fn(),
      onVideoToggle: vi.fn(),
      videoIsPlaying: false,
    };

    it('shows editable frame number input (current frame + 1)', () => {
      render(<EditorHeader {...videoProps} />);
      const input = screen.getByRole('spinbutton', {
        name: /frame/i,
      }) as HTMLInputElement;
      expect(input).toBeInTheDocument();
      expect(input.value).toBe('5'); // frameIndex 4 + 1
    });

    it('shows total frame count', () => {
      render(<EditorHeader {...videoProps} />);
      expect(screen.getByText('100')).toBeInTheDocument();
    });

    it('frame input change calls onVideoFrameChange with correct 0-based index', () => {
      const onVideoFrameChange = vi.fn();
      render(
        <EditorHeader {...videoProps} onVideoFrameChange={onVideoFrameChange} />
      );
      const input = screen.getByRole('spinbutton', { name: /frame/i });
      fireEvent.change(input, { target: { value: '10' } });
      // User typed 10 → 0-based index = 9
      expect(onVideoFrameChange).toHaveBeenCalledWith(9);
    });

    it('frame input clamps to 0 when user types 0 or below', () => {
      const onVideoFrameChange = vi.fn();
      render(
        <EditorHeader {...videoProps} onVideoFrameChange={onVideoFrameChange} />
      );
      const input = screen.getByRole('spinbutton', { name: /frame/i });
      fireEvent.change(input, { target: { value: '0' } });
      // 0 → 0-based index = -1 → clamped to 0
      expect(onVideoFrameChange).toHaveBeenCalledWith(0);
    });

    it('frame input clamps at max frame index', () => {
      const onVideoFrameChange = vi.fn();
      render(
        <EditorHeader
          {...videoProps}
          videoFrameCount={10}
          onVideoFrameChange={onVideoFrameChange}
        />
      );
      const input = screen.getByRole('spinbutton', { name: /frame/i });
      fireEvent.change(input, { target: { value: '999' } });
      // 999 → 0-based = 998, clamped to frameCount - 1 = 9
      expect(onVideoFrameChange).toHaveBeenCalledWith(9);
    });

    it('renders a Slider for frame scrubbing', () => {
      render(<EditorHeader {...videoProps} />);
      // Slider from shadcn renders an element with role=slider
      expect(screen.getByRole('slider')).toBeInTheDocument();
    });

    it('renders Play button when videoIsPlaying=false', () => {
      render(<EditorHeader {...videoProps} videoIsPlaying={false} />);
      expect(screen.getByRole('button', { name: /play/i })).toBeInTheDocument();
    });

    it('renders Pause button when videoIsPlaying=true', () => {
      render(<EditorHeader {...videoProps} videoIsPlaying={true} />);
      expect(
        screen.getByRole('button', { name: /pause/i })
      ).toBeInTheDocument();
    });

    it('Play/Pause button calls onVideoToggle', async () => {
      const user = userEvent.setup();
      const onVideoToggle = vi.fn();
      render(
        <EditorHeader
          {...videoProps}
          videoIsPlaying={false}
          onVideoToggle={onVideoToggle}
        />
      );
      await user.click(screen.getByRole('button', { name: /play/i }));
      expect(onVideoToggle).toHaveBeenCalledTimes(1);
    });

    it('does NOT render Play/Pause when onVideoToggle is not supplied', () => {
      render(<EditorHeader {...videoProps} onVideoToggle={undefined} />);
      expect(
        screen.queryByRole('button', { name: /play|pause/i })
      ).not.toBeInTheDocument();
    });

    it('falls back to single-image mode when videoFrameCount <= 1', () => {
      render(
        <EditorHeader
          {...baseProps}
          videoFrameCount={1}
          videoFrameIndex={0}
          onVideoFrameChange={vi.fn()}
        />
      );
      // No frame input — single-image progress
      expect(
        screen.queryByRole('spinbutton', { name: /frame/i })
      ).not.toBeInTheDocument();
    });

    it('falls back to single-image mode when wiring is incomplete', () => {
      // videoFrameCount provided but no onVideoFrameChange → not video mode
      render(
        <EditorHeader
          {...baseProps}
          videoFrameCount={50}
          videoFrameIndex={0}
          // onVideoFrameChange intentionally omitted
        />
      );
      expect(
        screen.queryByRole('spinbutton', { name: /frame/i })
      ).not.toBeInTheDocument();
    });
  });

  // ---- Unsaved-changes prompt ---------------------------------------------

  /**
   * These replace the behaviour this component used to have: navigate FIRST,
   * then fire `onSave()` into a `Promise.race` against a 3 s timeout. The
   * editor unmounts on navigation and aborts the `manual-save` signal, so that
   * save was routinely cancelled mid-flight and the loss surfaced only as a
   * `logger.warn`. Nothing must navigate before a save has reported success.
   */
  describe('unsaved changes prompt', () => {
    const dirtyProps = (onSave: () => Promise<boolean>) => ({
      ...baseProps,
      hasUnsavedChanges: true,
      onSave,
    });

    const clickFolderButton = async (
      user: ReturnType<typeof userEvent.setup>
    ) =>
      user.click(
        screen.getByText('My Project').closest('button') as HTMLButtonElement
      );

    it('opens the prompt instead of navigating when there are unsaved changes', async () => {
      const user = userEvent.setup();
      const onSave = vi.fn().mockResolvedValue(true);
      render(<EditorHeader {...dirtyProps(onSave)} />);

      await clickFolderButton(user);

      // Positive assertion: the dialog and all three of its choices are up.
      expect(
        screen.getByRole('heading', { name: 'Save changes before leaving?' })
      ).toBeInTheDocument();
      expect(screen.getByTestId('unsaved-changes-save')).toBeInTheDocument();
      expect(screen.getByTestId('unsaved-changes-discard')).toBeInTheDocument();
      expect(mockNavigate).not.toHaveBeenCalled();
      expect(onSave).not.toHaveBeenCalled();
    });

    it('navigates immediately when there is nothing unsaved', async () => {
      const user = userEvent.setup();
      const onSave = vi.fn().mockResolvedValue(true);
      render(
        <EditorHeader
          {...baseProps}
          hasUnsavedChanges={false}
          onSave={onSave}
        />
      );

      await clickFolderButton(user);

      expect(mockNavigate).toHaveBeenCalledWith('/project/proj-1');
      expect(onSave).not.toHaveBeenCalled();
    });

    it('waits for the save to resolve BEFORE navigating', async () => {
      const user = userEvent.setup();
      let resolveSave: (ok: boolean) => void = () => {};
      const onSave = vi.fn(
        () =>
          new Promise<boolean>(resolve => {
            resolveSave = resolve;
          })
      );
      render(<EditorHeader {...dirtyProps(onSave)} />);

      await clickFolderButton(user);
      await user.click(screen.getByTestId('unsaved-changes-save'));

      // The save is in flight: it has been called, and the route has NOT
      // changed. This is the ordering assertion — no wall-clock involved.
      expect(onSave).toHaveBeenCalledTimes(1);
      expect(mockNavigate).not.toHaveBeenCalled();
      expect(screen.getByTestId('unsaved-changes-save')).toBeDisabled();

      await act(async () => {
        resolveSave(true);
      });

      expect(mockNavigate).toHaveBeenCalledWith('/project/proj-1');
    });

    it('keeps the prompt open and reports the failure when the save rejects', async () => {
      const user = userEvent.setup();
      const onSave = vi.fn().mockRejectedValue(new Error('boom'));
      render(<EditorHeader {...dirtyProps(onSave)} />);

      await clickFolderButton(user);
      await user.click(screen.getByTestId('unsaved-changes-save'));

      await screen.findByTestId('unsaved-changes-save-failed');
      expect(mockNavigate).not.toHaveBeenCalled();
      // Still offering the same three choices, so the user can retry.
      expect(screen.getByTestId('unsaved-changes-save')).toBeEnabled();
      expect(screen.getByTestId('unsaved-changes-discard')).toBeInTheDocument();
    });

    it('keeps the prompt open when the save resolves anything but true', async () => {
      const user = userEvent.setup();
      // `handleSave` resolves false when the save was aborted or had no
      // handler — navigating on that is the data loss this dialog prevents.
      const onSave = vi.fn().mockResolvedValue(false);
      render(<EditorHeader {...dirtyProps(onSave)} />);

      await clickFolderButton(user);
      await user.click(screen.getByTestId('unsaved-changes-save'));

      await screen.findByTestId('unsaved-changes-save-failed');
      expect(mockNavigate).not.toHaveBeenCalled();
    });

    it('"leave without saving" navigates and never calls onSave', async () => {
      const user = userEvent.setup();
      const onSave = vi.fn().mockResolvedValue(true);
      render(<EditorHeader {...dirtyProps(onSave)} />);

      await clickFolderButton(user);
      await user.click(screen.getByTestId('unsaved-changes-discard'));

      expect(mockNavigate).toHaveBeenCalledWith('/project/proj-1');
      expect(onSave).not.toHaveBeenCalled();
    });

    it('Cancel closes the prompt and stays in the editor', async () => {
      const user = userEvent.setup();
      const onSave = vi.fn().mockResolvedValue(true);
      render(<EditorHeader {...dirtyProps(onSave)} />);

      await clickFolderButton(user);
      await user.click(screen.getByRole('button', { name: 'Cancel' }));

      await waitFor(() =>
        expect(
          screen.queryByTestId('unsaved-changes-save')
        ).not.toBeInTheDocument()
      );
      expect(mockNavigate).not.toHaveBeenCalled();
      expect(onSave).not.toHaveBeenCalled();
      // The header is still mounted and usable.
      expect(screen.getByText('cell_001.tif')).toBeInTheDocument();
    });

    it('prompts even when there is no save handler, offering only discard', async () => {
      // `onSave` is optional on the props. Falling through to navigate here
      // would drop the edits with no prompt at all — the exact outcome this
      // dialog exists to prevent — so the prompt still opens and simply has
      // nothing to offer but leaving or staying.
      const user = userEvent.setup();
      render(<EditorHeader {...baseProps} hasUnsavedChanges={true} />);

      await clickFolderButton(user);

      expect(
        screen.getByRole('heading', { name: 'Save changes before leaving?' })
      ).toBeInTheDocument();
      expect(screen.getByTestId('unsaved-changes-discard')).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: 'Cancel' })
      ).toBeInTheDocument();
      // No Save button, because there is no handler that could save.
      expect(
        screen.queryByTestId('unsaved-changes-save')
      ).not.toBeInTheDocument();
      expect(mockNavigate).not.toHaveBeenCalled();

      await user.click(screen.getByTestId('unsaved-changes-discard'));
      expect(mockNavigate).toHaveBeenCalledWith('/project/proj-1');
    });

    it('the Home button routes to /dashboard through the same prompt', async () => {
      const user = userEvent.setup();
      const onSave = vi.fn().mockResolvedValue(true);
      render(<EditorHeader {...dirtyProps(onSave)} />);

      await user.click(screen.getByRole('button', { name: 'Dashboard' }));
      expect(mockNavigate).not.toHaveBeenCalled();

      await user.click(screen.getByTestId('unsaved-changes-save'));

      await waitFor(() =>
        expect(mockNavigate).toHaveBeenCalledWith('/dashboard')
      );
      expect(mockNavigate).toHaveBeenCalledTimes(1);
    });
  });
});
