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

// Capture the onDrop the parent hands to DropZone so tests can trigger a drop.
let capturedOnDrop: ((files: File[]) => void) | null = null;
vi.mock('@/components/upload/DropZone', () => ({
  default: ({ onDrop }: { onDrop: (files: File[]) => void }) => {
    capturedOnDrop = onDrop;
    return <div data-testid="dropzone" />;
  },
}));
vi.mock('@/components/upload/UploaderOptions', () => ({
  default: () => <div data-testid="uploader-options" />,
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return { ...actual, useParams: () => ({ id: 'p1' }) };
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

const PROMPT = 'images.registerChannels.promptTitle';
const files = [new File([new Blob(['x'])], 'v.mp4', { type: 'video/mp4' })];
const onUploadComplete = vi.fn();

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

describe('ImageUploader — register-channels prompt', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedOnDrop = null;
    mockProjectType = 'microtubules';
  });

  it('drops into an MT project → shows the prompt, no persistent checkbox', async () => {
    await renderAndSettle();
    // No checkbox in the uploader anymore.
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
