import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '@/test/utils/test-utils';
import AvatarCropDialog from '@/components/profile/AvatarCropDialog';

// ── Mocks ─────────────────────────────────────────────────────────────────

// react-easy-crop renders a canvas/DOM tree that JSDOM can't handle;
// mock it to a simple test double that exposes the onCropComplete callback.
let capturedOnCropComplete: ((area: unknown, pixels: unknown) => void) | null =
  null;

vi.mock('react-easy-crop', () => ({
  default: ({
    onCropComplete,
  }: {
    onCropComplete: (area: unknown, pixels: unknown) => void;
  }) => {
    capturedOnCropComplete = onCropComplete;
    return <div data-testid="mock-cropper">Cropper placeholder</div>;
  },
}));

// cropImageToCircle returns a Blob; mock so we avoid canvas ops
const mockCropImageToCircle = vi.fn();
vi.mock('@/lib/cropImage', () => ({
  cropImageToCircle: (...args: unknown[]) => mockCropImageToCircle(...args),
}));

// use-toast is the shadcn toast, not sonner — mock it
vi.mock('@/hooks/use-toast', () => ({
  toast: vi.fn(),
  useToast: vi.fn(() => ({ toast: vi.fn() })),
}));

// ── Helpers ──────────────────────────────────────────────────────────────

const MOCK_BLOB = new Blob(['fake-image'], { type: 'image/png' });
const MOCK_AREA = { x: 0, y: 0, width: 100, height: 100 };

function setup(
  overrides: Partial<{
    open: boolean;
    onClose: () => void;
    imageSrc: string;
    onCropComplete: (b: Blob) => Promise<void>;
  }> = {}
) {
  const props = {
    open: true,
    onClose: vi.fn(),
    imageSrc: 'data:image/png;base64,FAKEIMAGECONTENT',
    onCropComplete: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
  const result = render(<AvatarCropDialog {...props} />);
  return { ...result, props };
}

describe('AvatarCropDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedOnCropComplete = null;
    mockCropImageToCircle.mockResolvedValue(MOCK_BLOB);
  });

  // ── Rendering ────────────────────────────────────────────────────────────

  it('renders the dialog title', () => {
    setup();
    expect(screen.getByText('Crop Your Avatar')).toBeInTheDocument();
  });

  it('renders the Cropper component', () => {
    setup();
    expect(screen.getByTestId('mock-cropper')).toBeInTheDocument();
  });

  it('renders zoom slider label', () => {
    setup();
    // The Label text is rendered even if Radix Slider doesn't emit a native
    // <input> — check for the visible label text instead.
    expect(screen.getByText(/zoom level/i)).toBeInTheDocument();
  });

  it('renders Cancel and Apply Changes buttons', () => {
    setup();
    expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /apply changes/i })
    ).toBeInTheDocument();
  });

  it('Apply Changes is disabled initially (no crop area yet)', () => {
    setup();
    expect(
      screen.getByRole('button', { name: /apply changes/i })
    ).toBeDisabled();
  });

  it('is not rendered when open=false', () => {
    setup({ open: false });
    expect(screen.queryByText('Crop Your Avatar')).not.toBeInTheDocument();
  });

  // ── Cancel ────────────────────────────────────────────────────────────────

  it('Cancel calls onClose', async () => {
    const user = userEvent.setup();
    const { props } = setup();

    await user.click(screen.getByRole('button', { name: /cancel/i }));
    expect(props.onClose).toHaveBeenCalled();
  });

  // ── Apply Changes — needs crop area set ──────────────────────────────────

  it('Apply Changes becomes enabled once a crop area is set', async () => {
    setup();

    // Simulate the Cropper calling back with crop area data — wrap in act
    // so React flushes the resulting state update before we assert.
    await act(async () => {
      capturedOnCropComplete?.(MOCK_AREA, MOCK_AREA);
    });

    // Apply Changes button should now be enabled
    expect(
      screen.getByRole('button', { name: /apply changes/i })
    ).not.toBeDisabled();
  });

  it('calls cropImageToCircle with imageSrc and croppedAreaPixels', async () => {
    const user = userEvent.setup();
    const { props } = setup();

    await act(async () => {
      capturedOnCropComplete?.(MOCK_AREA, MOCK_AREA);
    });

    await user.click(screen.getByRole('button', { name: /apply changes/i }));

    await waitFor(() => {
      expect(mockCropImageToCircle).toHaveBeenCalledWith(
        props.imageSrc,
        MOCK_AREA
      );
    });
  });

  it('calls onCropComplete with the blob returned by cropImageToCircle', async () => {
    const user = userEvent.setup();
    const { props } = setup();

    await act(async () => {
      capturedOnCropComplete?.(MOCK_AREA, MOCK_AREA);
    });
    await user.click(screen.getByRole('button', { name: /apply changes/i }));

    await waitFor(() => {
      expect(props.onCropComplete).toHaveBeenCalledWith(MOCK_BLOB);
    });
  });

  it('calls onClose after successful crop+upload', async () => {
    const user = userEvent.setup();
    const { props } = setup();

    await act(async () => {
      capturedOnCropComplete?.(MOCK_AREA, MOCK_AREA);
    });
    await user.click(screen.getByRole('button', { name: /apply changes/i }));

    await waitFor(() => {
      expect(props.onClose).toHaveBeenCalled();
    });
  });

  // ── Error path ────────────────────────────────────────────────────────────

  it('shows error toast when cropImageToCircle throws', async () => {
    const user = userEvent.setup();
    mockCropImageToCircle.mockRejectedValue(new Error('Canvas error'));

    // We need the toast mock to verify the call
    const { toast } = await import('@/hooks/use-toast');

    setup();
    await act(async () => {
      capturedOnCropComplete?.(MOCK_AREA, MOCK_AREA);
    });
    await user.click(screen.getByRole('button', { name: /apply changes/i }));

    await waitFor(() => {
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({ variant: 'destructive' })
      );
    });
  });

  it('re-enables Apply Changes after an error (isProcessing cleared)', async () => {
    const user = userEvent.setup();
    mockCropImageToCircle.mockRejectedValue(new Error('Canvas error'));

    setup();
    await act(async () => {
      capturedOnCropComplete?.(MOCK_AREA, MOCK_AREA);
    });
    await user.click(screen.getByRole('button', { name: /apply changes/i }));

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /apply changes/i })
      ).not.toBeDisabled();
    });
  });
});
