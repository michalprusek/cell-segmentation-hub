import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '@/test/utils/test-utils';
import { ImageSelectionGrid } from '@/pages/export/components/ImageSelectionGrid';
import type { ProjectImage } from '@/types';

// ── Mock ExportImageCard so grid logic is isolated ────────────────────────

vi.mock('@/pages/export/components/ExportImageCard', () => ({
  ExportImageCard: ({
    image,
    isSelected,
    onToggleSelection,
  }: {
    image: ProjectImage;
    isSelected: boolean;
    onToggleSelection: (id: string) => void;
  }) => (
    <div
      data-testid={`export-card-${image.id}`}
      data-selected={isSelected}
      onClick={() => onToggleSelection(image.id)}
    >
      {image.name}
    </div>
  ),
}));

// ── Fixtures ──────────────────────────────────────────────────────────────

function makeImage(id: string, name: string): ProjectImage {
  return {
    id,
    name,
    url: `/images/${id}.jpg`,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
    segmentationStatus: 'completed',
  } as ProjectImage;
}

function makeImages(count: number): ProjectImage[] {
  return Array.from({ length: count }, (_, i) =>
    makeImage(`img-${i + 1}`, `Image ${i + 1}`)
  );
}

const FIVE_IMAGES = makeImages(5);

describe('ImageSelectionGrid', () => {
  const onSelectionChange = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Rendering ────────────────────────────────────────────────────────────

  it('renders a card for each image', () => {
    render(
      <ImageSelectionGrid
        images={FIVE_IMAGES}
        selectedImageIds={[]}
        onSelectionChange={onSelectionChange}
      />
    );

    for (const img of FIVE_IMAGES) {
      expect(screen.getByTestId(`export-card-${img.id}`)).toBeInTheDocument();
    }
  });

  it('renders the search input', () => {
    render(
      <ImageSelectionGrid
        images={FIVE_IMAGES}
        selectedImageIds={[]}
        onSelectionChange={onSelectionChange}
      />
    );
    expect(screen.getByPlaceholderText(/search images/i)).toBeInTheDocument();
  });

  it('renders the sort-by select trigger', () => {
    render(
      <ImageSelectionGrid
        images={FIVE_IMAGES}
        selectedImageIds={[]}
        onSelectionChange={onSelectionChange}
      />
    );
    // Default sortBy is 'date'; the Select trigger shows the selected option
    // label.  The i18n key export.sortOptions.date → "Date"
    expect(screen.getByText('Date')).toBeInTheDocument();
  });

  it('shows select-all label when none selected', () => {
    render(
      <ImageSelectionGrid
        images={FIVE_IMAGES}
        selectedImageIds={[]}
        onSelectionChange={onSelectionChange}
      />
    );
    expect(screen.getByText('Select All')).toBeInTheDocument();
  });

  it('shows select-none label when all selected', () => {
    render(
      <ImageSelectionGrid
        images={FIVE_IMAGES}
        selectedImageIds={FIVE_IMAGES.map(i => i.id)}
        onSelectionChange={onSelectionChange}
      />
    );
    expect(screen.getByText('Select None')).toBeInTheDocument();
  });

  it('shows the image count summary', () => {
    render(
      <ImageSelectionGrid
        images={FIVE_IMAGES}
        selectedImageIds={['img-1', 'img-2']}
        onSelectionChange={onSelectionChange}
      />
    );
    // "2 of 5 images selected"
    expect(screen.getByText(/2 of 5 images selected/i)).toBeInTheDocument();
  });

  it('shows "No images found" when images list is empty', () => {
    render(
      <ImageSelectionGrid
        images={[]}
        selectedImageIds={[]}
        onSelectionChange={onSelectionChange}
      />
    );
    expect(screen.getByText(/no images found/i)).toBeInTheDocument();
  });

  // ── Initial selection applied ─────────────────────────────────────────────

  it('marks initially-selected images as selected', () => {
    render(
      <ImageSelectionGrid
        images={FIVE_IMAGES}
        selectedImageIds={['img-3']}
        onSelectionChange={onSelectionChange}
      />
    );
    expect(screen.getByTestId('export-card-img-3')).toHaveAttribute(
      'data-selected',
      'true'
    );
    expect(screen.getByTestId('export-card-img-1')).toHaveAttribute(
      'data-selected',
      'false'
    );
  });

  // ── Selection toggling ────────────────────────────────────────────────────

  it('clicking a card toggles its selection and calls onSelectionChange', async () => {
    const user = userEvent.setup();
    render(
      <ImageSelectionGrid
        images={FIVE_IMAGES}
        selectedImageIds={[]}
        onSelectionChange={onSelectionChange}
      />
    );

    await user.click(screen.getByTestId('export-card-img-1'));

    await waitFor(() => {
      expect(onSelectionChange).toHaveBeenCalledWith(
        expect.arrayContaining(['img-1'])
      );
    });
  });

  it('clicking a selected card deselects it', async () => {
    const user = userEvent.setup();
    render(
      <ImageSelectionGrid
        images={FIVE_IMAGES}
        selectedImageIds={['img-2']}
        onSelectionChange={onSelectionChange}
      />
    );

    await user.click(screen.getByTestId('export-card-img-2'));

    await waitFor(() => {
      const lastCall =
        onSelectionChange.mock.calls[
          onSelectionChange.mock.calls.length - 1
        ][0];
      expect(lastCall).not.toContain('img-2');
    });
  });

  // ── Select All / None ─────────────────────────────────────────────────────

  it('clicking "Select All" row selects all images', async () => {
    const user = userEvent.setup();
    render(
      <ImageSelectionGrid
        images={FIVE_IMAGES}
        selectedImageIds={[]}
        onSelectionChange={onSelectionChange}
      />
    );

    const selectAllRow = screen.getByText('Select All').closest('div')!;
    await user.click(selectAllRow);

    await waitFor(() => {
      const lastArgs =
        onSelectionChange.mock.calls[
          onSelectionChange.mock.calls.length - 1
        ][0];
      expect(lastArgs).toHaveLength(5);
    });
  });

  it('clicking "Select None" row deselects all images', async () => {
    const user = userEvent.setup();
    render(
      <ImageSelectionGrid
        images={FIVE_IMAGES}
        selectedImageIds={FIVE_IMAGES.map(i => i.id)}
        onSelectionChange={onSelectionChange}
      />
    );

    const selectNoneRow = screen.getByText('Select None').closest('div')!;
    await user.click(selectNoneRow);

    await waitFor(() => {
      const lastArgs =
        onSelectionChange.mock.calls[
          onSelectionChange.mock.calls.length - 1
        ][0];
      expect(lastArgs).toHaveLength(0);
    });
  });

  // ── Search filtering ──────────────────────────────────────────────────────

  it('filtering by search term shows only matching images', async () => {
    const user = userEvent.setup();
    render(
      <ImageSelectionGrid
        images={FIVE_IMAGES}
        selectedImageIds={[]}
        onSelectionChange={onSelectionChange}
      />
    );

    const searchInput = screen.getByPlaceholderText(/search images/i);
    await user.type(searchInput, 'Image 3');

    // Only img-3 should remain visible
    await waitFor(() => {
      expect(screen.getByTestId('export-card-img-3')).toBeInTheDocument();
      expect(screen.queryByTestId('export-card-img-1')).not.toBeInTheDocument();
    });
  });

  it('shows "No images found" when search returns no results', async () => {
    const user = userEvent.setup();
    render(
      <ImageSelectionGrid
        images={FIVE_IMAGES}
        selectedImageIds={[]}
        onSelectionChange={onSelectionChange}
      />
    );

    await user.type(
      screen.getByPlaceholderText(/search images/i),
      'ZZZNOMATCH'
    );

    await waitFor(() => {
      expect(screen.getByText(/no images found/i)).toBeInTheDocument();
    });
  });

  it('clear button removes the search query', async () => {
    const user = userEvent.setup();
    render(
      <ImageSelectionGrid
        images={FIVE_IMAGES}
        selectedImageIds={[]}
        onSelectionChange={onSelectionChange}
      />
    );

    const searchInput = screen.getByPlaceholderText(/search images/i);
    await user.type(searchInput, 'Image 3');

    // Clear button appears once there is a query
    const clearButton = await screen.findByRole('button', {
      // the X button has no accessible name; find by its parent container
    });
    // The X button is the only button in the search container
    await user.click(clearButton);

    // All images should re-appear
    await waitFor(() => {
      expect(screen.getByTestId('export-card-img-1')).toBeInTheDocument();
      expect(screen.getByTestId('export-card-img-3')).toBeInTheDocument();
    });
  });

  // ── Pagination (> 30 images) ──────────────────────────────────────────────

  it('renders pagination when images exceed page size (30)', () => {
    const manyImages = makeImages(35);
    render(
      <ImageSelectionGrid
        images={manyImages}
        selectedImageIds={[]}
        onSelectionChange={onSelectionChange}
      />
    );

    // Pagination appears for > 30 items; page 1 and 2 buttons expected
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('does NOT render pagination when images fit on one page', () => {
    render(
      <ImageSelectionGrid
        images={FIVE_IMAGES}
        selectedImageIds={[]}
        onSelectionChange={onSelectionChange}
      />
    );

    // No page-number buttons visible for < 30 images
    expect(screen.queryByText('2')).not.toBeInTheDocument();
  });
});
