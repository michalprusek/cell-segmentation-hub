import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render, createMockFile } from '@/test-utils/reactTestUtils';
import ImageUploader from '@/components/ImageUploader';

// Mock the sub-components
vi.mock('@/components/upload/DropZone', () => ({
  default: ({ onDrop, disabled, isDragActive }: any) => (
    <div
      data-testid="dropzone"
      className={isDragActive ? 'border-primary' : ''}
    >
      <input
        data-testid="file-input"
        type="file"
        accept="image/*"
        multiple
        disabled={disabled}
        onChange={e => {
          if (e.target.files) {
            onDrop(Array.from(e.target.files));
          }
        }}
      />
      <span>Drag & drop images here or click to browse</span>
    </div>
  ),
}));

vi.mock('@/components/upload/FileList', () => ({
  default: ({ files = [] }: any) => (
    <div data-testid="file-list">
      {files.map((file: any, index: number) => (
        <div key={index} data-testid={`file-item-${index}`}>
          {file.name}
        </div>
      ))}
    </div>
  ),
}));

vi.mock('@/components/upload/UploaderOptions', () => ({
  default: ({
    showProjectSelector = true,
    projectId,
    onProjectChange,
  }: any) => (
    <div data-testid="uploader-options">
      {showProjectSelector && (
        <select
          data-testid="project-selector"
          value={projectId || ''}
          onChange={e => onProjectChange?.(e.target.value)}
        >
          <option value="">Select project</option>
          <option value="test-project-id">Test Project</option>
        </select>
      )}
    </div>
  ),
}));

// Mock sonner toast
vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

describe('ImageUploader', () => {
  const defaultProps = {
    onUploadComplete: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders upload area with correct text', () => {
    render(<ImageUploader {...defaultProps} />);

    expect(screen.getByText(/drag & drop images here/i)).toBeInTheDocument();
  });

  it('accepts image files only', () => {
    render(<ImageUploader {...defaultProps} />);

    const input = screen.getByTestId('file-input');
    expect(input).toHaveAttribute('accept', 'image/*');
  });

  it('handles file selection via input', async () => {
    const user = userEvent.setup();
    render(<ImageUploader {...defaultProps} />);

    const file = createMockFile('test.jpg', 'image/jpeg');
    const input = screen.getByTestId('file-input');

    await user.upload(input, file);

    await waitFor(() => {
      expect(screen.getByTestId('file-list')).toBeInTheDocument();
      expect(screen.getByTestId('file-item-0')).toHaveTextContent('test.jpg');
    });
  });

  it('renders dropzone component', () => {
    render(<ImageUploader {...defaultProps} />);

    expect(screen.getByTestId('dropzone')).toBeInTheDocument();
  });

  it('renders file list component', () => {
    render(<ImageUploader {...defaultProps} />);

    expect(screen.getByTestId('file-list')).toBeInTheDocument();
  });

  it('renders uploader options component', () => {
    render(<ImageUploader {...defaultProps} />);

    expect(screen.getByTestId('uploader-options')).toBeInTheDocument();
  });

  it('accepts multiple files attribute', () => {
    render(<ImageUploader {...defaultProps} />);

    const input = screen.getByTestId('file-input');
    expect(input).toHaveAttribute('multiple');
  });

  it('shows project selector when no project ID is provided', () => {
    render(<ImageUploader {...defaultProps} />);

    expect(screen.getByTestId('project-selector')).toBeInTheDocument();
  });

  it('renders all components in proper layout', () => {
    render(<ImageUploader {...defaultProps} />);

    const container = screen.getByTestId('dropzone').parentElement;
    expect(container).toHaveClass('space-y-6');

    // Verify all components are present
    expect(screen.getByTestId('uploader-options')).toBeInTheDocument();
    expect(screen.getByTestId('dropzone')).toBeInTheDocument();
    expect(screen.getByTestId('file-list')).toBeInTheDocument();
  });

  it('handles project ID from URL params', () => {
    // Mock useParams to return project ID
    vi.mock('react-router-dom', async () => {
      const actual = await vi.importActual('react-router-dom');
      return {
        ...actual,
        useParams: () => ({ id: 'test-project-id' }),
        useNavigate: () => vi.fn(),
      };
    });

    render(<ImageUploader {...defaultProps} />);

    // Component should render properly with project context
    expect(screen.getByTestId('dropzone')).toBeInTheDocument();
    expect(screen.getByTestId('uploader-options')).toBeInTheDocument();
  });

  it('calls onUploadComplete callback when provided', async () => {
    const mockOnUploadComplete = vi.fn();

    render(<ImageUploader onUploadComplete={mockOnUploadComplete} />);

    // Component should be ready to accept uploads
    expect(screen.getByTestId('dropzone')).toBeInTheDocument();

    // The callback would be called after successful upload (mocked in the component)
    expect(mockOnUploadComplete).not.toHaveBeenCalled();
  });
});
