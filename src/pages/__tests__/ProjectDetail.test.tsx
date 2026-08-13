/**
 * ProjectDetail page unit tests.
 *
 * Consolidated from the former ProjectDetail.test / .additional / .extra /
 * .gaps / .gaps2 split. Organised by concern via top-level describe blocks:
 *
 *   - Loading & empty states
 *   - Loaded gallery & pagination
 *   - View-mode toggle
 *   - Uploader toggle
 *   - Image selection
 *   - Batch delete
 *   - Segment all
 *   - Channel picker dialog
 *   - Incompatible model dialog
 *   - Cancel segmentation
 *   - Open image (navigate to editor)
 *   - Project type change
 *   - Batch-submitted state + hook wiring
 *   - WebSocket updates (processWebSocketUpdate, single/bulk cancel, batch done)
 *   - Upload completion (merge logic)
 *
 * All heavy children are stubbed; the real component logic (state machine,
 * handlers, effects) is what's under test.
 *
 * NOT tested (legitimately):
 * - Canvas / DnD interactions inside ProjectImages (deep child, mocked)
 * - processImageChunks large-batch progress toasts (500+ images, impractical)
 * - Real 60 s safety / WS-disconnect timers (guard conditions tested instead)
 * - Real WebSocket message delivery (environment-level, not unit-testable)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, act } from '@testing-library/react';
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
  mockUsePagination,
  mockUseStatusReconciliation,
  mockUseSegmentationQueueImpl,
  mockGetProjectImages,
  mockGetSegmentationResults,
  mockAddBatchToQueue,
  mockDeleteBatch,
  mockCancelAllUserSegmentations,
  mockUpdateProject,
  mockHandleDeleteImage,
  mockHandleOpenSegmentationEditor,
  mockRequestQueueStats,
} = vi.hoisted(() => {
  // Mutable ref so tests can swap the useSegmentationQueue implementation
  // (e.g. to capture the callbacks the component passes in) without breaking
  // the vi.mock factory closure hoisted before the const declarations.
  const mockUseSegmentationQueueImpl = { fn: vi.fn() };
  return {
    mockNavigate: vi.fn(),
    mockUseProjectData: vi.fn(),
    mockUseImageFilter: vi.fn(),
    mockUsePagination: vi.fn(),
    mockUseStatusReconciliation: vi.fn(),
    mockUseSegmentationQueueImpl,
    mockGetProjectImages: vi.fn(),
    mockGetSegmentationResults: vi.fn(),
    mockAddBatchToQueue: vi.fn(),
    mockDeleteBatch: vi.fn(),
    mockCancelAllUserSegmentations: vi.fn(),
    mockUpdateProject: vi.fn(),
    mockHandleDeleteImage: vi.fn(),
    mockHandleOpenSegmentationEditor: vi.fn(),
    mockRequestQueueStats: vi.fn(),
  };
});

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------

type SegStatus =
  | 'no_segmentation'
  | 'pending'
  | 'completed'
  | 'segmented'
  | 'processing'
  | 'queued'
  | 'failed';

const makeImage = (overrides: Record<string, unknown> = {}, id = 'img-1') => ({
  id,
  name: `Image ${id}`,
  url: `/images/${id}.png`,
  thumbnail_url: `/thumbs/${id}.jpg`,
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
  segmentationStatus: 'no_segmentation' as SegStatus,
  segmentationResult: undefined as unknown,
  segmentationData: undefined as unknown,
  segmentationThumbnailPath: undefined as string | undefined,
  segmentationThumbnailUrl: undefined as string | undefined,
  ...overrides,
});

type MockImage = ReturnType<typeof makeImage>;

/** projectData whose `images` getter tracks updateImages mutations. */
function makeProjectData(
  images: MockImage[] = [],
  overrides: Record<string, unknown> = {}
) {
  const state = { images: [...images] };
  const updateImages = vi.fn(
    (arg: MockImage[] | ((p: MockImage[]) => MockImage[])) => {
      if (typeof arg === 'function') {
        state.images = (arg as (p: MockImage[]) => MockImage[])(state.images);
      } else {
        state.images = arg as MockImage[];
      }
    }
  );
  return {
    projectTitle: 'Test Project',
    projectType: 'spheroid' as const,
    setProjectType: vi.fn(),
    get images() {
      return state.images;
    },
    projectChannels: [] as string[],
    loading: false,
    updateImages,
    refreshImageSegmentation: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function makeImageFilter(images: MockImage[] = [], searchTerm = '') {
  return {
    filteredImages: images,
    searchTerm,
    sortField: 'updatedAt',
    sortDirection: 'desc',
    handleSearch: vi.fn(),
    handleSort: vi.fn(),
  };
}

function makePagination(count = 0, totalPages?: number) {
  const tp = totalPages ?? (count > 0 ? 1 : 0);
  return {
    currentPage: 1,
    totalPages: tp,
    itemsPerPage: 30,
    startIndex: count > 0 ? 1 : 0,
    endIndex: count,
    canGoNext: false,
    canGoPrevious: false,
    setCurrentPage: vi.fn(),
    goToNextPage: vi.fn(),
    goToPreviousPage: vi.fn(),
    pageNumbers: tp > 0 ? [1] : [],
    paginatedIndices: { start: 0, end: count },
  };
}

function makeQueueReturn(overrides: Record<string, unknown> = {}) {
  return {
    isConnected: true,
    queueStats: { total: 0, queued: 0, processing: 0, completed: 0, failed: 0 },
    lastUpdate: null as unknown,
    parallelStats: null,
    requestQueueStats: mockRequestQueueStats,
    joinProject: vi.fn(),
    leaveProject: vi.fn(),
    ...overrides,
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
  useProjectImageActions: () => ({
    handleDeleteImage: mockHandleDeleteImage,
    handleOpenSegmentationEditor: mockHandleOpenSegmentationEditor,
  }),
}));

vi.mock('@/hooks/useSegmentationQueue', () => ({
  useSegmentationQueue: (...args: unknown[]) =>
    mockUseSegmentationQueueImpl.fn(...args),
}));

vi.mock('@/hooks/usePagination', () => ({
  usePagination: (...args: unknown[]) => mockUsePagination(...args),
}));

vi.mock('@/hooks/useStatusReconciliation', () => ({
  useStatusReconciliation: (...args: unknown[]) =>
    mockUseStatusReconciliation(...args),
}));

vi.mock('@/pages/export/hooks/useSharedAdvancedExport', () => ({
  useSharedAdvancedExport: () => makeExportHook(),
}));

vi.mock('@/lib/api', () => ({
  default: {
    addBatchToQueue: (...a: unknown[]) => mockAddBatchToQueue(...a),
    deleteBatch: (...a: unknown[]) => mockDeleteBatch(...a),
    cancelAllUserSegmentations: (...a: unknown[]) =>
      mockCancelAllUserSegmentations(...a),
    updateProject: (...a: unknown[]) => mockUpdateProject(...a),
    getProjectImages: (...a: unknown[]) => mockGetProjectImages(...a),
    getSegmentationResults: (...a: unknown[]) =>
      mockGetSegmentationResults(...a),
  },
}));

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), debug: vi.fn(), warn: vi.fn(), info: vi.fn() },
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
    onTypeChange,
  }: {
    projectTitle: string;
    loading?: boolean;
    projectType?: string;
    imagesCount?: number;
    onTypeChange?: (t: string) => void;
  }) => (
    <header data-testid="project-header">
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
  }: {
    onToggleUploader: () => void;
    viewMode: string;
    setViewMode: (m: 'grid' | 'list') => void;
    selectedCount: number;
    onSelectAllToggle: () => void;
    onBatchDelete: () => void;
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
      {hasSearchTerm && <span data-testid="has-search-term">search</span>}
      <button data-testid="empty-upload" onClick={onUpload}>
        Upload
      </button>
    </div>
  ),
}));

vi.mock('@/components/project/ProjectImages', () => ({
  default: ({
    images,
    onOpen,
    onSelectionChange,
    selectedImageIds,
  }: {
    images: MockImage[];
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
    onSegmentAll,
    onCancelSegmentation,
  }: {
    batchSubmitted: boolean;
    onSegmentAll: () => void;
    onCancelSegmentation: () => void;
    [key: string]: unknown;
  }) => (
    <div data-testid="queue-stats-panel">
      <span data-testid="batch-submitted">{String(batchSubmitted)}</span>
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
        <span data-testid="dialog-channels">{channels.join(',')}</span>
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
// Render helper + hook wiring
// ---------------------------------------------------------------------------

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/project/proj-1']}>
      <ProjectDetail />
    </MemoryRouter>
  );
}

/**
 * Standard wiring. `queueOverrides` customises the FIRST useSegmentationQueue
 * call (project-scoped — receives the cancel / bulk-cancel / batch-done
 * callbacks); the second (global stats) call always returns the baseline.
 * `filterOverrides` lets a test diverge filteredImages / searchTerm from the
 * project's `images` (e.g. a search that filters everything out).
 */
function wireHooks(
  images: MockImage[],
  projectDataOverrides: Record<string, unknown> = {},
  queueOverrides: Record<string, unknown> = {},
  filterOverrides: { searchTerm?: string; filteredImages?: MockImage[] } = {}
) {
  const projectData = makeProjectData(images, projectDataOverrides);
  mockUseProjectData.mockReturnValue(projectData);
  mockUseImageFilter.mockReturnValue(
    makeImageFilter(
      filterOverrides.filteredImages ?? images,
      filterOverrides.searchTerm ?? ''
    )
  );
  const filteredCount = filterOverrides.filteredImages?.length ?? images.length;
  mockUsePagination.mockReturnValue(makePagination(filteredCount));

  mockUseSegmentationQueueImpl.fn
    .mockReturnValueOnce(makeQueueReturn(queueOverrides))
    .mockReturnValue(makeQueueReturn());

  return projectData;
}

/**
 * Wire hooks and capture the WebSocket callbacks the component passes into
 * useSegmentationQueue on its first (project-scoped) call.
 */
function wireHooksCapturingCallbacks(
  images: MockImage[],
  captureRef: {
    onCancelled?: (data: { imageId?: string }) => void;
    onBulkCancelled?: (data: {
      cancelledCount?: number;
      affectedProjects?: string[];
    }) => void;
    onBatchCompleted?: () => void;
  }
) {
  const projectData = makeProjectData(images);
  mockUseProjectData.mockReturnValue(projectData);
  mockUseImageFilter.mockReturnValue(makeImageFilter(images));
  mockUsePagination.mockReturnValue(makePagination(images.length));

  let firstCall = true;
  mockUseSegmentationQueueImpl.fn.mockImplementation(
    (
      _projectId: unknown,
      onCancelled: (data: { imageId?: string }) => void,
      onBulkCancelled: (data: {
        cancelledCount?: number;
        affectedProjects?: string[];
      }) => void,
      onBatchCompleted: () => void
    ) => {
      if (firstCall) {
        firstCall = false;
        captureRef.onCancelled = onCancelled;
        captureRef.onBulkCancelled = onBulkCancelled;
        captureRef.onBatchCompleted = onBatchCompleted;
      }
      return makeQueueReturn();
    }
  );

  return projectData;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ProjectDetail page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetProjectImages.mockResolvedValue({ images: [], total: 0 });
    mockGetSegmentationResults.mockResolvedValue(null);
    mockAddBatchToQueue.mockResolvedValue({ queuedCount: 1 });
    mockDeleteBatch.mockResolvedValue({
      deletedCount: 1,
      failedIds: [],
      errors: [],
    });
    mockUpdateProject.mockResolvedValue({});
    mockCancelAllUserSegmentations.mockResolvedValue({
      success: true,
      cancelledCount: 1,
      affectedProjects: [],
      affectedBatches: [],
    });
    mockUseStatusReconciliation.mockReturnValue({
      reconcileImageStatuses: vi.fn(),
      hasStaleProcessingImages: false,
    });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  // =========================================================================
  // Loading & empty states
  // =========================================================================

  describe('Loading & empty states', () => {
    it('shows spinner and hides gallery/empty-state while loading', () => {
      wireHooks([makeImage()], { loading: true });
      renderPage();

      // Loader2 renders as an svg with animate-spin
      expect(document.querySelector('.animate-spin')).toBeTruthy();
      expect(screen.queryByTestId('project-images')).toBeNull();
      expect(screen.queryByTestId('empty-state')).toBeNull();
    });

    it('renders EmptyState (no spinner, no gallery) when there are no images', () => {
      wireHooks([]);
      renderPage();

      expect(screen.getByTestId('empty-state')).toBeInTheDocument();
      expect(screen.queryByTestId('project-images')).toBeNull();
      expect(document.querySelector('.animate-spin')).toBeNull();
    });

    it('forwards hasSearchTerm=true when a search filters everything out', () => {
      // Images exist in the project but filteredImages is empty (search match=0).
      wireHooks(
        [makeImage()],
        {},
        {},
        { filteredImages: [], searchTerm: 'xyz' }
      );
      renderPage();

      expect(screen.getByTestId('empty-state')).toBeInTheDocument();
      expect(screen.getByTestId('has-search-term')).toBeInTheDocument();
    });
  });

  // =========================================================================
  // Loaded gallery & pagination
  // =========================================================================

  describe('Loaded gallery & pagination', () => {
    it('renders the toolbar, gallery, queue panel and export panel when images are present', () => {
      wireHooks([makeImage({}, 'img-1'), makeImage({}, 'img-2')]);
      renderPage();

      expect(screen.getByTestId('project-toolbar')).toBeInTheDocument();
      expect(screen.getByTestId('project-images')).toBeInTheDocument();
      expect(screen.getByTestId('queue-stats-panel')).toBeInTheDocument();
      expect(screen.getByTestId('export-progress-panel')).toBeInTheDocument();
    });

    it('shows the pagination info line when totalPages > 0', () => {
      wireHooks([makeImage()]);
      renderPage();

      // Pagination info uses t('export.showingImages', ...) → key returned by stub
      expect(screen.getByText('export.showingImages')).toBeInTheDocument();
    });

    it('hides the pagination info line when totalPages = 0', () => {
      wireHooks([], {}, {}, { filteredImages: [] });
      renderPage();

      expect(
        screen.queryByText('export.showingImages')
      ).not.toBeInTheDocument();
    });
  });

  // =========================================================================
  // View-mode toggle
  // =========================================================================

  describe('View-mode toggle', () => {
    it('starts in grid mode', () => {
      wireHooks([makeImage()]);
      renderPage();

      expect(screen.getByTestId('view-mode').textContent).toBe('grid');
    });

    it('switches to list and back to grid', async () => {
      wireHooks([makeImage()]);
      renderPage();

      await userEvent.click(screen.getByTestId('switch-list'));
      expect(screen.getByTestId('view-mode').textContent).toBe('list');

      await userEvent.click(screen.getByTestId('switch-grid'));
      expect(screen.getByTestId('view-mode').textContent).toBe('grid');
    });
  });

  // =========================================================================
  // Uploader toggle
  // =========================================================================

  describe('Uploader toggle', () => {
    it('shows the uploader (hiding the toolbar) when toggled, and restores on cancel', async () => {
      wireHooks([makeImage()]);
      renderPage();

      await userEvent.click(screen.getByTestId('toggle-uploader'));
      expect(screen.getByTestId('uploader-section')).toBeInTheDocument();
      expect(screen.queryByTestId('project-toolbar')).toBeNull();

      await userEvent.click(screen.getByTestId('cancel-upload'));
      expect(screen.queryByTestId('uploader-section')).toBeNull();
      expect(screen.getByTestId('project-toolbar')).toBeInTheDocument();
    });

    it('opens the uploader from the EmptyState upload button', async () => {
      wireHooks([]);
      renderPage();

      await userEvent.click(screen.getByTestId('empty-upload'));

      expect(screen.getByTestId('uploader-section')).toBeInTheDocument();
    });
  });

  // =========================================================================
  // Image selection
  // =========================================================================

  describe('Image selection', () => {
    it('selectedCount starts at 0', () => {
      wireHooks([makeImage({}, 'img-1')]);
      renderPage();

      expect(screen.getByTestId('selected-count').textContent).toBe('0');
    });

    it('selecting then deselecting an image increments then decrements selectedCount', async () => {
      wireHooks([makeImage({}, 'img-1')]);
      renderPage();

      await userEvent.click(screen.getByTestId('select-img-1'));
      await waitFor(() =>
        expect(screen.getByTestId('selected-count').textContent).toBe('1')
      );

      await userEvent.click(screen.getByTestId('select-img-1'));
      await waitFor(() =>
        expect(screen.getByTestId('selected-count').textContent).toBe('0')
      );
    });

    it('select-all toggle selects all filtered images, then deselects them', async () => {
      wireHooks([makeImage({}, 'img-1'), makeImage({}, 'img-2')]);
      renderPage();

      await userEvent.click(screen.getByTestId('select-all-toggle'));
      await waitFor(() =>
        expect(screen.getByTestId('selected-count').textContent).toBe('2')
      );

      await userEvent.click(screen.getByTestId('select-all-toggle'));
      await waitFor(() =>
        expect(screen.getByTestId('selected-count').textContent).toBe('0')
      );
    });
  });

  // =========================================================================
  // Batch delete
  // =========================================================================

  describe('Batch delete', () => {
    it('opens the confirmation dialog on batch-delete click', async () => {
      wireHooks([makeImage({}, 'img-1'), makeImage({}, 'img-2')]);
      renderPage();

      await userEvent.click(screen.getByTestId('select-all-toggle'));
      await userEvent.click(screen.getByTestId('batch-delete-btn'));

      expect(
        screen.getByRole('button', { name: /common\.cancel/i })
      ).toBeInTheDocument();
    });

    it('confirming calls apiClient.deleteBatch and removes deleted images from state', async () => {
      const images = [makeImage({}, 'img-1'), makeImage({}, 'img-2')];
      const projectData = wireHooks(images);
      renderPage();

      // Select only img-1
      await userEvent.click(screen.getByTestId('select-img-1'));
      await waitFor(() =>
        expect(screen.getByTestId('selected-count').textContent).toBe('1')
      );

      await userEvent.click(screen.getByTestId('batch-delete-btn'));
      const deleteButtons = screen.getAllByRole('button', {
        name: /common\.delete/i,
      });
      await userEvent.click(deleteButtons[deleteButtons.length - 1]);

      await waitFor(() => {
        expect(mockDeleteBatch).toHaveBeenCalledWith(['img-1'], 'proj-1');
        expect(projectData.updateImages).toHaveBeenCalled();
      });

      // The function updater removes the deleted image, keeping img-2
      const fnCall = projectData.updateImages.mock.calls.find(
        ([arg]) => typeof arg === 'function'
      );
      expect(fnCall).toBeDefined();
      if (fnCall) {
        const result = (fnCall[0] as (imgs: MockImage[]) => MockImage[])(
          images
        );
        expect(result.map(i => i.id)).toEqual(['img-2']);
      }
    });

    it('cancelling the dialog does NOT call apiClient.deleteBatch', async () => {
      wireHooks([makeImage({}, 'img-1')]);
      renderPage();

      await userEvent.click(screen.getByTestId('select-all-toggle'));
      await userEvent.click(screen.getByTestId('batch-delete-btn'));
      await userEvent.click(
        screen.getByRole('button', { name: /common\.cancel/i })
      );

      expect(mockDeleteBatch).not.toHaveBeenCalled();
    });

    it('shows toast.warning when some ids fail to delete', async () => {
      mockDeleteBatch.mockResolvedValue({
        deletedCount: 1,
        failedIds: ['img-2'],
        errors: [],
      });
      wireHooks([makeImage({}, 'img-1'), makeImage({}, 'img-2')]);
      renderPage();

      await userEvent.click(screen.getByTestId('select-all-toggle'));
      await userEvent.click(screen.getByTestId('batch-delete-btn'));
      const deleteButtons = screen.getAllByRole('button', {
        name: /common\.delete/i,
      });
      await userEvent.click(deleteButtons[deleteButtons.length - 1]);

      await waitFor(() => {
        expect(vi.mocked(toast.warning)).toHaveBeenCalledWith(
          'project.imagesDeleteFailed'
        );
      });
    });

    it('shows only a warning (no success toast) when deletedCount=0 and ids failed', async () => {
      mockDeleteBatch.mockResolvedValue({
        deletedCount: 0,
        failedIds: ['img-1'],
        errors: ['failed'],
      });
      wireHooks([makeImage({}, 'img-1')]);
      renderPage();

      await userEvent.click(screen.getByTestId('select-img-1'));
      await userEvent.click(screen.getByTestId('batch-delete-btn'));
      await userEvent.click(
        screen.getByRole('button', { name: /common\.delete/i })
      );

      await waitFor(() => {
        expect(mockDeleteBatch).toHaveBeenCalled();
        expect(toast.success).not.toHaveBeenCalled();
        expect(toast.warning).toHaveBeenCalledWith(
          'project.imagesDeleteFailed'
        );
      });
    });

    it('shows toast.error when deleteBatch throws', async () => {
      mockDeleteBatch.mockRejectedValue(new Error('network error'));
      wireHooks([makeImage({}, 'img-1')]);
      renderPage();

      await userEvent.click(screen.getByTestId('select-img-1'));
      await userEvent.click(screen.getByTestId('batch-delete-btn'));
      await userEvent.click(
        screen.getByRole('button', { name: /common\.delete/i })
      );

      await waitFor(() => {
        expect(vi.mocked(toast.error)).toHaveBeenCalledWith(
          'errors.deleteImages'
        );
      });
    });

    it('ignores a second confirm while a delete is already in flight', async () => {
      let resolveDelete!: (v: unknown) => void;
      mockDeleteBatch.mockImplementation(
        () =>
          new Promise(res => {
            resolveDelete = res;
          })
      );
      wireHooks([makeImage({}, 'img-1')]);
      renderPage();

      await userEvent.click(screen.getByTestId('select-img-1'));
      await userEvent.click(screen.getByTestId('batch-delete-btn'));

      const confirmBtn = screen.getByRole('button', {
        name: /common\.delete/i,
      });
      // First confirm starts the async delete (stays pending)
      await userEvent.click(confirmBtn);
      expect(mockDeleteBatch).toHaveBeenCalledTimes(1);

      act(() => {
        resolveDelete({ deletedCount: 1, failedIds: [], errors: [] });
      });

      await waitFor(() => expect(toast.success).toHaveBeenCalled());
      expect(mockDeleteBatch).toHaveBeenCalledTimes(1);
    });
  });

  // =========================================================================
  // Segment all
  // =========================================================================

  describe('Segment all', () => {
    it('queues the selected image that needs segmentation', async () => {
      wireHooks([
        makeImage({ segmentationStatus: 'no_segmentation' }, 'img-1'),
      ]);
      renderPage();

      // Segmentation acts only on the selection — select the image first.
      await userEvent.click(screen.getByTestId('select-img-1'));
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

    it('queues previously-failed images too', async () => {
      wireHooks([makeImage({ segmentationStatus: 'failed' }, 'img-1')]);
      renderPage();

      await userEvent.click(screen.getByTestId('select-img-1'));
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

    it('shows the select hint and does not queue when nothing is selected', async () => {
      wireHooks([makeImage({ segmentationStatus: 'completed' }, 'img-1')]);
      renderPage();

      await userEvent.click(screen.getByTestId('segment-all-btn'));

      await waitFor(() => {
        expect(vi.mocked(toast.info)).toHaveBeenCalledWith(
          'queue.selectNothingTooltip'
        );
      });
      expect(mockAddBatchToQueue).not.toHaveBeenCalled();
    });

    it('ignores a second segment-all click while a batch is already submitted', async () => {
      wireHooks([
        makeImage({ segmentationStatus: 'no_segmentation' }, 'img-1'),
      ]);
      renderPage();

      await userEvent.click(screen.getByTestId('select-img-1'));
      await userEvent.click(screen.getByTestId('segment-all-btn'));
      await waitFor(() =>
        expect(screen.getByTestId('batch-submitted').textContent).toBe('true')
      );

      await userEvent.click(screen.getByTestId('segment-all-btn'));

      expect(mockAddBatchToQueue).toHaveBeenCalledTimes(1);
    });

    it('makes two calls (segment new + force-resegment selected completed)', async () => {
      const imgCompleted = makeImage(
        { segmentationStatus: 'completed' },
        'img-1'
      );
      const imgNoSeg = makeImage(
        { segmentationStatus: 'no_segmentation' },
        'img-2'
      );
      wireHooks([imgCompleted, imgNoSeg]);
      renderPage();

      await userEvent.click(screen.getByTestId('select-img-1'));
      await userEvent.click(screen.getByTestId('select-img-2'));
      await waitFor(() =>
        expect(screen.getByTestId('selected-count').textContent).toBe('2')
      );

      await userEvent.click(screen.getByTestId('segment-all-btn'));

      await waitFor(() => expect(mockAddBatchToQueue).toHaveBeenCalledTimes(2));

      const [firstCall, secondCall] = mockAddBatchToQueue.mock.calls;
      // First call: img-2 (no_segmentation), forceResegment=false (arg index 5)
      expect(firstCall[0]).toContain('img-2');
      expect(firstCall[5]).toBe(false);
      // Second call: img-1 (selected completed), forceResegment=true
      expect(secondCall[0]).toContain('img-1');
      expect(secondCall[5]).toBe(true);
    });

    it('shows toast.error and resets batchSubmitted when addBatchToQueue throws', async () => {
      mockAddBatchToQueue.mockRejectedValue(new Error('Queue full'));
      wireHooks([
        makeImage({ segmentationStatus: 'no_segmentation' }, 'img-1'),
      ]);
      renderPage();

      await userEvent.click(screen.getByTestId('select-img-1'));
      await userEvent.click(screen.getByTestId('segment-all-btn'));

      await waitFor(() => {
        expect(vi.mocked(toast.error)).toHaveBeenCalledWith(
          'projects.errorAddingToQueue'
        );
        expect(screen.getByTestId('batch-submitted').textContent).toBe('false');
      });
    });

    it('marks batchSubmitted true after a successful submit and keeps it while WS stays connected', async () => {
      wireHooks(
        [makeImage({ segmentationStatus: 'no_segmentation' }, 'img-1')],
        {},
        { isConnected: true }
      );
      renderPage();

      await userEvent.click(screen.getByTestId('select-img-1'));
      await userEvent.click(screen.getByTestId('segment-all-btn'));
      await waitFor(() =>
        expect(screen.getByTestId('batch-submitted').textContent).toBe('true')
      );

      // No disconnection timer fires while connected → stays true
      await new Promise(r => setTimeout(r, 200));
      expect(screen.getByTestId('batch-submitted').textContent).toBe('true');
    });
  });

  // =========================================================================
  // Channel picker dialog (multi-channel video)
  // =========================================================================

  describe('Channel picker dialog', () => {
    const multiChannel = (
      status: SegStatus = 'no_segmentation'
    ): MockImage[] => [makeImage({ segmentationStatus: status }, 'img-1')];

    it('opens the channel dialog when the project has multiple channels', async () => {
      wireHooks(multiChannel(), { projectChannels: ['ch0', 'ch1'] });
      renderPage();

      await userEvent.click(screen.getByTestId('segment-all-btn'));

      await waitFor(() =>
        expect(screen.getByTestId('segment-channel-dialog')).toBeInTheDocument()
      );
      expect(screen.getByTestId('dialog-channels').textContent).toBe('ch0,ch1');
    });

    it('confirming the picked channel queues it', async () => {
      wireHooks(multiChannel(), { projectChannels: ['ch0', 'ch1'] });
      renderPage();

      await userEvent.click(screen.getByTestId('select-img-1'));
      await userEvent.click(screen.getByTestId('segment-all-btn'));
      await waitFor(() => screen.getByTestId('segment-channel-dialog'));

      await userEvent.click(screen.getByTestId('confirm-channel'));

      // onConfirm defers handleSegmentAll via setTimeout(0); poll until it fires.
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
            'ch0'
          );
        },
        { timeout: 2000 }
      );
    });

    it('cancelling the channel dialog closes it without queuing', async () => {
      wireHooks(multiChannel(), { projectChannels: ['ch0', 'ch1'] });
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

  // =========================================================================
  // Incompatible model dialog
  // =========================================================================

  describe('Incompatible model dialog', () => {
    it('opens instead of queuing when the model is incompatible with the project type', async () => {
      // 'hrnet' (from useModel) is not compatible with a 'sperm' project.
      wireHooks(
        [makeImage({ segmentationStatus: 'no_segmentation' }, 'img-1')],
        { projectType: 'sperm' }
      );
      renderPage();

      await userEvent.click(screen.getByTestId('segment-all-btn'));

      await waitFor(() =>
        expect(
          screen.getByText('segmentation.incompatibleModelTitle')
        ).toBeInTheDocument()
      );
      expect(mockAddBatchToQueue).not.toHaveBeenCalled();
    });

    it('dismisses the dialog when Close is clicked', async () => {
      wireHooks(
        [makeImage({ segmentationStatus: 'no_segmentation' }, 'img-1')],
        { projectType: 'sperm' }
      );
      renderPage();

      await userEvent.click(screen.getByTestId('segment-all-btn'));
      await waitFor(() =>
        expect(
          screen.getByText('segmentation.incompatibleModelTitle')
        ).toBeInTheDocument()
      );

      await userEvent.click(
        screen.getByRole('button', { name: /common\.close/i })
      );

      await waitFor(() =>
        expect(
          screen.queryByText('segmentation.incompatibleModelTitle')
        ).not.toBeInTheDocument()
      );
    });
  });

  // =========================================================================
  // Cancel segmentation
  // =========================================================================

  describe('Cancel segmentation', () => {
    it('calls cancelAllUserSegmentations and shows no toast on success', async () => {
      wireHooks([makeImage()]);
      renderPage();

      await userEvent.click(screen.getByTestId('cancel-segmentation-btn'));

      await waitFor(() =>
        expect(mockCancelAllUserSegmentations).toHaveBeenCalledOnce()
      );
      // WS events drive the UI update — no toast on success.
      expect(toast.success).not.toHaveBeenCalled();
      expect(toast.error).not.toHaveBeenCalled();
    });

    it('shows toast.error when cancelAllUserSegmentations throws', async () => {
      mockCancelAllUserSegmentations.mockRejectedValue(new Error('oops'));
      wireHooks([makeImage()]);
      renderPage();

      await userEvent.click(screen.getByTestId('cancel-segmentation-btn'));

      await waitFor(() =>
        expect(vi.mocked(toast.error)).toHaveBeenCalledWith(
          'queue.cancelFailed'
        )
      );
    });
  });

  // =========================================================================
  // Open image (navigate to editor)
  // =========================================================================

  describe('Open image', () => {
    it('delegates to handleOpenSegmentationEditor with the image id', async () => {
      wireHooks([makeImage({}, 'img-1')]);
      renderPage();

      await userEvent.click(screen.getByTestId('open-img-1'));

      expect(mockHandleOpenSegmentationEditor).toHaveBeenCalledWith('img-1');
    });
  });

  // =========================================================================
  // Project type change
  // =========================================================================

  describe('Project type change', () => {
    it('updates the project, sets the new type and shows a success toast', async () => {
      const projectData = wireHooks([
        makeImage({ segmentationStatus: 'no_segmentation' }),
      ]);
      renderPage();

      await userEvent.click(screen.getByTestId('change-type-btn'));

      await waitFor(() => {
        expect(mockUpdateProject).toHaveBeenCalledWith('proj-1', {
          type: 'wound',
        });
        expect(projectData.setProjectType).toHaveBeenCalledWith('wound');
        expect(vi.mocked(toast.success)).toHaveBeenCalledWith(
          'projects.projectTypeUpdated'
        );
      });
    });

    it('shows toast.error (and no success) when updateProject throws', async () => {
      mockUpdateProject.mockRejectedValue(new Error('Server error'));
      wireHooks([]);
      renderPage();

      await userEvent.click(screen.getByTestId('change-type-btn'));

      await waitFor(() => expect(vi.mocked(toast.error)).toHaveBeenCalled());
      expect(vi.mocked(toast.success)).not.toHaveBeenCalled();
    });

    it('warns when completed segmentations exist on the project', async () => {
      wireHooks([
        makeImage({ segmentationStatus: 'completed' }, 'img-1'),
        makeImage({ segmentationStatus: 'completed' }, 'img-2'),
      ]);
      renderPage();

      await userEvent.click(screen.getByTestId('change-type-btn'));

      await waitFor(() =>
        expect(vi.mocked(toast.warning)).toHaveBeenCalledWith(
          'projects.typeChangeSegmentationsWarning',
          expect.objectContaining({ duration: 8000 })
        )
      );
    });

    it('does NOT warn when there are no completed segmentations', async () => {
      wireHooks([
        makeImage({ segmentationStatus: 'pending' }, 'img-1'),
        makeImage({ segmentationStatus: 'no_segmentation' }, 'img-2'),
      ]);
      renderPage();

      await userEvent.click(screen.getByTestId('change-type-btn'));

      await waitFor(() => expect(vi.mocked(toast.success)).toHaveBeenCalled());
      expect(vi.mocked(toast.warning)).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // Hook wiring
  // =========================================================================

  describe('Hook wiring', () => {
    it('calls useProjectData with the projectId and userId', () => {
      wireHooks([]);
      renderPage();

      expect(mockUseProjectData).toHaveBeenCalledWith('proj-1', 'user-1');
    });

    it('calls useStatusReconciliation with the projectId', () => {
      wireHooks([]);
      renderPage();

      expect(mockUseStatusReconciliation).toHaveBeenCalledWith(
        expect.objectContaining({ projectId: 'proj-1' })
      );
    });
  });

  // =========================================================================
  // WebSocket updates — processWebSocketUpdate (lastUpdate effect)
  // =========================================================================

  describe('processWebSocketUpdate (lastUpdate effect)', () => {
    it('ignores updates whose projectId does not match', async () => {
      const images = [makeImage({ segmentationStatus: 'pending' }, 'img-1')];
      const projectData = wireHooks(
        images,
        {},
        {
          lastUpdate: {
            imageId: 'img-1',
            status: 'processing',
            projectId: 'DIFFERENT-PROJECT',
            timestamp: Date.now(),
          },
          queueStats: {
            total: 1,
            queued: 0,
            processing: 1,
            completed: 0,
            failed: 0,
          },
        }
      );
      renderPage();

      // The effect debounces at 50 ms — wait beyond that
      await act(async () => {
        await new Promise(r => setTimeout(r, 200));
      });

      expect(projectData.updateImages).not.toHaveBeenCalled();
    });

    it('applies an immediate single-operation update (status passes through)', async () => {
      const images = [makeImage({ segmentationStatus: 'pending' }, 'img-1')];
      const projectData = wireHooks(
        images,
        {},
        {
          lastUpdate: {
            imageId: 'img-1',
            status: 'processing',
            projectId: 'proj-1',
            timestamp: Date.now(),
          },
          queueStats: {
            total: 1,
            queued: 0,
            processing: 1,
            completed: 0,
            failed: 0,
          },
        }
      );
      renderPage();

      await act(async () => {
        await new Promise(r => setTimeout(r, 200));
      });

      expect(projectData.updateImages).toHaveBeenCalled();
      const fnCall = projectData.updateImages.mock.calls.find(
        ([arg]) => typeof arg === 'function'
      );
      expect(fnCall).toBeDefined();
      if (fnCall) {
        const result = (fnCall[0] as (imgs: MockImage[]) => MockImage[])(
          images
        );
        expect(result[0].segmentationStatus).toBe('processing');
      }
    });

    it('normalises "segmented" status to "completed"', async () => {
      const images = [makeImage({ segmentationStatus: 'pending' }, 'img-1')];
      const projectData = wireHooks(
        images,
        {},
        {
          lastUpdate: {
            imageId: 'img-1',
            status: 'segmented',
            projectId: 'proj-1',
            timestamp: Date.now(),
          },
          queueStats: {
            total: 0,
            queued: 0,
            processing: 0,
            completed: 0,
            failed: 0,
          },
        }
      );
      renderPage();

      await act(async () => {
        await new Promise(r => setTimeout(r, 200));
      });

      const fnCall = projectData.updateImages.mock.calls.find(
        ([arg]) => typeof arg === 'function'
      );
      expect(fnCall).toBeDefined();
      if (fnCall) {
        const result = (fnCall[0] as (imgs: MockImage[]) => MockImage[])(
          images
        );
        expect(result[0].segmentationStatus).toBe('completed');
      }
    });

    it('clears the result when a completed image is re-queued', async () => {
      const images = [
        makeImage(
          {
            segmentationStatus: 'completed',
            segmentationResult: { polygons: [] },
            segmentationData: { some: 'data' },
          },
          'img-1'
        ),
      ];
      const projectData = wireHooks(
        images,
        {},
        {
          lastUpdate: {
            imageId: 'img-1',
            status: 'queued',
            projectId: 'proj-1',
            timestamp: Date.now(),
          },
          queueStats: {
            total: 1,
            queued: 1,
            processing: 0,
            completed: 0,
            failed: 0,
          },
        }
      );
      renderPage();

      await act(async () => {
        await new Promise(r => setTimeout(r, 200));
      });

      const fnCall = projectData.updateImages.mock.calls.find(
        ([arg]) => typeof arg === 'function'
      );
      expect(fnCall).toBeDefined();
      if (fnCall) {
        const result = (fnCall[0] as (imgs: MockImage[]) => MockImage[])(
          images
        );
        expect(result[0].segmentationResult).toBeUndefined();
        expect(result[0].segmentationData).toBeUndefined();
      }
    });
  });

  // =========================================================================
  // WebSocket — single-image cancel (handleSegmentationCancelled)
  // =========================================================================

  describe('handleSegmentationCancelled', () => {
    it('resets the image to no_segmentation and clears thumbnails', async () => {
      const images = [
        makeImage(
          {
            segmentationStatus: 'processing',
            segmentationThumbnailPath: '/thumb/path.jpg',
            segmentationThumbnailUrl: '/thumb/url.jpg',
          },
          'img-1'
        ),
      ];
      const captureRef: Parameters<typeof wireHooksCapturingCallbacks>[1] = {};
      const projectData = wireHooksCapturingCallbacks(images, captureRef);
      renderPage();

      await waitFor(() => expect(captureRef.onCancelled).toBeDefined());
      act(() => captureRef.onCancelled!({ imageId: 'img-1' }));

      await waitFor(() => expect(projectData.updateImages).toHaveBeenCalled());
      const fnCall = projectData.updateImages.mock.calls.find(
        ([arg]) => typeof arg === 'function'
      );
      expect(fnCall).toBeDefined();
      if (fnCall) {
        const result = (fnCall[0] as (imgs: MockImage[]) => MockImage[])(
          images
        );
        expect(result[0].segmentationStatus).toBe('no_segmentation');
        expect(result[0].segmentationThumbnailPath).toBeUndefined();
        expect(result[0].segmentationThumbnailUrl).toBeUndefined();
      }
    });

    it('no-ops when imageId is undefined', async () => {
      const images = [makeImage({}, 'img-1')];
      const captureRef: Parameters<typeof wireHooksCapturingCallbacks>[1] = {};
      const projectData = wireHooksCapturingCallbacks(images, captureRef);
      renderPage();

      await waitFor(() => expect(captureRef.onCancelled).toBeDefined());
      act(() => captureRef.onCancelled!({ imageId: undefined }));

      await new Promise(r => setTimeout(r, 50));
      expect(projectData.updateImages).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // WebSocket — bulk cancel (handleBulkSegmentationCancelled)
  // =========================================================================

  describe('handleBulkSegmentationCancelled', () => {
    it('refetches and updates images when the current project is affected', async () => {
      const images = [makeImage({ segmentationStatus: 'processing' }, 'img-1')];
      const captureRef: Parameters<typeof wireHooksCapturingCallbacks>[1] = {};
      const projectData = wireHooksCapturingCallbacks(images, captureRef);

      mockGetProjectImages.mockResolvedValue({
        images: [
          {
            id: 'img-1',
            name: 'Image img-1',
            url: '/images/img-1.png',
            thumbnail_url: '/thumbs/img-1.jpg',
            created_at: '2026-01-01T00:00:00Z',
            updatedAt: '2026-01-01T00:00:00Z',
            segmentationStatus: 'no_segmentation',
          },
        ],
        total: 1,
      });

      renderPage();
      await waitFor(() => expect(captureRef.onBulkCancelled).toBeDefined());

      await act(async () => {
        await captureRef.onBulkCancelled!({
          cancelledCount: 1,
          affectedProjects: ['proj-1'],
        });
      });

      await waitFor(() =>
        expect(mockGetProjectImages).toHaveBeenCalledWith(
          'proj-1',
          expect.anything()
        )
      );
      expect(projectData.updateImages).toHaveBeenCalled();
    });

    it('does NOT refetch when the current project is not affected', async () => {
      const images = [makeImage({}, 'img-1')];
      const captureRef: Parameters<typeof wireHooksCapturingCallbacks>[1] = {};
      wireHooksCapturingCallbacks(images, captureRef);

      renderPage();
      await waitFor(() => expect(captureRef.onBulkCancelled).toBeDefined());

      await act(async () => {
        await captureRef.onBulkCancelled!({
          cancelledCount: 1,
          affectedProjects: ['OTHER-PROJECT'],
        });
      });

      await new Promise(r => setTimeout(r, 50));
      expect(mockGetProjectImages).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // WebSocket — batch completed (handleBatchCompleted)
  // =========================================================================

  describe('handleBatchCompleted', () => {
    it('refetches, normalises segmented→completed, and updates images', async () => {
      const images = [makeImage({ segmentationStatus: 'processing' }, 'img-1')];
      const captureRef: Parameters<typeof wireHooksCapturingCallbacks>[1] = {};
      const projectData = wireHooksCapturingCallbacks(images, captureRef);

      mockGetProjectImages.mockResolvedValue({
        images: [
          {
            id: 'img-1',
            name: 'Image img-1',
            url: '/images/img-1.png',
            thumbnail_url: '/thumbs/img-1.jpg',
            created_at: '2026-01-01T00:00:00Z',
            updatedAt: '2026-01-01T00:00:00Z',
            segmentationStatus: 'segmented',
          },
        ],
        total: 1,
      });

      renderPage();
      await waitFor(() => expect(captureRef.onBatchCompleted).toBeDefined());

      await act(async () => {
        await captureRef.onBatchCompleted!();
      });

      await waitFor(() =>
        expect(mockGetProjectImages).toHaveBeenCalledWith(
          'proj-1',
          expect.anything()
        )
      );
      expect(projectData.updateImages).toHaveBeenCalled();

      const arrCall = projectData.updateImages.mock.calls.find(([arg]) =>
        Array.isArray(arg)
      );
      if (arrCall) {
        const imgs = arrCall[0] as Array<{ segmentationStatus: string }>;
        expect(imgs[0].segmentationStatus).toBe('completed');
      }
    });

    it('stops paginating once the first page covers all items', async () => {
      const images = [makeImage({}, 'img-1')];
      const captureRef: Parameters<typeof wireHooksCapturingCallbacks>[1] = {};
      wireHooksCapturingCallbacks(images, captureRef);

      // total=5, limit=50 → a single page is enough
      mockGetProjectImages.mockResolvedValue({
        images: Array.from({ length: 5 }, (_, i) => ({
          id: `img-${i}`,
          name: `Image ${i}`,
          url: `/images/${i}.png`,
          thumbnail_url: `/thumbs/${i}.jpg`,
          created_at: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
          segmentationStatus: 'completed',
        })),
        total: 5,
      });

      renderPage();
      await waitFor(() => expect(captureRef.onBatchCompleted).toBeDefined());

      await act(async () => {
        await captureRef.onBatchCompleted!();
      });

      await waitFor(() => expect(mockGetProjectImages).toHaveBeenCalled());
      expect(mockGetProjectImages).toHaveBeenCalledTimes(1);
    });
  });

  // =========================================================================
  // Upload completion (merge logic)
  // =========================================================================

  describe('handleUploadComplete', () => {
    it('refetches, fires project-images-updated, and updates images', async () => {
      const projectData = wireHooks([makeImage({}, 'img-1')]);

      mockGetProjectImages.mockResolvedValue({
        images: [
          {
            id: 'img-1',
            name: 'Image img-1',
            url: '/images/img-1.png',
            thumbnail_url: '/thumbs/img-1.jpg',
            created_at: '2026-01-01T00:00:00Z',
            updatedAt: '2026-01-01T00:00:00Z',
            segmentationStatus: 'no_segmentation',
          },
          {
            id: 'img-2',
            name: 'Image img-2',
            url: '/images/img-2.png',
            thumbnail_url: '/thumbs/img-2.jpg',
            created_at: '2026-01-01T00:00:00Z',
            updatedAt: '2026-01-01T00:00:00Z',
            segmentationStatus: 'no_segmentation',
          },
        ],
        total: 2,
      });

      const dispatchedEvents: CustomEvent[] = [];
      const handler = (e: Event) => dispatchedEvents.push(e as CustomEvent);
      window.addEventListener('project-images-updated', handler);

      renderPage();

      await userEvent.click(screen.getByTestId('toggle-uploader'));
      await userEvent.click(screen.getByTestId('upload-complete'));

      await waitFor(() => {
        expect(mockGetProjectImages).toHaveBeenCalledWith(
          'proj-1',
          expect.anything()
        );
        expect(projectData.updateImages).toHaveBeenCalled();
      });

      await waitFor(() => expect(dispatchedEvents.length).toBeGreaterThan(0));
      expect(dispatchedEvents[0].detail.projectId).toBe('proj-1');
      expect(dispatchedEvents[0].detail.imageCount).toBe(2);

      window.removeEventListener('project-images-updated', handler);
    });

    it('preserves an existing segmentationResult when merging refetched images', async () => {
      const existingResult = { polygons: [{ id: 'poly-1', points: [] }] };
      const images = [
        makeImage(
          {
            segmentationStatus: 'completed',
            segmentationResult: existingResult,
          },
          'img-1'
        ),
      ];
      const projectData = wireHooks(images);

      // Backend returns the image without its segmentationResult
      mockGetProjectImages.mockResolvedValue({
        images: [
          {
            id: 'img-1',
            name: 'Image img-1',
            url: '/images/img-1.png',
            thumbnail_url: '/thumbs/img-1.jpg',
            created_at: '2026-01-01T00:00:00Z',
            updatedAt: '2026-01-01T00:00:00Z',
            segmentationStatus: 'completed',
          },
        ],
        total: 1,
      });

      renderPage();
      await userEvent.click(screen.getByTestId('toggle-uploader'));
      await userEvent.click(screen.getByTestId('upload-complete'));

      await waitFor(() => expect(projectData.updateImages).toHaveBeenCalled());
      const fnCall = projectData.updateImages.mock.calls.find(
        ([arg]) => typeof arg === 'function'
      );
      expect(fnCall).toBeDefined();
      if (fnCall) {
        const result = (fnCall[0] as (imgs: MockImage[]) => MockImage[])(
          images
        );
        expect(result[0].segmentationResult).toEqual(existingResult);
      }
    });

    it('normalises "segmented" status to "completed" in merged images', async () => {
      const images: MockImage[] = [];
      const projectData = wireHooks(images);

      mockGetProjectImages.mockResolvedValue({
        images: [
          {
            id: 'img-new',
            name: 'Image img-new',
            url: '/images/img-new.png',
            thumbnail_url: '/thumbs/img-new.jpg',
            created_at: '2026-01-01T00:00:00Z',
            updatedAt: '2026-01-01T00:00:00Z',
            segmentation_status: 'segmented', // legacy field name
          },
        ],
        total: 1,
      });

      renderPage();
      await userEvent.click(screen.getByTestId('toggle-uploader'));
      await userEvent.click(screen.getByTestId('upload-complete'));

      await waitFor(() => expect(projectData.updateImages).toHaveBeenCalled());
      const fnCall = projectData.updateImages.mock.calls.find(
        ([arg]) => typeof arg === 'function'
      );
      expect(fnCall).toBeDefined();
      if (fnCall) {
        const result = (fnCall[0] as (imgs: MockImage[]) => MockImage[])(
          images
        );
        expect(result[0].segmentationStatus).toBe('completed');
      }
    });

    it('shows toast.error when the refetch fails', async () => {
      wireHooks([]);
      mockGetProjectImages.mockRejectedValue(new Error('network error'));

      renderPage();
      await userEvent.click(screen.getByTestId('toggle-uploader'));
      await userEvent.click(screen.getByTestId('upload-complete'));

      await waitFor(() =>
        expect(toast.error).toHaveBeenCalledWith('toast.upload.failed')
      );
    });
  });
});
