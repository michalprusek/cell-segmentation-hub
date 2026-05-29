/**
 * Behavioral unit tests for ImageSelectionCard.
 *
 * Tested behaviours:
 *  1.  Loading spinner renders when loading=true; image list is hidden.
 *  2.  "No images available" message renders when images=[] and loading=false.
 *  3.  Card title renders.
 *  4.  Image names are rendered for each image.
 *  5.  "Select All" label appears when not all images are selected.
 *  6.  "Deselect All" label appears when all images are selected.
 *  7.  Clicking the select-all button calls handleSelectAll.
 *  8.  Clicking an image row calls handleSelectImage with the image id.
 *  9.  Checkbox reflects checked state when image is selected.
 *  10. Checkbox reflects unchecked state when image is not selected.
 *  11. Check icon (segmentation completed) renders for 'completed' status.
 *  12. X icon (segmentation failed) renders for 'failed' status.
 *  13. No status icon for pending/other status images.
 *  14. Thumbnail image renders when thumbnail_url is provided.
 *  15. "No preview" placeholder renders when thumbnail_url is absent.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '@/test/utils/test-utils';
import ImageSelectionCard from '../ImageSelectionCard';
import type { ProjectImage } from '@/types';

// ── helpers ──────────────────────────────────────────────────────────────────

function makeImage(overrides: Partial<ProjectImage> = {}): ProjectImage {
  return {
    id: 'img-1',
    name: 'sample.jpg',
    url: '/images/img-1.jpg',
    createdAt: new Date('2024-01-15'),
    updatedAt: new Date('2024-01-15'),
    segmentationStatus: 'no_segmentation',
    thumbnail_url: undefined,
    ...overrides,
  };
}

const defaultProps = {
  images: [] as ProjectImage[],
  loading: false,
  selectedImages: {} as Record<string, boolean>,
  handleSelectAll: vi.fn(),
  handleSelectImage: vi.fn(),
};

function setup(overrides: Partial<typeof defaultProps> = {}) {
  return render(<ImageSelectionCard {...defaultProps} {...overrides} />);
}

// ── tests ────────────────────────────────────────────────────────────────────

describe('ImageSelectionCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // 1
  it('shows spinner when loading=true', () => {
    setup({ loading: true, images: [makeImage()] });
    // Lucide Loader2 icon has animate-spin class
    const spinner = document.querySelector('.animate-spin');
    expect(spinner).toBeInTheDocument();
    // image list is not rendered
    expect(screen.queryByText('sample.jpg')).not.toBeInTheDocument();
  });

  // 2
  it('shows "No images are available" when images array is empty', () => {
    setup({ images: [], loading: false });
    expect(screen.getByText('No images are available')).toBeInTheDocument();
  });

  // 3
  it('renders the card title', () => {
    setup();
    expect(screen.getByText('Select images to export')).toBeInTheDocument();
  });

  // 4
  it('renders image names', () => {
    const images = [
      makeImage({ id: 'a', name: 'alpha.png' }),
      makeImage({ id: 'b', name: 'beta.png' }),
    ];
    setup({ images });
    expect(screen.getByText('alpha.png')).toBeInTheDocument();
    expect(screen.getByText('beta.png')).toBeInTheDocument();
  });

  // 5
  it('shows "Select All" when not all images are selected', () => {
    const images = [makeImage({ id: 'a' }), makeImage({ id: 'b' })];
    // only 'a' is selected → not all
    setup({ images, selectedImages: { a: true } });
    expect(
      screen.getByRole('button', { name: 'Select All' })
    ).toBeInTheDocument();
  });

  // 6
  it('shows "Deselect All" when all images are selected', () => {
    const images = [makeImage({ id: 'a' }), makeImage({ id: 'b' })];
    setup({ images, selectedImages: { a: true, b: true } });
    expect(
      screen.getByRole('button', { name: 'Deselect All' })
    ).toBeInTheDocument();
  });

  // 7
  it('calls handleSelectAll when the toggle button is clicked', async () => {
    const handleSelectAll = vi.fn();
    const images = [makeImage({ id: 'a' })];
    setup({ images, handleSelectAll });
    await userEvent.click(screen.getByRole('button', { name: 'Select All' }));
    expect(handleSelectAll).toHaveBeenCalledTimes(1);
  });

  // 8
  it('calls handleSelectImage with image id when row is clicked', async () => {
    const handleSelectImage = vi.fn();
    const image = makeImage({ id: 'img-42', name: 'foo.jpg' });
    setup({ images: [image], handleSelectImage });
    await userEvent.click(screen.getByText('foo.jpg'));
    expect(handleSelectImage).toHaveBeenCalledWith('img-42');
  });

  // 9
  it('renders checkbox as checked when image is selected', () => {
    const image = makeImage({ id: 'sel' });
    setup({ images: [image], selectedImages: { sel: true } });
    const checkbox = document.getElementById('check-sel') as HTMLInputElement;
    expect(checkbox).toBeInTheDocument();
    expect(checkbox).toBeChecked();
  });

  // 10
  it('renders checkbox as unchecked when image is not selected', () => {
    const image = makeImage({ id: 'unsel' });
    setup({ images: [image], selectedImages: {} });
    const checkbox = document.getElementById('check-unsel') as HTMLInputElement;
    expect(checkbox).toBeInTheDocument();
    expect(checkbox).not.toBeChecked();
  });

  // 11
  it('renders Check icon for completed segmentation status', () => {
    const image = makeImage({ id: 'c1', segmentationStatus: 'completed' });
    const { container } = setup({ images: [image] });
    // Lucide Check renders an svg; the row has text-green-500 on its icon wrapper
    const greenIcon = container.querySelector('.text-green-500');
    expect(greenIcon).toBeInTheDocument();
  });

  // 12
  it('renders X icon for failed segmentation status', () => {
    const image = makeImage({ id: 'f1', segmentationStatus: 'failed' });
    const { container } = setup({ images: [image] });
    const redIcon = container.querySelector('.text-red-500');
    expect(redIcon).toBeInTheDocument();
  });

  // 13
  it('renders no status icon for pending status', () => {
    const image = makeImage({ id: 'p1', segmentationStatus: 'pending' });
    const { container } = setup({ images: [image] });
    expect(container.querySelector('.text-green-500')).not.toBeInTheDocument();
    expect(container.querySelector('.text-red-500')).not.toBeInTheDocument();
  });

  // 14
  it('renders thumbnail img when thumbnail_url is provided', () => {
    const image = makeImage({
      id: 't1',
      name: 'photo.jpg',
      thumbnail_url: '/thumb/photo.jpg',
    });
    setup({ images: [image] });
    const img = screen.getByAltText('photo.jpg');
    expect(img).toBeInTheDocument();
    expect(img).toHaveAttribute('src', '/thumb/photo.jpg');
  });

  // 15
  it('renders "No preview" placeholder when thumbnail_url is absent', () => {
    const image = makeImage({ id: 'np', thumbnail_url: undefined });
    setup({ images: [image] });
    expect(screen.getByText('No preview')).toBeInTheDocument();
  });
});
