/**
 * Behavioral unit tests for AvatarUploadButton.
 *
 * Tested behaviours:
 *  1.  Button renders with the correct aria-label.
 *  2.  Button is enabled by default (disabled=false).
 *  3.  Button is disabled when disabled=true prop is passed.
 *  4.  Camera icon is rendered inside the button.
 *  5.  Clicking the button triggers the hidden file input (click forwarding).
 *  6.  Selecting a valid JPEG file calls onFileSelect with the File object.
 *  7.  Selecting a valid PNG file calls onFileSelect.
 *  8.  Selecting an invalid file type (text/plain) calls toast with error
 *      and does NOT call onFileSelect.
 *  9.  Selecting a file > 5 MB calls toast with size error and does NOT call
 *      onFileSelect.
 *  10. After a successful selection the file input value is reset (allows
 *      re-selecting the same file).
 *
 * Skipped:
 *  - Actual file-dialog opening is a browser event that JSDOM cannot trigger;
 *    we verify the ref.click() delegation is wired instead.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '@/test/utils/test-utils';
import AvatarUploadButton from '../AvatarUploadButton';

// AvatarUploadButton uses the shadcn `toast` from @/hooks/use-toast (not sonner)
const mockToast = vi.fn();
vi.mock('@/hooks/use-toast', () => ({
  toast: (...args: unknown[]) => mockToast(...args),
  useToast: () => ({ toast: mockToast }),
}));

// ── helpers ──────────────────────────────────────────────────────────────────

function makeFile(name: string, type: string, sizeBytes: number = 1024): File {
  const file = new File(['x'.repeat(Math.min(sizeBytes, 10))], name, { type });
  // Override size to simulate large files without allocating real memory
  Object.defineProperty(file, 'size', { value: sizeBytes });
  return file;
}

function setup(
  overrides: Partial<{
    onFileSelect: (f: File) => void;
    disabled: boolean;
    className: string;
  }> = {}
) {
  const props = {
    onFileSelect: vi.fn(),
    disabled: false,
    className: '',
    ...overrides,
  };
  const result = render(<AvatarUploadButton {...props} />);
  // The hidden input is the only one with type=file
  const input = result.container.querySelector(
    'input[type="file"]'
  ) as HTMLInputElement;
  return { ...result, props, input };
}

function fireFileChange(input: HTMLInputElement, file: File) {
  Object.defineProperty(input, 'files', {
    value: { 0: file, length: 1, item: () => file },
    configurable: true,
  });
  fireEvent.change(input);
}

// ── tests ────────────────────────────────────────────────────────────────────

describe('AvatarUploadButton', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // 1
  it('renders button with aria-label "Upload Avatar"', () => {
    setup();
    expect(
      screen.getByRole('button', { name: 'Upload Avatar' })
    ).toBeInTheDocument();
  });

  // 2
  it('button is enabled by default', () => {
    setup();
    expect(
      screen.getByRole('button', { name: 'Upload Avatar' })
    ).not.toBeDisabled();
  });

  // 3
  it('button is disabled when disabled=true', () => {
    setup({ disabled: true });
    expect(
      screen.getByRole('button', { name: 'Upload Avatar' })
    ).toBeDisabled();
  });

  // 4
  it('renders a Camera svg icon inside the button', () => {
    setup();
    const btn = screen.getByRole('button', { name: 'Upload Avatar' });
    expect(btn.querySelector('svg')).toBeInTheDocument();
  });

  // 5
  it('clicking the button triggers a click on the hidden file input', async () => {
    const { input } = setup();
    const inputClick = vi.spyOn(input, 'click');
    await userEvent.click(
      screen.getByRole('button', { name: 'Upload Avatar' })
    );
    expect(inputClick).toHaveBeenCalledTimes(1);
  });

  // 6
  it('calls onFileSelect with File when a valid JPEG is chosen', () => {
    const onFileSelect = vi.fn();
    const { input } = setup({ onFileSelect });
    const file = makeFile('photo.jpg', 'image/jpeg');
    fireFileChange(input, file);
    expect(onFileSelect).toHaveBeenCalledWith(file);
    expect(mockToast).not.toHaveBeenCalled();
  });

  // 7
  it('calls onFileSelect with File when a valid PNG is chosen', () => {
    const onFileSelect = vi.fn();
    const { input } = setup({ onFileSelect });
    const file = makeFile('image.png', 'image/png');
    fireFileChange(input, file);
    expect(onFileSelect).toHaveBeenCalledWith(file);
  });

  // 8
  it('shows error toast and does not call onFileSelect for invalid file type', () => {
    const onFileSelect = vi.fn();
    const { input } = setup({ onFileSelect });
    const file = makeFile('doc.txt', 'text/plain');
    fireFileChange(input, file);
    expect(onFileSelect).not.toHaveBeenCalled();
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({ variant: 'destructive' })
    );
  });

  // 9
  it('shows error toast and does not call onFileSelect for file > 5 MB', () => {
    const onFileSelect = vi.fn();
    const { input } = setup({ onFileSelect });
    const oversized = makeFile('huge.jpg', 'image/jpeg', 6 * 1024 * 1024);
    fireFileChange(input, oversized);
    expect(onFileSelect).not.toHaveBeenCalled();
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({ variant: 'destructive' })
    );
  });

  // 10
  it('resets the input value after a successful selection to allow re-selecting', () => {
    const { input } = setup();
    const file = makeFile('a.jpg', 'image/jpeg');
    // Simulate selection
    fireFileChange(input, file);
    // The handler sets event.target.value = '' — in JSDOM the value property
    // is writable; after the change handler the input.value should be empty.
    expect(input.value).toBe('');
  });
});
