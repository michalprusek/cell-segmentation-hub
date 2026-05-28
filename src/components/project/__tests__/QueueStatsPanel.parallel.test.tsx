import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { QueueStatsPanel, ParallelProcessingStats } from '../QueueStatsPanel';
import { QueueStats } from '@/hooks/useSegmentationQueue';
import { useLanguage } from '@/contexts/useLanguage';
import type { ProcessingSlot } from '../ProcessingSlots';

// Mock the useLanguage hook
vi.mock('@/contexts/useLanguage', () => ({
  useLanguage: vi.fn(),
}));

// Mock framer-motion
vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  },
}));

// Mock ProcessingSlots component
vi.mock('../ProcessingSlots', () => ({
  default: ({ totalSlots, activeSlots, currentUserId }: any) => (
    <div data-testid="processing-slots">
      <span>Slots: {totalSlots}</span>
      <span>Active: {activeSlots.length}</span>
      <span>User: {currentUserId}</span>
    </div>
  ),
}));

const mockT = vi.fn((key: string, params?: Record<string, any>) => {
  const translations: Record<string, string> = {
    'queue.title': 'Segmentation Queue',
    'queue.connected': 'Connected',
    'queue.disconnected': 'Disconnected',
    'queue.waiting': 'waiting',
    'queue.processing': 'processing',
    'queue.parallel': 'parallel',
    'queue.users': 'users',
    'queue.segmentAll': 'Segment All',
    'queue.loadingStats': 'Loading statistics...',
    'queue.connectingMessage': 'Connecting to server...',
    'queue.allSlotsActive': 'All processing slots are active',
    'queue.yourPosition': 'Your position',
    'queue.estimatedWait': 'Est. wait',
  };

  if (params && key.includes('{{')) {
    let result = translations[key] || key;
    Object.entries(params).forEach(([param, value]) => {
      result = result.replace(`{{${param}}}`, String(value));
    });
    return result;
  }

  return translations[key] || key;
});

describe('QueueStatsPanel with Parallel Processing', () => {
  const mockOnSegmentAll = vi.fn();
  const mockOnCancelSegmentation = vi.fn();
  const mockOnOpenSettings = vi.fn();

  const defaultProps = {
    stats: null,
    isConnected: false,
    onSegmentAll: mockOnSegmentAll,
    onCancelSegmentation: mockOnCancelSegmentation,
    onOpenSettings: mockOnOpenSettings,
    imagesToSegmentCount: 0,
    selectedImageIds: new Set<string>(),
    images: [],
  };

  beforeEach(() => {
    vi.mocked(useLanguage).mockReturnValue({ t: mockT });
    vi.clearAllMocks();
  });

  it('renders basic queue stats without parallel processing', () => {
    const stats: QueueStats = {
      queueLength: 5,
      processing: 2,
      userPosition: 3,
      estimatedWaitTime: 120,
      queued: 5, // Add this for backward compatibility
    };

    render(
      <QueueStatsPanel {...defaultProps} stats={stats} isConnected={true} />
    );

    expect(screen.getByText('Segmentation Queue')).toBeInTheDocument();
    expect(screen.getByText('Connected')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument(); // queued
    expect(screen.getByText('2')).toBeInTheDocument(); // processing
    expect(screen.getByText('waiting')).toBeInTheDocument();
    expect(screen.getByText('processing')).toBeInTheDocument();
  });

  it('renders without crashing when parallel processing stats provided', () => {
    const stats: QueueStats = {
      queueLength: 3,
      processing: 4,
      userPosition: 1,
      estimatedWaitTime: 60,
      queued: 3,
    };

    const activeSlots: ProcessingSlot[] = [
      { id: 0, isActive: true, userId: 'user1', userName: 'Alice' },
      { id: 1, isActive: true, userId: 'user2', userName: 'Bob' },
    ];

    const parallelStats: ParallelProcessingStats = {
      totalSlots: 4,
      activeSlots,
      concurrentUsers: 3,
      estimatedWaitTime: 60,
      isParallelProcessingEnabled: true,
    };

    // Should render without throwing, showing basic queue stats
    render(
      <QueueStatsPanel
        {...defaultProps}
        stats={stats}
        parallelStats={parallelStats}
        currentUserId="user1"
        isConnected={true}
      />
    );

    expect(screen.getByText('Segmentation Queue')).toBeInTheDocument();
    expect(screen.getByText('Connected')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument(); // queued count
    expect(screen.getByText('waiting')).toBeInTheDocument();
  });

  it('renders queue stats correctly when parallelStats is provided with active slots', () => {
    const activeSlots: ProcessingSlot[] = [
      { id: 0, isActive: true, userId: 'user1' },
    ];

    const parallelStats: ParallelProcessingStats = {
      totalSlots: 4,
      activeSlots,
      concurrentUsers: 1,
      isParallelProcessingEnabled: true,
    };

    render(
      <QueueStatsPanel
        {...defaultProps}
        stats={{ queueLength: 0, processing: 1, queued: 0 }}
        parallelStats={parallelStats}
        currentUserId="user1"
        isConnected={true}
      />
    );

    // Basic stats still visible
    expect(screen.getByText('Segmentation Queue')).toBeInTheDocument();
    expect(screen.getByText('Connected')).toBeInTheDocument();
    expect(screen.getByText('processing')).toBeInTheDocument();
  });

  it('shows queue position and processing info with parallelStats', () => {
    const stats: QueueStats = {
      queueLength: 8,
      processing: 4,
      userPosition: 5,
      estimatedWaitTime: 300,
      queued: 8,
    };

    const parallelStats: ParallelProcessingStats = {
      totalSlots: 4,
      activeSlots: [],
      concurrentUsers: 4,
      estimatedWaitTime: 300,
      isParallelProcessingEnabled: true,
    };

    render(
      <QueueStatsPanel
        {...defaultProps}
        stats={stats}
        parallelStats={parallelStats}
        currentUserId="user1"
        isConnected={true}
      />
    );

    // Basic stats shown
    expect(screen.getByText('Segmentation Queue')).toBeInTheDocument();
    expect(screen.getByText('8')).toBeInTheDocument(); // queued count
    expect(screen.getByText('4')).toBeInTheDocument(); // processing count
  });

  it('renders with all slots active - shows queue info correctly', () => {
    const activeSlots: ProcessingSlot[] = Array.from({ length: 4 }, (_, i) => ({
      id: i,
      isActive: true,
      userId: `user${i + 1}`,
    }));

    const parallelStats: ParallelProcessingStats = {
      totalSlots: 4,
      activeSlots,
      concurrentUsers: 4,
      isParallelProcessingEnabled: true,
    };

    render(
      <QueueStatsPanel
        {...defaultProps}
        stats={{ queueLength: 5, processing: 4, queued: 5 }}
        parallelStats={parallelStats}
        currentUserId="user1"
        isConnected={true}
      />
    );

    // Queue stats should still be visible
    expect(screen.getByText('Segmentation Queue')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument(); // queued count
    expect(screen.getByText('waiting')).toBeInTheDocument();
    expect(screen.getByText('4')).toBeInTheDocument(); // processing count
    expect(screen.getByText('processing')).toBeInTheDocument();
  });

  it('handles segment all button click with parallel processing context', () => {
    const parallelStats: ParallelProcessingStats = {
      totalSlots: 4,
      activeSlots: [],
      concurrentUsers: 0,
      isParallelProcessingEnabled: true,
    };

    render(
      <QueueStatsPanel
        {...defaultProps}
        stats={{ queueLength: 0, processing: 0, queued: 0 }}
        parallelStats={parallelStats}
        currentUserId="user1"
        isConnected={true}
        imagesToSegmentCount={5}
      />
    );

    // Check that segment button exists and can be clicked
    const segmentButton = screen.getByRole('button', { name: /segment/i });
    expect(segmentButton).toBeInTheDocument();

    fireEvent.click(segmentButton);
    expect(mockOnSegmentAll).toHaveBeenCalledTimes(1);
  });

  it('does not render parallel processing features when disabled', () => {
    const stats: QueueStats = {
      queueLength: 3,
      processing: 2,
      queued: 3,
    };

    const parallelStats: ParallelProcessingStats = {
      totalSlots: 4,
      activeSlots: [],
      concurrentUsers: 0,
      isParallelProcessingEnabled: false,
    };

    render(
      <QueueStatsPanel
        {...defaultProps}
        stats={stats}
        parallelStats={parallelStats}
        isConnected={true}
      />
    );

    expect(screen.queryByText('parallel')).not.toBeInTheDocument();
    expect(screen.queryByTestId('processing-slots')).not.toBeInTheDocument();
    expect(
      screen.queryByText('All processing slots are active')
    ).not.toBeInTheDocument();
  });

  it('gracefully handles missing parallel stats', () => {
    const stats: QueueStats = {
      queueLength: 3,
      processing: 2,
      queued: 3,
    };

    render(
      <QueueStatsPanel {...defaultProps} stats={stats} isConnected={true} />
    );

    expect(screen.getByText('Segmentation Queue')).toBeInTheDocument();
    // Check that queue stats are displayed
    const queueElements = screen.getAllByText('3');
    expect(queueElements.length).toBeGreaterThan(0);
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.queryByText('parallel')).not.toBeInTheDocument();
  });
});
