/**
 * QueueStatsPanel (real component) — behavioral unit tests
 *
 * Tests the ACTUAL component at src/components/project/QueueStatsPanel.tsx,
 * not the mock version in QueueStatsPanel.cancel.test.tsx.
 *
 * Covered behaviours:
 *  - Connected / disconnected badge
 *  - Queue stats display (waiting count, processing count, no-stats fallback)
 *  - Processing indicator only shown when stats.processing > 0
 *  - "Loading statistics..." placeholder when stats is null
 *  - "Connecting to server..." warning when disconnected
 *  - Settings button rendered only when onOpenSettings provided
 *  - Segment button disabled when: not connected, totalToProcess === 0, batchSubmitted
 *  - Segment button label variants (segmentAll / segmentAllWithCount / resegmentSelected / segmentMixed)
 *  - "Adding to queue..." shown when batchSubmitted
 *  - onSegmentAll callback fires on click
 *  - onOpenSettings callback fires on click
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '@/test/utils/test-utils';

// framer-motion causes jsdom animation warnings; stub it
vi.mock('framer-motion', () => ({
  motion: {
    div: ({
      children,
      ...rest
    }: React.HTMLAttributes<HTMLDivElement> & {
      children?: React.ReactNode;
    }) => <div {...rest}>{children}</div>,
  },
}));

// UniversalCancelButton — renders a simple primary+cancel pair; stub for isolation
vi.mock('@/components/ui/universal-cancel-button', () => ({
  UniversalCancelButton: ({
    onPrimaryAction,
    primaryText,
    disabled,
    title: _title,
  }: {
    onPrimaryAction: () => void;
    primaryText: string;
    disabled?: boolean;
    title?: string;
  }) => (
    <button
      data-testid="universal-cancel-btn"
      onClick={onPrimaryAction}
      disabled={disabled}
    >
      {primaryText}
    </button>
  ),
}));

import { QueueStatsPanel } from '../QueueStatsPanel';
import type { QueueStats } from '@/hooks/useSegmentationQueue';

function makeStats(overrides: Partial<QueueStats> = {}): QueueStats {
  return {
    queued: 0,
    processing: 0,
    completed: 0,
    failed: 0,
    total: 0,
    ...overrides,
  };
}

const DEFAULT_PROPS = {
  stats: makeStats(),
  isConnected: true,
  onSegmentAll: vi.fn(),
  imagesToSegmentCount: 1,
};

describe('QueueStatsPanel (real component)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── connection badge ───────────────────────────────────────────────────────

  describe('connection status badge', () => {
    it('shows "Connected" when isConnected is true', () => {
      render(<QueueStatsPanel {...DEFAULT_PROPS} isConnected={true} />);
      expect(screen.getByText('Connected')).toBeInTheDocument();
    });

    it('shows "Disconnected" when isConnected is false', () => {
      render(<QueueStatsPanel {...DEFAULT_PROPS} isConnected={false} />);
      expect(screen.getByText('Disconnected')).toBeInTheDocument();
    });

    it('shows warning banner when disconnected', () => {
      render(<QueueStatsPanel {...DEFAULT_PROPS} isConnected={false} />);
      expect(screen.getByText(/connecting to server/i)).toBeInTheDocument();
    });

    it('does NOT show warning banner when connected', () => {
      render(<QueueStatsPanel {...DEFAULT_PROPS} isConnected={true} />);
      expect(
        screen.queryByText(/connecting to server/i)
      ).not.toBeInTheDocument();
    });
  });

  // ── queue stats display ────────────────────────────────────────────────────

  describe('queue statistics', () => {
    it('renders section title', () => {
      render(<QueueStatsPanel {...DEFAULT_PROPS} />);
      expect(screen.getByText('Segmentation Queue')).toBeInTheDocument();
    });

    it('shows loading placeholder when stats is null', () => {
      render(<QueueStatsPanel {...DEFAULT_PROPS} stats={null} />);
      expect(screen.getByText(/loading statistics/i)).toBeInTheDocument();
    });

    it('shows queued count when stats provided', () => {
      render(
        <QueueStatsPanel
          {...DEFAULT_PROPS}
          stats={makeStats({ queued: 7, processing: 0 })}
        />
      );
      expect(screen.getByText('7')).toBeInTheDocument();
      expect(screen.getByText('waiting')).toBeInTheDocument();
    });

    it('shows processing count only when stats.processing > 0', () => {
      render(
        <QueueStatsPanel
          {...DEFAULT_PROPS}
          stats={makeStats({ processing: 3 })}
        />
      );
      expect(screen.getByText('3')).toBeInTheDocument();
      expect(screen.getByText('processing')).toBeInTheDocument();
    });

    it('does NOT show processing indicator when processing is 0', () => {
      render(
        <QueueStatsPanel
          {...DEFAULT_PROPS}
          stats={makeStats({ processing: 0 })}
        />
      );
      expect(screen.queryByText('processing')).not.toBeInTheDocument();
    });
  });

  // ── button label variants ──────────────────────────────────────────────────

  describe('button label', () => {
    it('shows "Segment All" when imagesToSegmentCount is 0 and no selection', () => {
      render(
        <QueueStatsPanel
          {...DEFAULT_PROPS}
          imagesToSegmentCount={0}
          images={[]}
          selectedImageIds={new Set()}
        />
      );
      expect(screen.getByText('Segment All')).toBeInTheDocument();
    });

    it('shows count label when imagesToSegmentCount > 0', () => {
      render(<QueueStatsPanel {...DEFAULT_PROPS} imagesToSegmentCount={5} />);
      // translation: 'Segment All ({{count}})' → 'Segment All (5)'
      expect(screen.getByText(/segment all \(5\)/i)).toBeInTheDocument();
    });

    it('shows re-segment label when selected images already have segmentation', () => {
      const images = [
        {
          id: 'img-1',
          segmentationStatus: 'segmented' as const,
        },
      ] as any[];
      render(
        <QueueStatsPanel
          {...DEFAULT_PROPS}
          imagesToSegmentCount={0}
          images={images}
          selectedImageIds={new Set(['img-1'])}
        />
      );
      expect(screen.getByText(/re-segment selected/i)).toBeInTheDocument();
    });

    it('shows mixed label when there are both new and re-segment items', () => {
      const images = [
        { id: 'img-1', segmentationStatus: 'segmented' as const },
      ] as any[];
      render(
        <QueueStatsPanel
          {...DEFAULT_PROPS}
          imagesToSegmentCount={3}
          images={images}
          selectedImageIds={new Set(['img-1'])}
        />
      );
      expect(screen.getByText(/segment 3.*re-segment 1/i)).toBeInTheDocument();
    });

    it('shows "Adding to queue..." when batchSubmitted is true', () => {
      render(
        <QueueStatsPanel
          {...DEFAULT_PROPS}
          batchSubmitted={true}
          imagesToSegmentCount={2}
        />
      );
      expect(screen.getByText(/adding to queue/i)).toBeInTheDocument();
    });
  });

  // ── button disabled logic ──────────────────────────────────────────────────

  describe('segment button disabled states', () => {
    it('is disabled when not connected', () => {
      render(
        <QueueStatsPanel
          {...DEFAULT_PROPS}
          isConnected={false}
          imagesToSegmentCount={3}
        />
      );
      // Without onCancelSegmentation the plain Button is rendered
      const btn = screen.getByRole('button', { name: /segment/i });
      expect(btn).toBeDisabled();
    });

    it('is disabled when totalToProcess is 0', () => {
      render(
        <QueueStatsPanel
          {...DEFAULT_PROPS}
          imagesToSegmentCount={0}
          images={[]}
          selectedImageIds={new Set()}
        />
      );
      const btn = screen.getByRole('button', { name: /segment/i });
      expect(btn).toBeDisabled();
    });

    it('is disabled when batchSubmitted is true', () => {
      render(
        <QueueStatsPanel
          {...DEFAULT_PROPS}
          batchSubmitted={true}
          imagesToSegmentCount={2}
        />
      );
      const btn = screen.getByRole('button', { name: /adding to queue/i });
      expect(btn).toBeDisabled();
    });

    it('is enabled when connected and there are images to process', () => {
      render(
        <QueueStatsPanel
          {...DEFAULT_PROPS}
          isConnected={true}
          imagesToSegmentCount={2}
        />
      );
      const btn = screen.getByRole('button', { name: /segment/i });
      expect(btn).not.toBeDisabled();
    });
  });

  // ── callbacks ─────────────────────────────────────────────────────────────

  describe('callbacks', () => {
    it('calls onSegmentAll when segment button is clicked', async () => {
      const onSegmentAll = vi.fn();
      const user = userEvent.setup();
      render(
        <QueueStatsPanel
          {...DEFAULT_PROPS}
          onSegmentAll={onSegmentAll}
          imagesToSegmentCount={1}
        />
      );
      await user.click(screen.getByRole('button', { name: /segment/i }));
      expect(onSegmentAll).toHaveBeenCalledOnce();
    });

    it('calls onSegmentAll via UniversalCancelButton when onCancelSegmentation provided', async () => {
      const onSegmentAll = vi.fn();
      const onCancelSegmentation = vi.fn();
      const user = userEvent.setup();
      render(
        <QueueStatsPanel
          {...DEFAULT_PROPS}
          onSegmentAll={onSegmentAll}
          onCancelSegmentation={onCancelSegmentation}
          imagesToSegmentCount={1}
        />
      );
      await user.click(screen.getByTestId('universal-cancel-btn'));
      expect(onSegmentAll).toHaveBeenCalledOnce();
    });

    it('renders Settings button only when onOpenSettings is provided', () => {
      const { rerender } = render(
        <QueueStatsPanel {...DEFAULT_PROPS} onOpenSettings={undefined} />
      );
      expect(screen.queryByText('Settings')).not.toBeInTheDocument();

      rerender(<QueueStatsPanel {...DEFAULT_PROPS} onOpenSettings={vi.fn()} />);
      expect(screen.getByText('Settings')).toBeInTheDocument();
    });

    it('calls onOpenSettings when Settings button clicked', async () => {
      const onOpenSettings = vi.fn();
      const user = userEvent.setup();
      render(
        <QueueStatsPanel {...DEFAULT_PROPS} onOpenSettings={onOpenSettings} />
      );
      await user.click(screen.getByText('Settings'));
      expect(onOpenSettings).toHaveBeenCalledOnce();
    });
  });
});
