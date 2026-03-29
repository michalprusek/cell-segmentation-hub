import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '@/test/utils/test-utils';
import { ImageCard } from '@/components/project/ImageCard';
import { ProjectImage } from '@/types';

// Mock useRetryImage to control image loading state in tests
const mockUseRetryImage = vi.fn();
vi.mock('@/hooks/shared/useRetry', () => ({
  useRetryImage: (...args: any[]) => mockUseRetryImage(...args),
}));

// Mock framer-motion
vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  },
}));

// Mock date-fns
vi.mock('date-fns', () => ({
  format: vi.fn(_date => '01.01.2023 12:00'),
}));

describe('ImageCard', () => {
  const mockOnDelete = vi.fn();
  const mockOnOpen = vi.fn();

  const baseImage: ProjectImage & {
    segmentationResult?: any;
  } = {
    id: 'test-image-1',
    name: 'test-image.jpg',
    filename: 'test-image.jpg',
    originalName: 'test-image.jpg',
    mimeType: 'image/jpeg',
    size: 1024000,
    width: 1920,
    height: 1080,
    thumbnailPath: '/thumbnails/test-image.jpg',
    thumbnail_url: '/thumbnails/test-image.jpg',
    url: '/images/test-image.jpg',
    image_url: '/images/test-image.jpg',
    projectId: 'test-project-id',
    processingStatus: 'completed' as const,
    segmentationStatus: 'completed' as const,
    uploadedAt: new Date('2023-01-01T12:00:00Z'),
    processedAt: new Date('2023-01-01T12:00:00Z'),
    updatedAt: new Date('2023-01-01T12:00:00Z'),
    segmentationResults: [],
  };

  const mockOnSelectionChange = vi.fn();

  const defaultProps = {
    image: baseImage,
    onDelete: mockOnDelete,
    onOpen: mockOnOpen,
    isSelected: false,
    onSelectionChange: mockOnSelectionChange,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    // Default: image loads successfully
    mockUseRetryImage.mockReturnValue({
      currentUrl: '/thumbnails/test-image.jpg',
      loading: false,
      retrying: false,
      attempt: 0,
      nextRetryIn: null,
      imageError: false,
      retry: vi.fn(),
    });
  });

  it('renders image card with basic information', () => {
    render(<ImageCard {...defaultProps} />);

    expect(screen.getByText('test-image.jpg')).toBeInTheDocument();
    expect(screen.getByText('01.01.2023 12:00')).toBeInTheDocument();
  });

  it('displays image thumbnail', () => {
    render(<ImageCard {...defaultProps} />);

    const image = screen.getByRole('img');
    expect(image).toHaveAttribute('src', '/thumbnails/test-image.jpg');
    expect(image).toHaveAttribute('alt', 'test-image.jpg');
  });

  it('shows completed status badge', () => {
    render(<ImageCard {...defaultProps} />);

    expect(screen.getByText('Segmented')).toBeInTheDocument();

    const badge = screen.getByText('Segmented').closest('.flex');
    expect(badge).toHaveClass('bg-green-100', 'text-green-800');
  });

  it('shows processing status badge', () => {
    const processingImage = {
      ...baseImage,
      segmentationStatus: 'processing' as const,
    };

    render(<ImageCard {...defaultProps} image={processingImage} />);

    expect(screen.getByText('Processing')).toBeInTheDocument();

    const badge = screen.getByText('Processing').closest('.flex');
    expect(badge).toHaveClass('bg-blue-100', 'text-blue-800');
  });

  it('shows failed status badge', () => {
    const failedImage = {
      ...baseImage,
      segmentationStatus: 'failed' as const,
    };

    render(<ImageCard {...defaultProps} image={failedImage} />);

    expect(screen.getByText('Failed')).toBeInTheDocument();

    const badge = screen.getByText('Failed').closest('.flex');
    expect(badge).toHaveClass('bg-red-100', 'text-red-800');
  });

  it('shows queued status badge', () => {
    const queuedImage = {
      ...baseImage,
      segmentationStatus: 'queued' as const,
    };

    render(<ImageCard {...defaultProps} image={queuedImage} />);

    expect(screen.getByText('Queued')).toBeInTheDocument();

    const badge = screen.getByText('Queued').closest('.flex');
    expect(badge).toHaveClass('bg-yellow-100', 'text-yellow-800');
  });

  it('shows no segmentation status badge', () => {
    const noSegImage = {
      ...baseImage,
      segmentationStatus: 'no_segmentation' as const,
    };

    render(<ImageCard {...defaultProps} image={noSegImage} />);

    expect(screen.getByText('No segmentation')).toBeInTheDocument();

    const badge = screen.getByText('No segmentation').closest('.flex');
    expect(badge).toHaveClass('bg-gray-100', 'text-gray-800');
  });

  it('calls onOpen when card is clicked', async () => {
    const user = userEvent.setup();
    render(<ImageCard {...defaultProps} />);

    const card = document.querySelector('.cursor-pointer');
    expect(card).toBeInTheDocument();

    if (card) {
      await user.click(card);
    }
    expect(mockOnOpen).toHaveBeenCalledWith('test-image-1');
  });

  it('calls onDelete when delete button is clicked', async () => {
    const user = userEvent.setup();
    render(<ImageCard {...defaultProps} />);

    // Hover the card to show the delete button
    const card = document.querySelector('.cursor-pointer');
    if (card) {
      await user.hover(card);
    }

    const deleteButton = screen.getByRole('button');
    expect(deleteButton).toBeInTheDocument();

    await user.click(deleteButton);
    expect(mockOnDelete).toHaveBeenCalledWith('test-image-1');
  });

  it('stops propagation on delete button click', async () => {
    const user = userEvent.setup();
    render(<ImageCard {...defaultProps} />);

    const card = document.querySelector('.cursor-pointer');
    await user.hover(card!);

    const deleteButton = screen.getByRole('button');
    await user.click(deleteButton);

    // onOpen should not be called when delete button is clicked
    expect(mockOnOpen).not.toHaveBeenCalled();
    expect(mockOnDelete).toHaveBeenCalled();
  });

  it('renders image thumbnail when completed with polygons', () => {
    const imageWithSegmentation = {
      ...baseImage,
      segmentationResult: {
        polygons: [
          {
            id: 'poly-1',
            points: [
              { x: 100, y: 100 },
              { x: 200, y: 100 },
              { x: 200, y: 200 },
            ],
            type: 'external' as const,
          },
        ],
        imageWidth: 1920,
        imageHeight: 1080,
        polygonCount: 1,
        pointCount: 3,
      },
    };

    render(<ImageCard {...defaultProps} image={imageWithSegmentation} />);

    // Component uses server-generated thumbnails, canvas renderer has been removed
    const img = screen.getByRole('img');
    expect(img).toBeInTheDocument();
    expect(screen.getByText('Segmented')).toBeInTheDocument();
  });

  it('renders image thumbnail when no polygons', () => {
    const imageWithoutSegmentation = {
      ...baseImage,
      segmentationResult: {
        polygons: [],
        imageWidth: 1920,
        imageHeight: 1080,
      },
    };

    render(<ImageCard {...defaultProps} image={imageWithoutSegmentation} />);

    // Component uses server-generated thumbnails; no separate canvas overlay
    const img = screen.getByRole('img');
    expect(img).toBeInTheDocument();
  });

  it('handles image loading errors gracefully', () => {
    // Simulate all image URLs failing to load
    mockUseRetryImage.mockReturnValue({
      currentUrl: null,
      loading: false,
      retrying: false,
      attempt: 3,
      nextRetryIn: null,
      imageError: true,
      retry: vi.fn(),
    });

    render(<ImageCard {...defaultProps} />);

    expect(screen.getByText('No preview')).toBeInTheDocument();
  });

  it('falls back to alternative image URLs on error', () => {
    // Mock useRetryImage to simulate fallback to second URL
    mockUseRetryImage.mockReturnValue({
      currentUrl: '/thumbnail.jpg',
      loading: false,
      retrying: false,
      attempt: 1,
      nextRetryIn: null,
      imageError: false,
      retry: vi.fn(),
    });

    const imageWithMultipleUrls = {
      ...baseImage,
      thumbnail_url: '/thumbnail.jpg',
      url: '/image.jpg',
      image_url: '/full-image.jpg',
    };

    render(<ImageCard {...defaultProps} image={imageWithMultipleUrls} />);

    const image = screen.getByRole('img');
    expect(image).toHaveAttribute('src', '/thumbnail.jpg');
  });

  it('has correct fixed dimensions for stable rendering', () => {
    render(<ImageCard {...defaultProps} />);

    // Component uses Tailwind responsive classes for sizing
    const card = document.querySelector('.cursor-pointer');
    expect(card).toBeInTheDocument();
    expect(card).toHaveClass('min-h-[167px]');
  });

  it('applies hover effects correctly', async () => {
    const _user = userEvent.setup();
    render(<ImageCard {...defaultProps} />);

    const card = document.querySelector('.cursor-pointer');
    expect(card).toHaveClass('hover:shadow-xl', 'hover:scale-[1.02]');
  });

  it('shows gradient overlay', () => {
    render(<ImageCard {...defaultProps} />);

    const gradientOverlay = document.querySelector(
      '.bg-gradient-to-t.from-black\\/70'
    );
    expect(gradientOverlay).toBeInTheDocument();
  });

  it('handles missing image name gracefully', () => {
    const imageWithoutName = {
      ...baseImage,
      name: '',
    };

    render(<ImageCard {...defaultProps} image={imageWithoutName} />);

    expect(screen.getByText('Image')).toBeInTheDocument();
  });

  it('applies correct z-index layering', () => {
    render(<ImageCard {...defaultProps} />);

    const gradientOverlay = document.querySelector('[style*="z-index: 5"]');
    expect(gradientOverlay).toBeInTheDocument();

    const actionButtons = document.querySelector('[style*="z-index: 15"]');
    expect(actionButtons).toBeInTheDocument();
  });

  it('handles custom className prop', () => {
    render(<ImageCard {...defaultProps} className="custom-class" />);

    const card = document.querySelector('.custom-class');
    expect(card).toBeInTheDocument();
  });

  it('shows processing animation for processing status', () => {
    const processingImage = {
      ...baseImage,
      segmentationStatus: 'processing' as const,
    };

    render(<ImageCard {...defaultProps} image={processingImage} />);

    const spinningIcon = document.querySelector('.animate-spin');
    expect(spinningIcon).toBeInTheDocument();
  });

  it('truncates long image names with title attribute', () => {
    const longNameImage = {
      ...baseImage,
      name: 'very-long-image-name-that-should-be-truncated.jpg',
    };

    render(<ImageCard {...defaultProps} image={longNameImage} />);

    const nameElement = screen.getByText(
      'very-long-image-name-that-should-be-truncated.jpg'
    );
    expect(nameElement).toHaveClass('truncate');
    expect(nameElement).toHaveAttribute(
      'title',
      'very-long-image-name-that-should-be-truncated.jpg'
    );
  });
});
