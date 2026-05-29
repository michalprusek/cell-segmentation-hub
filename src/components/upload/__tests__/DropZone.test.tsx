import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '@/test/utils/test-utils';
import DropZone from '@/components/upload/DropZone';

// Sonner is used for toast notifications
vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

// cropImageToCircle and uploadConfig are real modules — no mock needed;
// file-size limits are tested via the actual constants.

import { toast } from 'sonner';
import UPLOAD_CONFIG from '@/lib/uploadConfig';

describe('DropZone', () => {
  const onDrop = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Rendering ────────────────────────────────────────────────────────────

  describe('Rendering — enabled state', () => {
    it('renders the drag-and-drop text', () => {
      render(<DropZone disabled={false} onDrop={onDrop} />);
      // i18n key: images.dragDrop → "Drag & drop images or videos here"
      expect(
        screen.getByText(/drag & drop images or videos here/i)
      ).toBeInTheDocument();
    });

    it('renders the click-to-select sub-text', () => {
      render(<DropZone disabled={false} onDrop={onDrop} />);
      expect(screen.getByText(/or click to select files/i)).toBeInTheDocument();
    });

    it('renders accepted-formats hint', () => {
      render(<DropZone disabled={false} onDrop={onDrop} />);
      // i18n key: images.acceptedFormats (contains "jpg", "png", "tiff"…)
      expect(
        screen.getByText(/jpg|jpeg|png|tiff|mp4|nd2/i)
      ).toBeInTheDocument();
    });

    it('contains a file input', () => {
      render(<DropZone disabled={false} onDrop={onDrop} />);
      expect(document.querySelector('input[type="file"]')).toBeInTheDocument();
    });
  });

  describe('Rendering — disabled state', () => {
    it('shows "Select a project first" when disabled', () => {
      render(<DropZone disabled={true} onDrop={onDrop} />);
      // i18n key: images.uploadingTo → "Select a project first"
      expect(screen.getByText(/select a project first/i)).toBeInTheDocument();
    });

    it('applies opacity class when disabled', () => {
      const { container } = render(
        <DropZone disabled={true} onDrop={onDrop} />
      );
      const root = container.firstChild as HTMLElement;
      expect(root.className).toMatch(/opacity-70/);
    });

    it('the file input has disabled attribute when disabled', () => {
      render(<DropZone disabled={true} onDrop={onDrop} />);
      const input = document.querySelector(
        'input[type="file"]'
      ) as HTMLInputElement;
      expect(input).toBeDisabled();
    });
  });

  // ── onDrop callback behaviour ─────────────────────────────────────────

  describe('handleDrop — valid files', () => {
    it('calls onDrop with accepted files under the size limit', async () => {
      render(<DropZone disabled={false} onDrop={onDrop} />);

      const file = new File(['hello'], 'image.png', { type: 'image/png' });

      await act(async () => {
        // Invoke the internal handleDrop by going via the dropzone's onDrop
        // We get the input and fire a change event because react-dropzone
        // wires up to both drag events and click-to-select.
        const input = document.querySelector(
          'input[type="file"]'
        ) as HTMLInputElement;
        // Use userEvent file upload on the hidden input
        await userEvent.upload(input, file);
      });

      expect(onDrop).toHaveBeenCalledWith([file]);
    });

    it('does NOT call onDrop with files that exceed the image size limit', async () => {
      render(<DropZone disabled={false} onDrop={onDrop} />);

      // Create an oversized image file (> 20 MB)
      const oversizedFile = new File(['x'], 'big.png', { type: 'image/png' });
      Object.defineProperty(oversizedFile, 'size', {
        value: UPLOAD_CONFIG.MAX_FILE_SIZE_BYTES + 1,
        configurable: true,
      });

      const input = document.querySelector(
        'input[type="file"]'
      ) as HTMLInputElement;
      await act(async () => {
        await userEvent.upload(input, oversizedFile);
      });

      // onDrop should NOT receive the oversized file
      expect(onDrop).not.toHaveBeenCalledWith([oversizedFile]);
    });

    it('shows an error toast for oversized files', async () => {
      render(<DropZone disabled={false} onDrop={onDrop} />);

      const oversizedFile = new File(['x'], 'big.png', { type: 'image/png' });
      Object.defineProperty(oversizedFile, 'size', {
        value: UPLOAD_CONFIG.MAX_FILE_SIZE_BYTES + 1,
        configurable: true,
      });

      const input = document.querySelector(
        'input[type="file"]'
      ) as HTMLInputElement;
      await act(async () => {
        await userEvent.upload(input, oversizedFile);
      });

      expect(toast.error).toHaveBeenCalled();
    });
  });

  describe('handleDrop — 10 000-file limit', () => {
    it('shows an error toast and caps onDrop at 10 000 files', async () => {
      render(<DropZone disabled={false} onDrop={onDrop} />);

      // Build 10 001 tiny valid files
      const files = Array.from({ length: 10001 }, (_, i) =>
        Object.assign(new File(['x'], `img${i}.png`, { type: 'image/png' }), {
          // keep each file well under the size limit
        })
      );

      const input = document.querySelector(
        'input[type="file"]'
      ) as HTMLInputElement;
      await act(async () => {
        await userEvent.upload(input, files);
      });

      expect(toast.error).toHaveBeenCalled();
      // onDrop receives at most 10 000 files
      if (onDrop.mock.calls.length > 0) {
        const receivedFiles: File[] = onDrop.mock.calls[0][0];
        expect(receivedFiles.length).toBeLessThanOrEqual(10000);
      }
    });
  });
});
