import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  render as rtlRender,
  screen,
  waitFor,
  act,
  fireEvent,
} from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import ImageUploader from '@/components/ImageUploader';

// --- Mocks -------------------------------------------------------------

// DropZone: capture the parent's onDrop so the drop-flow tests can invoke it,
// and render an <input> so rendering tests have a queryable element.
let capturedOnDrop: ((files: File[]) => void) | null = null;
vi.mock('@/components/upload/DropZone', () => ({
  default: ({
    onDrop,
    disabled,
  }: {
    onDrop: (files: File[]) => void;
    disabled?: boolean;
  }) => {
    capturedOnDrop = onDrop;
    return (
      <div data-testid="dropzone">
        <input
          data-testid="file-input"
          type="file"
          accept="image/*"
          multiple
          disabled={disabled}
          onChange={e => {
            if (e.target.files) onDrop(Array.from(e.target.files));
          }}
        />
        <span>Drag &amp; drop images here or click to browse</span>
      </div>
    );
  },
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

// useParams is mutable so one file can exercise both the "no project in URL"
// (rendering) and "project in URL" (drop flow) branches.
let mockParams: Record<string, string> = {};
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useParams: () => mockParams,
    useNavigate: () => vi.fn(),
    useLocation: () => ({ pathname: '/' }),
  };
});

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const mockStartUpload = vi.fn().mockReturnValue('up_1');
vi.mock('@/contexts/useUpload', () => ({
  useUpload: () => ({
    startUpload: mockStartUpload,
    isUploading: false,
    cancelUpload: vi.fn(),
    clearSession: vi.fn(),
    activeSession: null,
    sessions: {},
  }),
}));

// t(key) → key, so dialog text is the raw i18n key we can query on.
vi.mock('@/contexts/useLanguage', () => ({
  useLanguage: () => ({
    t: (k: string) => k,
    language: 'en',
    setLanguage: vi.fn(),
  }),
}));

// Project type drives the MT-only register-channels prompt.
let mockProjectType = 'microtubules';
const mockGetProject = vi.fn(() =>
  Promise.resolve({ id: 'p1', type: mockProjectType })
);
vi.mock('@/lib/api', () => ({
  apiClient: { getProject: (...a: unknown[]) => mockGetProject(...a) },
}));
vi.mock('@/lib/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

// --- Shared fixtures / helpers ----------------------------------------

const PROMPT = 'images.registerChannels.promptTitle';
const files = [new File([new Blob(['x'])], 'v.mp4', { type: 'video/mp4' })];
const onUploadComplete = vi.fn();

// QueryClientProvider is required because ImageUploader uses `useQuery` (to read
// the project type). The query is only enabled once a projectId is known.
function renderUploader() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return rtlRender(
    <QueryClientProvider client={qc}>
      <ImageUploader onUploadComplete={onUploadComplete} />
    </QueryClientProvider>
  );
}

// Render, then flush the project-type query so `isMicrotubuleProject` is
// resolved before we trigger the drop (onDrop closes over it).
async function renderAndSettle() {
  renderUploader();
  await waitFor(() => expect(mockGetProject).toHaveBeenCalledWith('p1'));
  await act(async () => {
    await Promise.resolve();
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  capturedOnDrop = null;
  mockParams = {};
  mockProjectType = 'microtubules';
});

describe('ImageUploader — rendering', () => {
  it('renders the dropzone, uploader options and layout wrapper', () => {
    renderUploader();
    expect(screen.getByTestId('dropzone')).toBeInTheDocument();
    expect(screen.getByTestId('uploader-options')).toBeInTheDocument();
    expect(screen.getByText(/drag.*drop images here/i)).toBeInTheDocument();
    // `space-y-6` is the real component's layout wrapper.
    expect(screen.getByTestId('dropzone').parentElement).toHaveClass(
      'space-y-6'
    );
  });

  it('shows the project selector when no project is set in the URL', () => {
    renderUploader();
    expect(screen.getByTestId('project-selector')).toBeInTheDocument();
  });

  it('hides the project selector when a project id is in the URL', async () => {
    mockParams = { id: 'p1' };
    renderUploader();
    // showProjectSelector={!currentProjectId} → false when the URL has an id.
    expect(screen.queryByTestId('project-selector')).not.toBeInTheDocument();
    // Settle the project-type query kicked off by the URL id.
    await waitFor(() => expect(mockGetProject).toHaveBeenCalledWith('p1'));
    await act(async () => {
      await Promise.resolve();
    });
  });
});

describe('ImageUploader — register-channels prompt', () => {
  beforeEach(() => {
    mockParams = { id: 'p1' };
    mockProjectType = 'microtubules';
  });

  it('drops into an MT project → shows the prompt, no checkbox, no upload yet', async () => {
    await renderAndSettle();
    // No persistent checkbox in the uploader anymore.
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
    act(() => capturedOnDrop!(files));
    expect(await screen.findByText(PROMPT)).toBeInTheDocument();
    // Not uploaded yet — waiting for the answer.
    expect(mockStartUpload).not.toHaveBeenCalled();
  });

  it('confirm → startUpload WITH registration', async () => {
    await renderAndSettle();
    act(() => capturedOnDrop!(files));
    await screen.findByText(PROMPT);
    fireEvent.click(screen.getByText('images.registerChannels.confirm'));
    expect(mockStartUpload).toHaveBeenCalledWith(
      'p1',
      files,
      undefined,
      onUploadComplete,
      true
    );
  });

  it('decline → startUpload WITHOUT registration', async () => {
    await renderAndSettle();
    act(() => capturedOnDrop!(files));
    await screen.findByText(PROMPT);
    fireEvent.click(screen.getByText('images.registerChannels.decline'));
    expect(mockStartUpload).toHaveBeenCalledWith(
      'p1',
      files,
      undefined,
      onUploadComplete,
      false
    );
  });

  it('cancel → nothing is uploaded', async () => {
    await renderAndSettle();
    act(() => capturedOnDrop!(files));
    await screen.findByText(PROMPT);
    fireEvent.click(screen.getByText('common.cancel'));
    expect(mockStartUpload).not.toHaveBeenCalled();
  });

  it('non-MT project → uploads directly, no prompt', async () => {
    mockProjectType = 'spheroid';
    await renderAndSettle();
    act(() => capturedOnDrop!(files));
    expect(screen.queryByText(PROMPT)).not.toBeInTheDocument();
    expect(mockStartUpload).toHaveBeenCalledWith(
      'p1',
      files,
      undefined,
      onUploadComplete,
      false
    );
  });
});
