import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '@/test/utils/test-utils';
import { ImageListItem } from '@/components/project/ImageListItem';
import type { ProjectImage } from '@/types';

// framer-motion: stub away layout animations so tests stay synchronous
vi.mock('framer-motion', () => ({
  motion: {
    div: ({
      children,
      ...props
    }: React.HTMLAttributes<HTMLDivElement> & {
      children?: React.ReactNode;
    }) => <div {...props}>{children}</div>,
  },
  AnimatePresence: ({ children }: { children?: React.ReactNode }) => (
    <>{children}</>
  ),
}));

vi.mock('date-fns', () => ({
  format: vi.fn(() => 'January 1st, 2023'),
}));

// ── Fixtures ─────────────────────────────────────────────────────────────────

const baseImage: ProjectImage = {
  id: 'img-001',
  name: 'sample.tif',
  filename: 'sample.tif',
  originalName: 'sample.tif',
  mimeType: 'image/tiff',
  size: 2048000,
  width: 1024,
  height: 768,
  thumbnailPath: '/thumbs/sample.jpg',
  thumbnail_url: '/thumbs/sample.jpg',
  url: '/images/sample.tif',
  image_url: '/images/sample.tif',
  projectId: 'proj-1',
  processingStatus: 'completed' as const,
  segmentationStatus: 'completed' as const,
  uploadedAt: new Date('2023-01-01T00:00:00Z'),
  processedAt: new Date('2023-01-01T00:00:00Z'),
  updatedAt: new Date('2023-01-01T00:00:00Z'),
  createdAt: new Date('2023-01-01T00:00:00Z'),
  segmentationResults: [],
};

const defaultProps = {
  image: baseImage,
  onDelete: vi.fn(),
  onOpen: vi.fn(),
  isSelected: false,
  onSelectionChange: vi.fn(),
};

describe('ImageListItem', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Rendering ────────────────────────────────────────────────────────────

  describe('Rendering', () => {
    it('renders the image name', () => {
      render(<ImageListItem {...defaultProps} />);
      expect(screen.getByText('sample.tif')).toBeInTheDocument();
    });

    it('renders the formatted creation date', () => {
      render(<ImageListItem {...defaultProps} />);
      expect(screen.getByText('January 1st, 2023')).toBeInTheDocument();
    });

    it('renders a thumbnail <img> when thumbnail_url is provided', () => {
      render(<ImageListItem {...defaultProps} />);
      const img = screen.getByRole('img');
      expect(img).toHaveAttribute('src', '/thumbs/sample.jpg');
    });

    it('falls back to url when thumbnail_url is absent', () => {
      const imageNoThumb: ProjectImage = {
        ...baseImage,
        thumbnail_url: undefined as unknown as string,
        thumbnailPath: undefined as unknown as string,
      };
      render(<ImageListItem {...defaultProps} image={imageNoThumb} />);
      const img = screen.getByRole('img');
      expect(img).toHaveAttribute('src', '/images/sample.tif');
    });

    it('shows "No Image" placeholder when both urls are absent', () => {
      const imageNoUrls: ProjectImage = {
        ...baseImage,
        thumbnail_url: undefined as unknown as string,
        thumbnailPath: undefined as unknown as string,
        url: undefined as unknown as string,
        image_url: undefined as unknown as string,
      };
      render(<ImageListItem {...defaultProps} image={imageNoUrls} />);
      expect(screen.getByText('No Image')).toBeInTheDocument();
    });

    it('shows "Untitled Image" when name is empty', () => {
      const imageNoName: ProjectImage = { ...baseImage, name: '' };
      render(<ImageListItem {...defaultProps} image={imageNoName} />);
      expect(screen.getByText('Untitled Image')).toBeInTheDocument();
    });

    it('renders Segmented badge for completed status', () => {
      render(<ImageListItem {...defaultProps} />);
      expect(screen.getByText('Segmented')).toBeInTheDocument();
    });

    it('renders Processing badge for processing status', () => {
      const img: ProjectImage = {
        ...baseImage,
        segmentationStatus: 'processing' as const,
      };
      render(<ImageListItem {...defaultProps} image={img} />);
      expect(screen.getByText('Processing')).toBeInTheDocument();
    });

    it('renders Queued badge for queued status', () => {
      const img: ProjectImage = {
        ...baseImage,
        segmentationStatus: 'queued' as const,
      };
      render(<ImageListItem {...defaultProps} image={img} />);
      expect(screen.getByText('Queued')).toBeInTheDocument();
    });

    it('renders no badge when segmentationStatus is undefined', () => {
      const img: ProjectImage = { ...baseImage, segmentationStatus: undefined };
      render(<ImageListItem {...defaultProps} image={img} />);
      expect(screen.queryByText('Segmented')).not.toBeInTheDocument();
      expect(screen.queryByText('Processing')).not.toBeInTheDocument();
      expect(screen.queryByText('Queued')).not.toBeInTheDocument();
    });

    it('renders the delete button', () => {
      render(<ImageListItem {...defaultProps} />);
      expect(screen.getByRole('button')).toBeInTheDocument();
    });

    it('renders the checkbox', () => {
      render(<ImageListItem {...defaultProps} />);
      expect(screen.getByRole('checkbox')).toBeInTheDocument();
    });

    it('reflects isSelected=true on the checkbox', () => {
      render(<ImageListItem {...defaultProps} isSelected />);
      expect(screen.getByRole('checkbox')).toBeChecked();
    });

    it('reflects isSelected=false on the checkbox', () => {
      render(<ImageListItem {...defaultProps} isSelected={false} />);
      expect(screen.getByRole('checkbox')).not.toBeChecked();
    });
  });

  // ── Click interactions ────────────────────────────────────────────────────

  describe('Interactions', () => {
    it('calls onOpen with image id when the item is clicked', async () => {
      const user = userEvent.setup();
      render(<ImageListItem {...defaultProps} />);
      // Click the name text which is inside the clickable motion div
      await user.click(screen.getByText('sample.tif'));
      expect(defaultProps.onOpen).toHaveBeenCalledWith('img-001');
    });

    it('calls onDelete with image id when delete button is clicked', async () => {
      const user = userEvent.setup();
      render(<ImageListItem {...defaultProps} />);
      await user.click(screen.getByRole('button'));
      expect(defaultProps.onDelete).toHaveBeenCalledWith('img-001');
    });

    it('does NOT call onOpen when delete button is clicked (stopPropagation)', async () => {
      const user = userEvent.setup();
      render(<ImageListItem {...defaultProps} />);
      await user.click(screen.getByRole('button'));
      expect(defaultProps.onOpen).not.toHaveBeenCalled();
    });

    it('calls onSelectionChange with id and checked=true when checkbox is toggled on', async () => {
      const user = userEvent.setup();
      render(<ImageListItem {...defaultProps} isSelected={false} />);
      await user.click(screen.getByRole('checkbox'));
      expect(defaultProps.onSelectionChange).toHaveBeenCalledWith(
        'img-001',
        true
      );
    });

    it('does NOT call onOpen when checkbox is clicked (stopPropagation)', async () => {
      const user = userEvent.setup();
      render(<ImageListItem {...defaultProps} />);
      await user.click(screen.getByRole('checkbox'));
      expect(defaultProps.onOpen).not.toHaveBeenCalled();
    });
  });

  // ── Custom className ─────────────────────────────────────────────────────

  it('forwards className to the root element', () => {
    const { container } = render(
      <ImageListItem {...defaultProps} className="test-custom-class" />
    );
    expect(container.querySelector('.test-custom-class')).toBeInTheDocument();
  });
});
