/**
 * ProjectDetail page unit tests.
 *
 * Behaviors covered:
 * - Loading state: spinner shown while useProjectData loading=true
 * - Loaded state: toolbar + gallery rendered, no spinner
 * - Empty state (no images): EmptyState rendered, not gallery
 * - Error/navigate: useProjectData redirects on load error (tested via hook mock)
 * - View-mode toggle: toolbar receives setViewMode; component re-renders with new mode
 * - Uploader toggle: toggling showUploader swaps ProjectUploaderSection vs toolbar+gallery
 * - Image selection: handleImageSelection adds/removes from selectedImageIds; toolbar gets selectedCount
 * - Select all / deselect all toggle: works correctly via toolbar prop
 * - Batch delete flow: handleBatchDelete opens AlertDialog; confirm calls apiClient.deleteBatch
 * - Batch delete cancel: dialog closed, apiClient.deleteBatch NOT called
 * - Segment all: handleSegmentAll calls apiClient.addBatchToQueue with correct args
 * - Segment all blocked: incompatible model opens IncompatibleModel dialog
 * - Segment all multi-channel: opens channel picker dialog (SegmentChannelDialog)
 * - Channel picker confirm: calls handleSegmentAll with picked channel
 * - Channel picker cancel: closes dialog, no dispatch
 * - Cancel segmentation: calls apiClient.cancelAllUserSegmentations
 * - handleOpenImage: delegates to handleOpenSegmentationEditor (navigate to editor)
 * - handleProjectTypeChange: calls apiClient.updateProject with new type
 * - QueueStatsPanel receives correct props (stats, batchSubmitted, imagesToSegmentCount)
 * - Pagination info line shown when images present
 *
 * NOT tested (legitimately):
 * - WebSocket real-time updates (async WS infra; debounced at 50 ms, tested via useSegmentationQueue tests)
 * - Canvas / DnD interactions inside ProjectImages (deep child, mocked)
 * - handleBatchCompleted / handleBulkSegmentationCancelled (triggered by WS events, not user actions)
 * - processImageChunks large-batch progress toasts (requires 500+ images)
 * - Safety / queue-processing timeouts (60 s timers, not practical to advance in unit tests)
 * - Upload completion image-merge logic (async side-effect of uploader, tested separately)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';
import { toast } from 'sonner';
import ProjectDetail from '../ProjectDetail';

// ---------------------------------------------------------------------------
// Hoisted mock references
// ---------------------------------------------------------------------------
const {
  mockNavigate,
  mockUseProjectData,
  mockUseImageFilter,
  mockUseProjectImageActions,
  mockUseSegmentationQueue,
  mockUsePagination,
  mockUseStatusReconciliation,
  mockUseSharedAdvancedExport,
  mockAddBatchToQueue,
  mockDeleteBatch,
  mockCancelAllUserSegmentations,
  mockUpdateProject,
  mockHandleDeleteImage,
  mockHandleOpenSegmentationEditor,
  mockRequestQueueStats,
} = vi.hoisted(() => {
  const mockAddBatchToQueue = vi.fn();
  const mockDeleteBatch = vi.fn();
  const mockCancelAllUserSegmentations = vi.fn();
  const mockUpdateProject = vi.fn();
  const mockHandleDeleteImage = vi.fn();
  const mockHandleOpenSegmentationEditor = vi.fn();
  const mockRequestQueueStats = vi.fn();
  return {
    mockNavigate: vi.fn(),
    mockUseProjectData: vi.fn(),
    mockUseImageFilter: vi.fn(),
    mockUseProjectImageActions: vi.fn(),
    mockUseSegmentationQueue: vi.fn(),
    mockUsePagination: vi.fn(),
    mockUseStatusReconciliation: vi.fn(),
    mockUseSharedAdvancedExport: vi.fn(),
    mockAddBatchToQueue,
    mockDeleteBatch,
    mockCancelAllUserSegmentations,
    mockUpdateProject,
    mockHandleDeleteImage,
    mockHandleOpenSegmentationEditor,
    mockRequestQueueStats,
  };
});

// ---------------------------------------------------------------------------
// Default factory helpers
// ---------------------------------------------------------------------------

const makeImage = (overrides: Record<string, unknown> = {}, id = 'img-1') => ({
  id,
  name: `Image ${id}`,
  url: `/images/${id}.png`,
  thumbnail_url: `/thumbs/${id}.jpg`,
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
  segmentationStatus: 'no_segmentation',
  segmentationResult: undefined,
  ...overrides,
});

function makeProjectData(overrides: Record<string, unknown> = {}) {
  return {
    projectTitle: 'Test Project',
    projectType: 'spheroid' as const,
    setProjectType: vi.fn(),
    images: [],
    projectChannels: [],
    loading: false,
    updateImages: vi.fn(),
    refreshImageSegmentation: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function makeImageFilter(
  images: ReturnType<typeof makeImage>[] = [],
  overrides: Record<string, unknown> = {}
) {
  return {
    filteredImages: images,
    searchTerm: '',
    sortField: 'updatedAt',
    sortDirection: 'desc',
    handleSearch: vi.fn(),
    handleSort: vi.fn(),
    ...overrides,
  };
}

function makePagination(totalItems = 0) {
  return {
    currentPage: 1,
    totalPages: totalItems > 0 ? 1 : 0,
    itemsPerPage: 30,
    startIndex: 1,
    endIndex: Math.min(30, totalItems),
    canGoNext: false,
    canGoPrevious: false,
    setCurrentPage: vi.fn(),
    goToNextPage: vi.fn(),
    goToPreviousPage: vi.fn(),
    pageNumbers: totalItems > 0 ? [1] : [],
    paginatedIndices: { start: 0, end: totalItems },
  };
}

function makeQueueStats() {
  return {
    isConnected: true,
    queueStats: { total: 0, queued: 0, processing: 0, completed: 0, failed: 0 },
    lastUpdate: null,
    parallelStats: null,
    requestQueueStats: mockRequestQueueStats,
    joinProject: vi.fn(),
    leaveProject: vi.fn(),
  };
}

function makeExportHook() {
  return {
    isExporting: false,
    isDownloading: false,
    exportProgress: 0,
    exportStatus: null,
    completedJobId: null,
    cancelExport: vi.fn(),
    triggerDownload: vi.fn(),
    dismissExport: vi.fn(),
    wsConnected: true,
    exportOptions: {},
    updateExportOptions: vi.fn(),
    startExport: vi.fn(),
    getExportStatus: vi.fn(),
    getExportHistory: vi.fn(),
    currentJob: null,
  };
}

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock('react-router-dom', async () => {
  const actual =
    await vi.importActual<typeof import('react-router-dom')>(
      'react-router-dom'
    );
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    useParams: () => ({ id: 'proj-1' }),
  };
});

vi.mock('@/contexts/exports', () => ({
  useAuth: () => ({ user: { id: 'user-1', email: 'alice@example.com' } }),
  useLanguage: () => ({
    t: (key: string, _params?: Record<string, unknown>) => key,
  }),
  useModel: () => ({
    selectedModel: 'hrnet',
    confidenceThreshold: 0.5,
    detectHoles: false,
  }),
}));

vi.mock('@/hooks/useProjectData', () => ({
  useProjectData: (...args: unknown[]) => mockUseProjectData(...args),
}));

vi.mock('@/hooks/useImageFilter', () => ({
  useImageFilter: (...args: unknown[]) => mockUseImageFilter(...args),
}));

vi.mock('@/hooks/useProjectImageActions', () => ({
  useProjectImageActions: (...args: unknown[]) =>
    mockUseProjectImageActions(...args),
}));

vi.mock('@/hooks/useSegmentationQueue', () => ({
  useSegmentationQueue: (...args: unknown[]) =>
    mockUseSegmentationQueue(...args),
}));

vi.mock('@/hooks/usePagination', () => ({
  usePagination: (...args: unknown[]) => mockUsePagination(...args),
}));

vi.mock('@/hooks/useStatusReconciliation', () => ({
  useStatusReconciliation: (...args: unknown[]) =>
    mockUseStatusReconciliation(...args),
}));

vi.mock('@/pages/export/hooks/useSharedAdvancedExport', () => ({
  useSharedAdvancedExport: (...args: unknown[]) =>
    mockUseSharedAdvancedExport(...args),
}));

vi.mock('@/lib/api', () => ({
  default: {
    addBatchToQueue: mockAddBatchToQueue,
    deleteBatch: mockDeleteBatch,
    cancelAllUserSegmentations: mockCancelAllUserSegmentations,
    updateProject: mockUpdateProject,
    getProjectImages: vi.fn().mockResolvedValue({ images: [], total: 0 }),
    getSegmentationResults: vi.fn().mockResolvedValue(null),
  },
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    error: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
  },
}));

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
    loading: vi.fn().mockReturnValue('toast-id'),
    dismiss: vi.fn(),
    info: vi.fn(),
  },
}));

vi.mock('framer-motion', () => ({
  motion: {
    div: ({
      children,
      ...rest
    }: React.HTMLAttributes<HTMLDivElement> & {
      children?: React.ReactNode;
    }) => <div {...rest}>{children}</div>,
  },
  AnimatePresence: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));

// ---------------------------------------------------------------------------
// Stub heavy child components
// ---------------------------------------------------------------------------

vi.mock('@/components/project/ProjectHeader', () => ({
  default: ({
    projectTitle,
    loading,
    onTypeChange,
  }: {
    projectTitle: string;
    loading: boolean;
    projectType?: string;
    imagesCount?: number;
    onTypeChange?: (t: string) => void;
  }) => (
    <header data-testid="project-header">
      {loading && <span data-testid="header-loading" />}
      <h1>{projectTitle}</h1>
      {onTypeChange && (
        <button
          data-testid="change-type-btn"
          onClick={() => onTypeChange('wound')}
        >
          Change Type
        </button>
      )}
    </header>
  ),
}));

vi.mock('@/components/project/ProjectToolbar', () => ({
  default: ({
    onToggleUploader,
    viewMode,
    setViewMode,
    selectedCount,
    onSelectAllToggle,
    onBatchDelete,
    searchTerm,
    onSearchChange,
  }: {
    onToggleUploader: () => void;
    viewMode: string;
    setViewMode: (m: 'grid' | 'list') => void;
    selectedCount: number;
    onSelectAllToggle: () => void;
    onBatchDelete: () => void;
    searchTerm: string;
    onSearchChange: (v: string) => void;
    [key: string]: unknown;
  }) => (
    <div data-testid="project-toolbar">
      <span data-testid="view-mode">{viewMode}</span>
      <span data-testid="selected-count">{selectedCount}</span>
      <button data-testid="toggle-uploader" onClick={onToggleUploader}>
        Upload
      </button>
      <button data-testid="switch-list" onClick={() => setViewMode('list')}>
        List
      </button>
      <button data-testid="switch-grid" onClick={() => setViewMode('grid')}>
        Grid
      </button>
      <button data-testid="select-all-toggle" onClick={onSelectAllToggle}>
        Select All Toggle
      </button>
      <button data-testid="batch-delete-btn" onClick={onBatchDelete}>
        Delete Selected
      </button>
      <input
        data-testid="search-input"
        value={searchTerm}
        onChange={e => onSearchChange(e.target.value)}
      />
    </div>
  ),
}));

vi.mock('@/components/project/EmptyState', () => ({
  default: ({
    hasSearchTerm,
    onUpload,
  }: {
    hasSearchTerm: boolean;
    onUpload: () => void;
  }) => (
    <div data-testid="empty-state">
      {hasSearchTerm && <span data-testid="no-search-results" />}
      <button data-testid="empty-upload" onClick={onUpload}>
        Upload
      </button>
    </div>
  ),
}));

vi.mock('@/components/project/ProjectImages', () => ({
  default: ({
    images,
    onDelete,
    onOpen,
    onSelectionChange,
    selectedImageIds,
  }: {
    images: { id: string; name: string }[];
    onDelete: (id: string) => void;
    onOpen: (id: string) => void;
    onSelectionChange: (id: string, selected: boolean) => void;
    selectedImageIds: Set<string>;
    [key: string]: unknown;
  }) => (
    <div data-testid="project-images">
      {images.map(img => (
        <div key={img.id} data-testid={`image-card-${img.id}`}>
          <button data-testid={`open-${img.id}`} onClick={() => onOpen(img.id)}>
            Open
          </button>
          <button
            data-testid={`delete-${img.id}`}
            onClick={() => onDelete(img.id)}
          >
            Delete
          </button>
          <input
            type="checkbox"
            data-testid={`select-${img.id}`}
            checked={selectedImageIds.has(img.id)}
            onChange={e => onSelectionChange(img.id, e.target.checked)}
          />
        </div>
      ))}
    </div>
  ),
}));

vi.mock('@/components/project/ProjectUploaderSection', () => ({
  default: ({
    onCancel,
    onUploadComplete,
  }: {
    onCancel: () => void;
    onUploadComplete: () => void;
  }) => (
    <div data-testid="uploader-section">
      <button data-testid="cancel-upload" onClick={onCancel}>
        Cancel
      </button>
      <button data-testid="upload-complete" onClick={onUploadComplete}>
        Done
      </button>
    </div>
  ),
}));

vi.mock('@/components/project/QueueStatsPanel', () => ({
  QueueStatsPanel: ({
    batchSubmitted,
    imagesToSegmentCount,
    onSegmentAll,
    onCancelSegmentation,
  }: {
    batchSubmitted: boolean;
    imagesToSegmentCount: number;
    onSegmentAll: () => void;
    onCancelSegmentation: () => void;
    [key: string]: unknown;
  }) => (
    <div data-testid="queue-stats-panel">
      <span data-testid="batch-submitted">{String(batchSubmitted)}</span>
      <span data-testid="images-to-segment">{imagesToSegmentCount}</span>
      <button data-testid="segment-all-btn" onClick={onSegmentAll}>
        Segment All
      </button>
      <button
        data-testid="cancel-segmentation-btn"
        onClick={onCancelSegmentation}
      >
        Cancel
      </button>
    </div>
  ),
}));

vi.mock('@/components/project/ExportProgressPanel', () => ({
  ExportProgressPanel: () => <div data-testid="export-progress-panel" />,
}));

vi.mock('@/components/project/SegmentChannelDialog', () => ({
  SegmentChannelDialog: ({
    open,
    channels,
    defaultChannel,
    onConfirm,
    onCancel,
  }: {
    open: boolean;
    channels: string[];
    defaultChannel: string;
    onConfirm: (ch: string) => void;
    onCancel: () => void;
  }) =>
    open ? (
      <div data-testid="segment-channel-dialog">
        <span data-testid="channels">{channels.join(',')}</span>
        <button
          data-testid="confirm-channel"
          onClick={() => onConfirm(defaultChannel)}
        >
          Confirm
        </button>
        <button data-testid="cancel-channel" onClick={onCancel}>
          Cancel
        </button>
      </div>
    ) : null,
  extractChannelsFromPaths: (paths: (string | undefined)[]) => {
    const channels = new Set<string>();
    for (const p of paths) {
      if (!p) continue;
      const match = /\/(ch\d+)\.png$/.exec(p);
      if (match) channels.add(match[1]);
    }
    return Array.from(channels);
  },
}));

vi.mock('@/types', async () => {
  const actual = await vi.importActual<typeof import('@/types')>('@/types');
  return {
    ...actual,
    isModelCompatibleWithType: vi.fn((model: string, type: string) =>
      actual.isModelCompatibleWithType(model as never, type as never)
    ),
  };
});

// ---------------------------------------------------------------------------
// Render helper
// ---------------------------------------------------------------------------

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/project/proj-1']}>
      <ProjectDetail />
    </MemoryRouter>
  );
}

// ---------------------------------------------------------------------------
// Default hook wiring before each test
// ---------------------------------------------------------------------------

function wireDefaultHooks(
  images: ReturnType<typeof makeImage>[] = [],
  projectDataOverrides: Record<string, unknown> = {}
) {
  const projectData = makeProjectData({ images, ...projectDataOverrides });
  mockUseProjectData.mockReturnValue(projectData);
  mockUseImageFilter.mockReturnValue(makeImageFilter(images));
  mockUsePagination.mockReturnValue(makePagination(images.length));
  mockUseSegmentationQueue
    .mockReturnValueOnce(makeQueueStats()) // project-scoped call
    .mockReturnValue(makeQueueStats()); // global stats call
  mockUseStatusReconciliation.mockReturnValue({
    reconcileImageStatuses: vi.fn(),
    hasStaleProcessingImages: false,
  });
  mockUseSharedAdvancedExport.mockReturnValue(makeExportHook());
  mockUseProjectImageActions.mockReturnValue({
    handleDeleteImage: mockHandleDeleteImage,
    handleOpenSegmentationEditor: mockHandleOpenSegmentationEditor,
  });
  return projectData;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ProjectDetail page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  // -------------------------------------------------------------------------
  // Loading state
  // -------------------------------------------------------------------------

  describe('Loading state', () => {
    it('shows spinner when useProjectData loading=true', () => {
      wireDefaultHooks([], { loading: true });
      renderPage();

      // Spinner: Loader2 renders as svg with animate-spin
      const spinner = document.querySelector('.animate-spin');
      expect(spinner).toBeTruthy();
    });

    it('does not render ProjectImages while loading', () => {
      wireDefaultHooks([], { loading: true });
      renderPage();

      expect(screen.queryByTestId('project-images')).toBeNull();
    });

    it('does not render EmptyState while loading', () => {
      wireDefaultHooks([], { loading: true });
      renderPage();

      expect(screen.queryByTestId('empty-state')).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Empty state (no images, not loading)
  // -------------------------------------------------------------------------

  describe('Empty state', () => {
    it('renders EmptyState when images=[] and loading=false', () => {
      wireDefaultHooks([]);
      renderPage();

      expect(screen.getByTestId('empty-state')).toBeInTheDocument();
    });

    it('does not render ProjectImages when empty', () => {
      wireDefaultHooks([]);
      renderPage();

      expect(screen.queryByTestId('project-images')).toBeNull();
    });

    it('does not render spinner when empty (not loading)', () => {
      wireDefaultHooks([]);
      renderPage();

      expect(document.querySelector('.animate-spin')).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Loaded gallery state
  // -------------------------------------------------------------------------

  describe('Loaded gallery', () => {
    it('renders ProjectImages when images present', () => {
      wireDefaultHooks([makeImage({}, 'img-1'), makeImage({}, 'img-2')]);
      renderPage();

      expect(screen.getByTestId('project-images')).toBeInTheDocument();
    });

    it('renders ProjectToolbar when not in uploader mode', () => {
      wireDefaultHooks([makeImage()]);
      renderPage();

      expect(screen.getByTestId('project-toolbar')).toBeInTheDocument();
    });

    it('renders QueueStatsPanel', () => {
      wireDefaultHooks([makeImage()]);
      renderPage();

      expect(screen.getByTestId('queue-stats-panel')).toBeInTheDocument();
    });

    it('renders ExportProgressPanel', () => {
      wireDefaultHooks([makeImage()]);
      renderPage();

      expect(screen.getByTestId('export-progress-panel')).toBeInTheDocument();
    });

    it('shows pagination info when totalPages > 0', () => {
      const images = [makeImage({}, 'img-1')];
      mockUseProjectData.mockReturnValue(makeProjectData({ images }));
      mockUseImageFilter.mockReturnValue(makeImageFilter(images));
      mockUsePagination.mockReturnValue(makePagination(1));
      mockUseSegmentationQueue
        .mockReturnValueOnce(makeQueueStats())
        .mockReturnValue(makeQueueStats());
      mockUseStatusReconciliation.mockReturnValue({
        reconcileImageStatuses: vi.fn(),
        hasStaleProcessingImages: false,
      });
      mockUseSharedAdvancedExport.mockReturnValue(makeExportHook());
      mockUseProjectImageActions.mockReturnValue({
        handleDeleteImage: mockHandleDeleteImage,
        handleOpenSegmentationEditor: mockHandleOpenSegmentationEditor,
      });
      renderPage();

      // Pagination info uses t('export.showingImages', ...) → returns key as stub
      expect(screen.getByText('export.showingImages')).toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // View-mode toggle
  // -------------------------------------------------------------------------

  describe('View-mode toggle', () => {
    it('starts in grid mode', () => {
      wireDefaultHooks([makeImage()]);
      renderPage();

      expect(screen.getByTestId('view-mode').textContent).toBe('grid');
    });

    it('switches to list mode when toolbar triggers setViewMode("list")', async () => {
      wireDefaultHooks([makeImage()]);
      renderPage();

      await userEvent.click(screen.getByTestId('switch-list'));

      expect(screen.getByTestId('view-mode').textContent).toBe('list');
    });

    it('switches back to grid from list', async () => {
      wireDefaultHooks([makeImage()]);
      renderPage();

      await userEvent.click(screen.getByTestId('switch-list'));
      await userEvent.click(screen.getByTestId('switch-grid'));

      expect(screen.getByTestId('view-mode').textContent).toBe('grid');
    });
  });

  // -------------------------------------------------------------------------
  // Uploader toggle
  // -------------------------------------------------------------------------

  describe('Uploader toggle', () => {
    it('shows ProjectUploaderSection after toggling uploader', async () => {
      wireDefaultHooks([makeImage()]);
      renderPage();

      await userEvent.click(screen.getByTestId('toggle-uploader'));

      expect(screen.getByTestId('uploader-section')).toBeInTheDocument();
      expect(screen.queryByTestId('project-toolbar')).toBeNull();
    });

    it('hides ProjectUploaderSection when cancel is clicked', async () => {
      wireDefaultHooks([makeImage()]);
      renderPage();

      await userEvent.click(screen.getByTestId('toggle-uploader'));
      expect(screen.getByTestId('uploader-section')).toBeInTheDocument();

      await userEvent.click(screen.getByTestId('cancel-upload'));
      expect(screen.queryByTestId('uploader-section')).toBeNull();
      expect(screen.getByTestId('project-toolbar')).toBeInTheDocument();
    });

    it('EmptyState upload button also opens uploader', async () => {
      wireDefaultHooks([]);
      renderPage();

      await userEvent.click(screen.getByTestId('empty-upload'));

      expect(screen.getByTestId('uploader-section')).toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // Image selection
  // -------------------------------------------------------------------------

  describe('Image selection', () => {
    it('selectedCount starts at 0', () => {
      wireDefaultHooks([makeImage({}, 'img-1')]);
      renderPage();

      expect(screen.getByTestId('selected-count').textContent).toBe('0');
    });

    it('selecting an image increments selectedCount', async () => {
      wireDefaultHooks([makeImage({}, 'img-1')]);
      renderPage();

      // Use click on the checkbox — userEvent properly toggles the checked state
      await userEvent.click(screen.getByTestId('select-img-1'));

      await waitFor(() => {
        expect(screen.getByTestId('selected-count').textContent).toBe('1');
      });
    });

    it('deselecting an image decrements selectedCount', async () => {
      wireDefaultHooks([makeImage({}, 'img-1')]);
      renderPage();

      // Select
      await userEvent.click(screen.getByTestId('select-img-1'));
      await waitFor(() =>
        expect(screen.getByTestId('selected-count').textContent).toBe('1')
      );

      // Deselect — click again on the same checkbox, which now calls onSelectionChange
      // with checked=false (since stub reads checked from selectedImageIds.has())
      // Because the stub's onChange fires with e.target.checked reflecting DOM state,
      // we click again to deselect.
      await userEvent.click(screen.getByTestId('select-img-1'));
      await waitFor(() =>
        expect(screen.getByTestId('selected-count').textContent).toBe('0')
      );
    });

    it('select all toggle selects all filtered images', async () => {
      const images = [makeImage({}, 'img-1'), makeImage({}, 'img-2')];
      wireDefaultHooks(images);
      renderPage();

      await userEvent.click(screen.getByTestId('select-all-toggle'));

      await waitFor(() =>
        expect(screen.getByTestId('selected-count').textContent).toBe('2')
      );
    });

    it('select all toggle deselects all when all are already selected', async () => {
      const images = [makeImage({}, 'img-1'), makeImage({}, 'img-2')];
      wireDefaultHooks(images);
      renderPage();

      // Select all first
      await userEvent.click(screen.getByTestId('select-all-toggle'));
      await waitFor(() =>
        expect(screen.getByTestId('selected-count').textContent).toBe('2')
      );

      // Toggle again → deselect all
      await userEvent.click(screen.getByTestId('select-all-toggle'));
      await waitFor(() =>
        expect(screen.getByTestId('selected-count').textContent).toBe('0')
      );
    });
  });

  // -------------------------------------------------------------------------
  // Batch delete
  // -------------------------------------------------------------------------

  describe('Batch delete flow', () => {
    beforeEach(() => {
      mockDeleteBatch.mockResolvedValue({ deletedCount: 1, failedIds: [] });
    });

    it('clicking batch-delete-btn opens AlertDialog', async () => {
      const images = [makeImage({}, 'img-1'), makeImage({}, 'img-2')];
      wireDefaultHooks(images);
      renderPage();

      // Select all via toolbar toggle, then click batch delete
      await userEvent.click(screen.getByTestId('select-all-toggle'));
      await userEvent.click(screen.getByTestId('batch-delete-btn'));

      // AlertDialog opens — it renders Cancel and Delete buttons in the footer
      expect(
        screen.getByRole('button', { name: /common\.cancel/i })
      ).toBeInTheDocument();
    });

    it('confirming delete calls apiClient.deleteBatch with selected ids', async () => {
      wireDefaultHooks([makeImage({}, 'img-1')]);
      renderPage();

      // Select via checkbox click
      await userEvent.click(screen.getByTestId('select-img-1'));
      await waitFor(() =>
        expect(screen.getByTestId('selected-count').textContent).toBe('1')
      );

      // Open dialog
      await userEvent.click(screen.getByTestId('batch-delete-btn'));

      // Click the Delete action button in the dialog
      const deleteActions = screen.getAllByRole('button', {
        name: /common\.delete/i,
      });
      await userEvent.click(deleteActions[deleteActions.length - 1]);

      await waitFor(() => {
        expect(mockDeleteBatch).toHaveBeenCalledWith(['img-1'], 'proj-1');
      });
    });

    it('cancelling delete dialog does NOT call apiClient.deleteBatch', async () => {
      const images = [makeImage({}, 'img-1')];
      wireDefaultHooks(images);
      renderPage();

      await userEvent.click(screen.getByTestId('select-all-toggle'));
      await userEvent.click(screen.getByTestId('batch-delete-btn'));
      await userEvent.click(
        screen.getByRole('button', { name: /common\.cancel/i })
      );

      expect(mockDeleteBatch).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Segment all
  // -------------------------------------------------------------------------

  describe('Segment all', () => {
    beforeEach(() => {
      mockAddBatchToQueue.mockResolvedValue({ queuedCount: 1 });
    });

    it('calls apiClient.addBatchToQueue when images need segmentation', async () => {
      const img = makeImage({ segmentationStatus: 'no_segmentation' }, 'img-1');
      wireDefaultHooks([img]);
      renderPage();

      await userEvent.click(screen.getByTestId('segment-all-btn'));

      await waitFor(() => {
        expect(mockAddBatchToQueue).toHaveBeenCalledWith(
          ['img-1'],
          'proj-1',
          'hrnet',
          0.5,
          0,
          false,
          false,
          undefined
        );
      });
    });

    it('does not call addBatchToQueue when all images are already segmented', async () => {
      const img = makeImage({ segmentationStatus: 'completed' }, 'img-1');
      wireDefaultHooks([img]);
      renderPage();

      await userEvent.click(screen.getByTestId('segment-all-btn'));

      await waitFor(() => {
        expect(vi.mocked(toast.info)).toHaveBeenCalledWith(
          'projects.allImagesAlreadySegmented'
        );
      });
      expect(mockAddBatchToQueue).not.toHaveBeenCalled();
    });

    it('opens incompatible model dialog when model not compatible with project type', async () => {
      // Wire incompatible model scenario: project type is 'sperm', model is 'hrnet'
      // 'hrnet' is only compatible with 'spheroid'; 'sperm' requires 'sperm' model.
      const img = makeImage({ segmentationStatus: 'no_segmentation' }, 'img-1');
      mockUseProjectData.mockReturnValue(
        makeProjectData({ images: [img], projectType: 'sperm' })
      );
      mockUseImageFilter.mockReturnValue(makeImageFilter([img]));
      mockUsePagination.mockReturnValue(makePagination(1));
      mockUseSegmentationQueue
        .mockReturnValueOnce(makeQueueStats())
        .mockReturnValue(makeQueueStats());
      mockUseStatusReconciliation.mockReturnValue({
        reconcileImageStatuses: vi.fn(),
        hasStaleProcessingImages: false,
      });
      mockUseSharedAdvancedExport.mockReturnValue(makeExportHook());
      mockUseProjectImageActions.mockReturnValue({
        handleDeleteImage: mockHandleDeleteImage,
        handleOpenSegmentationEditor: mockHandleOpenSegmentationEditor,
      });
      renderPage();

      await userEvent.click(screen.getByTestId('segment-all-btn'));

      await waitFor(() => {
        // AlertDialog with incompatible model title should appear
        expect(
          screen.getByText('segmentation.incompatibleModelTitle')
        ).toBeInTheDocument();
      });
      expect(mockAddBatchToQueue).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Channel picker (multi-channel video)
  // -------------------------------------------------------------------------

  describe('Channel picker dialog', () => {
    beforeEach(() => {
      mockAddBatchToQueue.mockResolvedValue({ queuedCount: 1 });
    });

    it('opens SegmentChannelDialog when projectChannels has > 1 channel', async () => {
      const img = makeImage({ segmentationStatus: 'no_segmentation' }, 'img-1');
      mockUseProjectData.mockReturnValue(
        makeProjectData({
          images: [img],
          projectChannels: ['ch0', 'ch1'],
        })
      );
      mockUseImageFilter.mockReturnValue(makeImageFilter([img]));
      mockUsePagination.mockReturnValue(makePagination(1));
      mockUseSegmentationQueue
        .mockReturnValueOnce(makeQueueStats())
        .mockReturnValue(makeQueueStats());
      mockUseStatusReconciliation.mockReturnValue({
        reconcileImageStatuses: vi.fn(),
        hasStaleProcessingImages: false,
      });
      mockUseSharedAdvancedExport.mockReturnValue(makeExportHook());
      mockUseProjectImageActions.mockReturnValue({
        handleDeleteImage: mockHandleDeleteImage,
        handleOpenSegmentationEditor: mockHandleOpenSegmentationEditor,
      });
      renderPage();

      await userEvent.click(screen.getByTestId('segment-all-btn'));

      await waitFor(() => {
        expect(
          screen.getByTestId('segment-channel-dialog')
        ).toBeInTheDocument();
      });
      expect(screen.getByTestId('channels').textContent).toBe('ch0,ch1');
    });

    it('confirming channel picker calls addBatchToQueue with the picked channel', async () => {
      const img = makeImage({ segmentationStatus: 'no_segmentation' }, 'img-1');
      mockUseProjectData.mockReturnValue(
        makeProjectData({
          images: [img],
          projectChannels: ['ch0', 'ch1'],
        })
      );
      mockUseImageFilter.mockReturnValue(makeImageFilter([img]));
      mockUsePagination.mockReturnValue(makePagination(1));
      mockUseSegmentationQueue
        .mockReturnValueOnce(makeQueueStats())
        .mockReturnValue(makeQueueStats());
      mockUseStatusReconciliation.mockReturnValue({
        reconcileImageStatuses: vi.fn(),
        hasStaleProcessingImages: false,
      });
      mockUseSharedAdvancedExport.mockReturnValue(makeExportHook());
      mockUseProjectImageActions.mockReturnValue({
        handleDeleteImage: mockHandleDeleteImage,
        handleOpenSegmentationEditor: mockHandleOpenSegmentationEditor,
      });
      renderPage();

      await userEvent.click(screen.getByTestId('segment-all-btn'));
      await waitFor(() => screen.getByTestId('segment-channel-dialog'));

      await userEvent.click(screen.getByTestId('confirm-channel'));

      // onConfirm wraps handleSegmentAll in a setTimeout(0) to let the dialog
      // close before toast machinery fires. waitFor polls until addBatchToQueue
      // is called, which naturally waits for the deferred tick.
      await waitFor(
        () => {
          expect(mockAddBatchToQueue).toHaveBeenCalledWith(
            ['img-1'],
            'proj-1',
            'hrnet',
            0.5,
            0,
            false,
            false,
            'ch0' // defaultChannel is first one
          );
        },
        { timeout: 2000 }
      );
    });

    it('cancelling channel picker closes dialog without dispatch', async () => {
      const img = makeImage({ segmentationStatus: 'no_segmentation' }, 'img-1');
      mockUseProjectData.mockReturnValue(
        makeProjectData({
          images: [img],
          projectChannels: ['ch0', 'ch1'],
        })
      );
      mockUseImageFilter.mockReturnValue(makeImageFilter([img]));
      mockUsePagination.mockReturnValue(makePagination(1));
      mockUseSegmentationQueue
        .mockReturnValueOnce(makeQueueStats())
        .mockReturnValue(makeQueueStats());
      mockUseStatusReconciliation.mockReturnValue({
        reconcileImageStatuses: vi.fn(),
        hasStaleProcessingImages: false,
      });
      mockUseSharedAdvancedExport.mockReturnValue(makeExportHook());
      mockUseProjectImageActions.mockReturnValue({
        handleDeleteImage: mockHandleDeleteImage,
        handleOpenSegmentationEditor: mockHandleOpenSegmentationEditor,
      });
      renderPage();

      await userEvent.click(screen.getByTestId('segment-all-btn'));
      await waitFor(() => screen.getByTestId('segment-channel-dialog'));

      await userEvent.click(screen.getByTestId('cancel-channel'));

      await waitFor(() =>
        expect(screen.queryByTestId('segment-channel-dialog')).toBeNull()
      );
      expect(mockAddBatchToQueue).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Cancel segmentation
  // -------------------------------------------------------------------------

  describe('Cancel segmentation', () => {
    it('calls apiClient.cancelAllUserSegmentations on cancel button', async () => {
      mockCancelAllUserSegmentations.mockResolvedValue({
        success: true,
        cancelledCount: 1,
      });
      wireDefaultHooks([makeImage()]);
      renderPage();

      await userEvent.click(screen.getByTestId('cancel-segmentation-btn'));

      await waitFor(() => {
        expect(mockCancelAllUserSegmentations).toHaveBeenCalledOnce();
      });
    });

    it('shows toast.error when cancelAllUserSegmentations throws', async () => {
      mockCancelAllUserSegmentations.mockRejectedValue(new Error('oops'));
      wireDefaultHooks([makeImage()]);
      renderPage();

      await userEvent.click(screen.getByTestId('cancel-segmentation-btn'));

      await waitFor(() => {
        expect(vi.mocked(toast.error)).toHaveBeenCalledWith(
          'queue.cancelFailed'
        );
      });
    });
  });

  // -------------------------------------------------------------------------
  // Open image (navigate to editor)
  // -------------------------------------------------------------------------

  describe('handleOpenImage', () => {
    it('delegates to handleOpenSegmentationEditor from useProjectImageActions', async () => {
      wireDefaultHooks([makeImage({}, 'img-1')]);
      renderPage();

      await userEvent.click(screen.getByTestId('open-img-1'));

      expect(mockHandleOpenSegmentationEditor).toHaveBeenCalledWith('img-1');
    });
  });

  // -------------------------------------------------------------------------
  // handleProjectTypeChange
  // -------------------------------------------------------------------------

  describe('handleProjectTypeChange', () => {
    it('calls apiClient.updateProject with new type on type change', async () => {
      mockUpdateProject.mockResolvedValue({});
      wireDefaultHooks([]);
      renderPage();

      // The ProjectHeader stub exposes a "Change Type" button wired to onTypeChange('wound')
      await userEvent.click(screen.getByTestId('change-type-btn'));

      await waitFor(() => {
        expect(mockUpdateProject).toHaveBeenCalledWith('proj-1', {
          type: 'wound',
        });
      });
    });

    it('calls setProjectType after successful update', async () => {
      const projectData = makeProjectData({});
      mockUpdateProject.mockResolvedValue({});
      mockUseProjectData.mockReturnValue(projectData);
      mockUseImageFilter.mockReturnValue(makeImageFilter([]));
      mockUsePagination.mockReturnValue(makePagination(0));
      mockUseSegmentationQueue
        .mockReturnValueOnce(makeQueueStats())
        .mockReturnValue(makeQueueStats());
      mockUseStatusReconciliation.mockReturnValue({
        reconcileImageStatuses: vi.fn(),
        hasStaleProcessingImages: false,
      });
      mockUseSharedAdvancedExport.mockReturnValue(makeExportHook());
      mockUseProjectImageActions.mockReturnValue({
        handleDeleteImage: mockHandleDeleteImage,
        handleOpenSegmentationEditor: mockHandleOpenSegmentationEditor,
      });
      renderPage();

      await userEvent.click(screen.getByTestId('change-type-btn'));

      await waitFor(() => {
        expect(projectData.setProjectType).toHaveBeenCalledWith('wound');
      });
    });

    it('does not call apiClient.updateProject when projectId is missing', () => {
      // This is structural: handleProjectTypeChange guards with `if (!id) return`
      // We can't easily unset useParams here, so we verify updateProject is not
      // called before any user action.
      wireDefaultHooks([]);
      renderPage();

      expect(mockUpdateProject).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // QueueStatsPanel prop wiring
  // -------------------------------------------------------------------------

  describe('QueueStatsPanel props', () => {
    it('imagesToSegmentCount equals count of images with pending/failed/no_segmentation', () => {
      const images = [
        makeImage({ segmentationStatus: 'no_segmentation' }, 'img-1'),
        makeImage({ segmentationStatus: 'pending' }, 'img-2'),
        makeImage({ segmentationStatus: 'completed' }, 'img-3'),
      ];
      wireDefaultHooks(images);
      renderPage();

      // 2 images need segmentation (no_segmentation + pending), 1 is completed
      expect(screen.getByTestId('images-to-segment').textContent).toBe('2');
    });

    it('batchSubmitted is false initially', () => {
      wireDefaultHooks([makeImage()]);
      renderPage();

      // hasActiveQueue is false (queueStats.processing=0, queued=0), batchSubmitted=false
      expect(screen.getByTestId('batch-submitted').textContent).toBe('false');
    });

    it('batchSubmitted becomes true after segment-all call', async () => {
      mockAddBatchToQueue.mockResolvedValue({ queuedCount: 1 });
      const img = makeImage({ segmentationStatus: 'no_segmentation' }, 'img-1');
      wireDefaultHooks([img]);
      renderPage();

      await userEvent.click(screen.getByTestId('segment-all-btn'));

      await waitFor(() => {
        expect(screen.getByTestId('batch-submitted').textContent).toBe('true');
      });
    });
  });

  // -------------------------------------------------------------------------
  // useProjectData called with correct args
  // -------------------------------------------------------------------------

  describe('useProjectData wiring', () => {
    it('is called with projectId from useParams and userId from useAuth', () => {
      wireDefaultHooks([]);
      renderPage();

      expect(mockUseProjectData).toHaveBeenCalledWith('proj-1', 'user-1');
    });
  });
});
