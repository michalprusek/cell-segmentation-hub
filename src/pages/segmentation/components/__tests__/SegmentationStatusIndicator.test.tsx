import { render, screen } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { SegmentationStatusIndicator } from '../SegmentationStatusIndicator';
import type { SegmentationUpdate } from '@/hooks/useSegmentationQueue';

// Mock the language context
const mockT = vi.fn((key: string) => {
  const translations: Record<string, string> = {
    'status.processing': 'Processing',
    'status.queued': 'Queued',
    'status.segmented': 'Segmented',
    'status.failed': 'Failed',
    'status.noPolygons': 'No polygons',
    'segmentationEditor.segmenting': 'Segmenting image...',
    'segmentationEditor.waitingInQueue': 'Waiting in processing queue...',
  };
  return translations[key] || key;
});

vi.mock('@/contexts/LanguageContext', () => ({
  useLanguage: () => ({ t: mockT }),
}));

// Mock framer-motion to avoid animation issues in tests
vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  },
}));

// Mock lucide-react icons
vi.mock('lucide-react', () => ({
  Loader2: () => <div data-testid="loader-icon" />,
  Clock: () => <div data-testid="clock-icon" />,
  CheckCircle: () => <div data-testid="check-icon" />,
  XCircle: () => <div data-testid="x-icon" />,
  AlertTriangle: () => <div data-testid="alert-icon" />,
}));

// Mock UI components
vi.mock('@/components/ui/badge', () => ({
  Badge: ({ children, className }: any) => (
    <div data-testid="badge" className={className}>
      {children}
    </div>
  ),
}));

describe('SegmentationStatusIndicator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should not render when status is not provided', () => {
    const { container } = render(
      <SegmentationStatusIndicator imageId="test-image-1" />
    );
    expect(container.firstChild).toBeNull();
  });

  it('should not render when status is completed/segmented', () => {
    const { container } = render(
      <SegmentationStatusIndicator
        imageId="test-image-1"
        segmentationStatus="segmented"
      />
    );
    expect(container.firstChild).toBeNull();
  });

  it('should render processing status with spinner', () => {
    render(
      <SegmentationStatusIndicator
        imageId="test-image-1"
        segmentationStatus="processing"
      />
    );

    expect(screen.getByTestId('badge')).toBeInTheDocument();
    expect(screen.getByTestId('loader-icon')).toBeInTheDocument();
    expect(screen.getByText('Processing')).toBeInTheDocument();
    expect(screen.getByText('Segmenting image...')).toBeInTheDocument();
  });

  it('should render queued status with clock icon', () => {
    render(
      <SegmentationStatusIndicator
        imageId="test-image-1"
        segmentationStatus="queued"
        queuePosition={3}
      />
    );

    expect(screen.getByTestId('badge')).toBeInTheDocument();
    expect(screen.getByTestId('clock-icon')).toBeInTheDocument();
    expect(screen.getByText('Queued')).toBeInTheDocument();
    expect(screen.getByText('(#3)')).toBeInTheDocument();
    expect(
      screen.getByText('Waiting in processing queue...')
    ).toBeInTheDocument();
  });

  it('should render failed status with X icon', () => {
    render(
      <SegmentationStatusIndicator
        imageId="test-image-1"
        segmentationStatus="failed"
      />
    );

    expect(screen.getByTestId('badge')).toBeInTheDocument();
    expect(screen.getByTestId('x-icon')).toBeInTheDocument();
    expect(screen.getByText('Failed')).toBeInTheDocument();
  });

  it('should render no_segmentation status with warning icon', () => {
    render(
      <SegmentationStatusIndicator
        imageId="test-image-1"
        segmentationStatus="no_segmentation"
      />
    );

    expect(screen.getByTestId('badge')).toBeInTheDocument();
    expect(screen.getByTestId('alert-icon')).toBeInTheDocument();
    expect(screen.getByText('No polygons')).toBeInTheDocument();
  });

  it('should prefer lastUpdate status over segmentationStatus when imageIds match', () => {
    const lastUpdate: SegmentationUpdate = {
      imageId: 'test-image-1',
      status: 'processing',
      timestamp: Date.now(),
      polygonCount: 0,
    };

    render(
      <SegmentationStatusIndicator
        imageId="test-image-1"
        segmentationStatus="queued"
        lastUpdate={lastUpdate}
      />
    );

    expect(screen.getByText('Processing')).toBeInTheDocument();
    expect(screen.getByTestId('loader-icon')).toBeInTheDocument();
  });

  it('should use segmentationStatus when lastUpdate imageId does not match', () => {
    const lastUpdate: SegmentationUpdate = {
      imageId: 'different-image',
      status: 'processing',
      timestamp: Date.now(),
      polygonCount: 0,
    };

    render(
      <SegmentationStatusIndicator
        imageId="test-image-1"
        segmentationStatus="queued"
        lastUpdate={lastUpdate}
      />
    );

    expect(screen.getByText('Queued')).toBeInTheDocument();
    expect(screen.getByTestId('clock-icon')).toBeInTheDocument();
  });

  it('should not show queue position when position is 0 or undefined', () => {
    render(
      <SegmentationStatusIndicator
        imageId="test-image-1"
        segmentationStatus="queued"
        queuePosition={0}
      />
    );

    expect(screen.queryByText(/^#\d+/)).not.toBeInTheDocument();
  });

  it('should apply custom className', () => {
    const { container } = render(
      <SegmentationStatusIndicator
        imageId="test-image-1"
        segmentationStatus="processing"
        className="custom-class"
      />
    );

    expect(container.firstChild).toHaveClass('custom-class');
  });

  it('should re-render when props change (memoization test)', () => {
    const { rerender } = render(
      <SegmentationStatusIndicator
        imageId="test-image-1"
        segmentationStatus="processing"
      />
    );

    expect(screen.getByText('Processing')).toBeInTheDocument();

    rerender(
      <SegmentationStatusIndicator
        imageId="test-image-1"
        segmentationStatus="queued"
      />
    );

    expect(screen.getByText('Queued')).toBeInTheDocument();
    expect(screen.queryByText('Processing')).not.toBeInTheDocument();
  });
});
