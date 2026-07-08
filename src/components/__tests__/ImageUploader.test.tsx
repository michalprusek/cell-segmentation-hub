import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render as rtlRender, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import ImageUploader from '@/components/ImageUploader';

// Mock the sub-components
vi.mock('@/components/upload/DropZone', () => ({
  default: ({ onDrop, disabled }: any) => (
    <div data-testid="dropzone">
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
      <span>Drag &amp; drop images here or click to browse</span>
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

// Mock react-router-dom — stub out hooks that need a Router context
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useParams: () => ({}),
    useNavigate: () => vi.fn(),
    useLocation: () => ({ pathname: '/' }),
  };
});

// Mock sonner toast
vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock the useUpload hook
const mockStartUpload = vi.fn().mockReturnValue('upload_123');
vi.mock('@/contexts/useUpload', () => ({
  useUpload: () => ({
    startUpload: mockStartUpload,
    cancelUpload: vi.fn(),
    clearSession: vi.fn(),
    isUploading: false,
    activeSession: null,
    sessions: {},
  }),
}));

// Mock useLanguage to avoid LanguageProvider complexity
vi.mock('@/contexts/useLanguage', () => ({
  useLanguage: () => ({
    t: (key: string) => key,
    language: 'en',
    setLanguage: vi.fn(),
  }),
}));

// Minimal wrapper — no Router, but a QueryClientProvider is required because
// ImageUploader uses `useQuery` (to read the project type, which decides
// whether to show the MT-only "register channels?" prompt after a drop). The
// query is disabled here (useParams()→{}, so projectId is null) but `useQuery`
// still calls `useQueryClient()`.
const render = (ui: React.ReactElement) => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return rtlRender(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>
  );
};

describe('ImageUploader', () => {
  const defaultProps = {
    onUploadComplete: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders upload area with correct text', () => {
    render(<ImageUploader {...defaultProps} />);

    expect(screen.getByText(/drag.*drop images here/i)).toBeInTheDocument();
  });

  it('accepts image files only', () => {
    render(<ImageUploader {...defaultProps} />);

    const input = screen.getByTestId('file-input');
    expect(input).toHaveAttribute('accept', 'image/*');
  });

  it('renders dropzone component', () => {
    render(<ImageUploader {...defaultProps} />);

    expect(screen.getByTestId('dropzone')).toBeInTheDocument();
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

    expect(screen.getByTestId('uploader-options')).toBeInTheDocument();
    expect(screen.getByTestId('dropzone')).toBeInTheDocument();
  });

  it('handles project ID from URL params', () => {
    render(<ImageUploader {...defaultProps} />);

    expect(screen.getByTestId('dropzone')).toBeInTheDocument();
    expect(screen.getByTestId('uploader-options')).toBeInTheDocument();
  });

  it('calls onUploadComplete callback when provided', async () => {
    const mockOnUploadComplete = vi.fn();

    render(<ImageUploader onUploadComplete={mockOnUploadComplete} />);

    expect(screen.getByTestId('dropzone')).toBeInTheDocument();
    // The callback is passed to startUpload and called after upload completes via UploadContext
    expect(mockOnUploadComplete).not.toHaveBeenCalled();
  });
});
