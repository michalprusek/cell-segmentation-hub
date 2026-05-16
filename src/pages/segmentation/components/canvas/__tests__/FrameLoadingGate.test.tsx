import { render, screen, act } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import FrameLoadingGate from '../FrameLoadingGate';
import { ImageDisplayProvider } from '../../../contexts/ImageDisplayContext';

vi.mock('@/lib/logger', () => ({
  default: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1' } }),
}));

function renderWithProvider(
  props: React.ComponentProps<typeof FrameLoadingGate>
) {
  return render(
    <ImageDisplayProvider userId="u1">
      <FrameLoadingGate {...props} />
    </ImageDisplayProvider>
  );
}

describe('FrameLoadingGate', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not render the overlay when frame key matches loaded key (cache hit)', () => {
    renderWithProvider({
      imageId: 'frame-1',
      loadedFrameKey: 'frame-1::',
      isVideoMode: true,
    });
    expect(
      screen.queryByTestId('editor-frame-loading-overlay')
    ).not.toBeInTheDocument();
  });

  it('does not render the overlay when video mode is off', () => {
    renderWithProvider({
      imageId: 'frame-1',
      loadedFrameKey: 'something-else::',
      isVideoMode: false,
    });
    expect(
      screen.queryByTestId('editor-frame-loading-overlay')
    ).not.toBeInTheDocument();
  });

  it('renders overlay only after 150 ms grace period of mismatch', () => {
    renderWithProvider({
      imageId: 'frame-1',
      loadedFrameKey: null,
      isVideoMode: true,
    });
    // Just before grace expires — overlay still hidden.
    act(() => {
      vi.advanceTimersByTime(149);
    });
    expect(
      screen.queryByTestId('editor-frame-loading-overlay')
    ).not.toBeInTheDocument();
    // Cross the threshold — overlay appears.
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(
      screen.getByTestId('editor-frame-loading-overlay')
    ).toBeInTheDocument();
  });

  it('cancels the grace timer when the mismatch resolves mid-grace', () => {
    const { rerender } = render(
      <ImageDisplayProvider userId="u1">
        <FrameLoadingGate imageId="frame-1" loadedFrameKey={null} isVideoMode />
      </ImageDisplayProvider>
    );
    // Wait 100 ms — still mismatched.
    act(() => {
      vi.advanceTimersByTime(100);
    });
    // Frame load completes before the grace expires; cancel the timer.
    rerender(
      <ImageDisplayProvider userId="u1">
        <FrameLoadingGate
          imageId="frame-1"
          loadedFrameKey="frame-1::"
          isVideoMode
        />
      </ImageDisplayProvider>
    );
    // Even after the original 150 ms would have elapsed, no overlay.
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(
      screen.queryByTestId('editor-frame-loading-overlay')
    ).not.toBeInTheDocument();
  });
});
