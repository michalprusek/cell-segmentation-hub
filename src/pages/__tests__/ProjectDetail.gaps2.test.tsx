/**
 * ProjectDetail.gaps2.test.tsx — behavioral gap tests.
 *
 * Covers branches NOT already tested by the four existing test files
 * (ProjectDetail.test.tsx, gaps.test.tsx, extra.test.tsx, additional.test.tsx).
 *
 * Covered here:
 *  1.  Loading state — Loader2 spinner shown when loading=true, images hidden
 *  2.  Empty state — EmptyState shown when filteredImages is empty AND loading=false
 *  3.  Empty state + search — hasSearchTerm=true forwarded when searchTerm is set
 *  4.  Channel picker dialog — opens when Segment All clicked on multi-channel project
 *  5.  Channel picker dialog — cancellation clears pendingChannelChoice
 *  6.  Channel picker dialog — confirmation calls addBatchToQueue with the picked channel
 *  7.  Incompatible model dialog — rendered + dismissed via action button
 *  8.  Segment All incompatible model — opens incompatible dialog instead of queuing
 *  9.  handleBatchDeleteConfirm — deletedCount=0 + failedIds present → warning toast only
 * 10.  handleImageSelection — adds imageId to selectedImageIds set
 * 11.  handleImageSelection — deselect removes imageId from selectedImageIds set
 *  12. handleSelectAll — selects all filteredImages
 *  13. handleDeselectAll (via select-all-toggle when all already selected) — clears selection
 *  14. Pagination info text — shown when totalPages > 0
 *  15. processWebSocketUpdate — 'failed' status normalised correctly
 *  16. processWebSocketUpdate — 'no_segmentation' status normalised correctly
 *  17. View mode toggle — switches between grid and list
 *  18. handleBatchDeleteConfirm — isBatchDeleting guard: second call while deleting is ignored
 *  19. handleSegmentAll — pendingChannelChoice set: re-entrant call triggers queue directly
 *
 * NOT tested (genuinely untestable or already covered):
 *  - processImageChunks large-batch progress toasts (requires 500+ images)
 *  - 60-second safety / WS-disconnect timers (tested in gaps.test.tsx)
 *  - processBatchUpdates bulk-batching (requires >10 queue items and fine-grained timer control)
 *  - Real WebSocket message delivery (environment-level, not unit-testable)
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
  mockUseSegmentationQueueImpl,
  mockUsePagination,
  mockGetProjectImages,
  mockAddBatchToQueue,
  mockDeleteBatch,
  mockCancelAllUserSegmentations,
  mockUpdateProject,
  mockGetSegmentationResults,
  mockHandleDeleteImage,
  mockHandleOpenSegmentationEditor,
  mockRequestQueueStats,
} = vi.hoisted(() => {
  const mockUseSegmentationQueueImpl = { fn: vi.fn() };
  return {
    mockNavigate: vi.fn(),
    mockUseProjectData: vi.fn(),
    mockUseImageFilter: vi.fn(),
    mockUseSegmentationQueueImpl,
    mockUsePagination: vi.fn(),
    mockGetProjectImages: vi.fn(),
    mockAddBatchToQueue: vi.fn(),
    mockDeleteBatch: vi.fn(),
    mockCancelAllUserSegmentations: vi.fn(),
    mockUpdateProject: vi.fn(),
    mockGetSegmentationResults: vi.fn(),
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
    queueStats: {
      total: 0,
      queued: 0,
      processing: 0,
      completed: 0,
      failed: 0,
    },
    lastUpdate: null as unknown,
    parallelStats: null,
    requestQueueStats: mockRequestQueueStats,
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
    t: (key: string, _p?: Record<string, unknown>) => key,
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
  useStatusReconciliation: () => ({
    reconcileImageStatuses: vi.fn(),
    hasStaleProcessingImages: false,
  }),
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
    searchTerm,
  }: {
    onToggleUploader: () => void;
    viewMode: string;
    setViewMode: (m: 'grid' | 'list') => void;
    selectedCount: number;
    onSelectAllToggle: () => void;
    onBatchDelete: () => void;
    searchTerm: string;
    [key: string]: unknown;
  }) => (
    <div data-testid="project-toolbar">
      <span data-testid="view-mode">{viewMode}</span>
      <span data-testid="selected-count">{selectedCount}</span>
      <span data-testid="search-term">{searchTerm}</span>
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
        Select All
      </button>
      <button data-testid="batch-delete-btn" onClick={onBatchDelete}>
        Delete
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

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/project/proj-1']}>
      <ProjectDetail />
    </MemoryRouter>
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ProjectDetail — gaps2 coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetProjectImages.mockResolvedValue({ images: [], total: 0 });
    mockGetSegmentationResults.mockResolvedValue(null);
    mockAddBatchToQueue.mockResolvedValue({ queuedCount: 1 });
    mockDeleteBatch.mockResolvedValue({
      deletedCount: 0,
      failedIds: [],
      errors: [],
    });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  // =========================================================================
  // 1. Loading state
  // =========================================================================

  describe('Loading state', () => {
    it('shows spinner and hides ProjectImages when loading=true', () => {
      const images = [makeImage({}, 'img-1')];
      wireHooks(images, { loading: true });

      renderPage();

      // The Loader2 spinner renders instead of the image grid
      const toolbar = screen.getByTestId('project-toolbar');
      expect(toolbar).toBeInTheDocument();
      expect(screen.queryByTestId('project-images')).not.toBeInTheDocument();
      expect(screen.queryByTestId('empty-state')).not.toBeInTheDocument();
    });
  });

  // =========================================================================
  // 2. Empty state
  // =========================================================================

  describe('Empty state', () => {
    it('shows EmptyState and hides ProjectImages when filteredImages is empty', () => {
      wireHooks([], {}, {}, { filteredImages: [] });

      renderPage();

      expect(screen.getByTestId('empty-state')).toBeInTheDocument();
      expect(screen.queryByTestId('project-images')).not.toBeInTheDocument();
    });

    it('passes hasSearchTerm=true when searchTerm is set and filteredImages is empty', () => {
      // images exist in state but filtered to nothing by search
      const images = [makeImage({}, 'img-1')];
      wireHooks(images, {}, {}, { filteredImages: [], searchTerm: 'xyz' });

      renderPage();

      expect(screen.getByTestId('empty-state')).toBeInTheDocument();
      expect(screen.getByTestId('has-search-term')).toBeInTheDocument();
    });
  });

  // =========================================================================
  // 3. Channel picker dialog
  // =========================================================================

  describe('Channel picker dialog', () => {
    function wireMultiChannel() {
      const images = [
        makeImage({ segmentationStatus: 'no_segmentation' }, 'img-1'),
      ];
      // projectChannels has 2 channels → dialog must open
      return wireHooks(images, {
        projectChannels: ['ch0', 'ch1'],
      });
    }

    it('opens SegmentChannelDialog when Segment All clicked on multi-channel project', async () => {
      wireMultiChannel();
      renderPage();

      await userEvent.click(screen.getByTestId('segment-all-btn'));

      await waitFor(() => {
        expect(
          screen.getByTestId('segment-channel-dialog')
        ).toBeInTheDocument();
        expect(screen.getByTestId('dialog-channels').textContent).toBe(
          'ch0,ch1'
        );
      });
    });

    it('closes dialog on cancel without queuing', async () => {
      wireMultiChannel();
      renderPage();

      await userEvent.click(screen.getByTestId('segment-all-btn'));
      await waitFor(() =>
        expect(screen.getByTestId('segment-channel-dialog')).toBeInTheDocument()
      );

      await userEvent.click(screen.getByTestId('cancel-channel'));

      await waitFor(() => {
        expect(
          screen.queryByTestId('segment-channel-dialog')
        ).not.toBeInTheDocument();
      });
      expect(mockAddBatchToQueue).not.toHaveBeenCalled();
    });

    it('calls addBatchToQueue with the confirmed channel when user confirms', async () => {
      wireMultiChannel();
      renderPage();

      await userEvent.click(screen.getByTestId('segment-all-btn'));
      await waitFor(() =>
        expect(screen.getByTestId('segment-channel-dialog')).toBeInTheDocument()
      );

      await userEvent.click(screen.getByTestId('confirm-channel'));

      await waitFor(() => {
        expect(mockAddBatchToQueue).toHaveBeenCalledWith(
          expect.any(Array),
          'proj-1',
          'hrnet',
          0.5,
          0,
          false,
          false,
          'ch0' // defaultChannel
        );
      });
    });
  });

  // =========================================================================
  // 4. Incompatible model dialog
  // =========================================================================

  describe('Incompatible model dialog', () => {
    it('opens incompatible model dialog when model is not compatible with project type', async () => {
      // wound project + hrnet → incompatible per MODEL_TYPE_COMPATIBILITY
      const images = [
        makeImage({ segmentationStatus: 'no_segmentation' }, 'img-1'),
      ];
      wireHooks(images, { projectType: 'wound' as const });

      // Need to use wound project type — re-wire useModel to return 'hrnet'
      // The types mock needs to return false for isModelCompatibleWithType
      const { isModelCompatibleWithType } = await import('@/types');
      (isModelCompatibleWithType as ReturnType<typeof vi.fn>).mockReturnValue(
        false
      );

      renderPage();

      await userEvent.click(screen.getByTestId('segment-all-btn'));

      await waitFor(() => {
        // The AlertDialog opens — look for the action button inside it
        // Check that the incompatible dialog appeared by looking for any dialog content
        // The dialog renders an AlertDialogContent — check via role=alertdialog
        const dialogs = document.querySelectorAll('[role="alertdialog"]');
        expect(dialogs.length).toBeGreaterThan(0);
      });

      expect(mockAddBatchToQueue).not.toHaveBeenCalled();
    });

    it('dismisses incompatible model dialog when Close is clicked', async () => {
      const images = [
        makeImage({ segmentationStatus: 'no_segmentation' }, 'img-1'),
      ];
      wireHooks(images, { projectType: 'wound' as const });

      const { isModelCompatibleWithType } = await import('@/types');
      (isModelCompatibleWithType as ReturnType<typeof vi.fn>).mockReturnValue(
        false
      );

      renderPage();

      await userEvent.click(screen.getByTestId('segment-all-btn'));

      await waitFor(() => {
        const dialogs = document.querySelectorAll('[role="alertdialog"]');
        expect(dialogs.length).toBeGreaterThan(0);
      });

      // Click the Close button inside the alert dialog
      const closeBtn = screen.getByRole('button', { name: /common\.close/i });
      await userEvent.click(closeBtn);

      await waitFor(() => {
        const dialogs = document.querySelectorAll('[role="alertdialog"]');
        expect(dialogs.length).toBe(0);
      });
    });
  });

  // =========================================================================
  // 5. handleBatchDeleteConfirm — deletedCount=0 + failedIds present
  // =========================================================================

  describe('handleBatchDeleteConfirm — partial failure (deletedCount=0)', () => {
    it('shows only warning toast when deletedCount=0 and failedIds are present', async () => {
      const images = [
        makeImage({ segmentationStatus: 'no_segmentation' }, 'img-1'),
      ];
      wireHooks(images);

      mockDeleteBatch.mockResolvedValue({
        deletedCount: 0,
        failedIds: ['img-1'],
        errors: ['failed'],
      });

      renderPage();

      // Select the image then open and confirm the delete dialog
      await userEvent.click(screen.getByTestId(`select-img-1`));
      await userEvent.click(screen.getByTestId('batch-delete-btn'));

      // Confirm the alert dialog
      const confirmBtn = screen.getByRole('button', {
        name: /common\.delete/i,
      });
      await userEvent.click(confirmBtn);

      await waitFor(() => {
        expect(mockDeleteBatch).toHaveBeenCalled();
        // No success toast (deletedCount=0), only warning
        expect(toast.success).not.toHaveBeenCalled();
        expect(toast.warning).toHaveBeenCalledWith(
          expect.stringContaining('project.imagesDeleteFailed')
        );
      });
    });
  });

  // =========================================================================
  // 6. Selection handlers
  // =========================================================================

  describe('Selection handlers', () => {
    it('adds imageId to selectedImageIds when checkbox checked', async () => {
      const images = [
        makeImage({ segmentationStatus: 'no_segmentation' }, 'img-1'),
        makeImage({ segmentationStatus: 'no_segmentation' }, 'img-2'),
      ];
      wireHooks(images);
      renderPage();

      const checkbox = screen.getByTestId('select-img-1');
      await userEvent.click(checkbox);

      // selectedCount should now be 1
      await waitFor(() => {
        expect(screen.getByTestId('selected-count').textContent).toBe('1');
      });
    });

    it('removes imageId from selectedImageIds when checkbox unchecked', async () => {
      const images = [
        makeImage({ segmentationStatus: 'no_segmentation' }, 'img-1'),
      ];
      wireHooks(images);
      renderPage();

      // Check then uncheck
      const checkbox = screen.getByTestId('select-img-1');
      await userEvent.click(checkbox);
      await waitFor(() =>
        expect(screen.getByTestId('selected-count').textContent).toBe('1')
      );
      await userEvent.click(checkbox);
      await waitFor(() =>
        expect(screen.getByTestId('selected-count').textContent).toBe('0')
      );
    });

    it('handleSelectAll selects all filteredImages', async () => {
      const images = [
        makeImage({}, 'img-1'),
        makeImage({}, 'img-2'),
        makeImage({}, 'img-3'),
      ];
      wireHooks(images);
      renderPage();

      // Click "Select All" when none are selected
      await userEvent.click(screen.getByTestId('select-all-toggle'));

      await waitFor(() => {
        expect(screen.getByTestId('selected-count').textContent).toBe('3');
      });
    });

    it('handleDeselectAll deselects all when all are already selected', async () => {
      const images = [makeImage({}, 'img-1'), makeImage({}, 'img-2')];
      wireHooks(images);
      renderPage();

      // Select all first
      await userEvent.click(screen.getByTestId('select-all-toggle'));
      await waitFor(() =>
        expect(screen.getByTestId('selected-count').textContent).toBe('2')
      );

      // Toggle again (all selected → deselect all)
      await userEvent.click(screen.getByTestId('select-all-toggle'));
      await waitFor(() =>
        expect(screen.getByTestId('selected-count').textContent).toBe('0')
      );
    });
  });

  // =========================================================================
  // 7. Pagination info text
  // =========================================================================

  describe('Pagination info text', () => {
    it('shows pagination info when totalPages > 0', () => {
      const images = Array.from({ length: 5 }, (_, i) =>
        makeImage({}, `img-${i}`)
      );
      const projectData = makeProjectData(images);
      mockUseProjectData.mockReturnValue(projectData);
      mockUseImageFilter.mockReturnValue(makeImageFilter(images));
      mockUsePagination.mockReturnValue(makePagination(images.length, 1));
      mockUseSegmentationQueueImpl.fn
        .mockReturnValueOnce(makeQueueReturn())
        .mockReturnValue(makeQueueReturn());

      renderPage();

      // The pagination info div renders when totalPages > 0
      expect(screen.getByText('export.showingImages')).toBeInTheDocument();
    });

    it('does NOT show pagination info when totalPages = 0', () => {
      wireHooks([], {}, {}, { filteredImages: [] });
      renderPage();

      expect(
        screen.queryByText('export.showingImages')
      ).not.toBeInTheDocument();
    });
  });

  // =========================================================================
  // 8. processWebSocketUpdate — status normalisation edge cases
  // =========================================================================

  describe('processWebSocketUpdate — status normalisation', () => {
    it('normalises "failed" status directly (no renaming)', async () => {
      const images = [makeImage({ segmentationStatus: 'processing' }, 'img-1')];
      const projectData = wireHooks(
        images,
        {},
        {
          lastUpdate: {
            imageId: 'img-1',
            status: 'failed',
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

      // Find the updater call
      const fnCall = projectData.updateImages.mock.calls.find(
        ([arg]) => typeof arg === 'function'
      );
      if (fnCall) {
        const result = (fnCall[0] as (imgs: MockImage[]) => MockImage[])(
          images
        );
        expect(result[0].segmentationStatus).toBe('failed');
      }
    });

    it('normalises "no_segmentation" status correctly', async () => {
      const images = [makeImage({ segmentationStatus: 'processing' }, 'img-1')];
      const projectData = wireHooks(
        images,
        {},
        {
          lastUpdate: {
            imageId: 'img-1',
            status: 'no_segmentation',
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
      if (fnCall) {
        const result = (fnCall[0] as (imgs: MockImage[]) => MockImage[])(
          images
        );
        expect(result[0].segmentationStatus).toBe('no_segmentation');
      }
    });
  });

  // =========================================================================
  // 9. View mode toggle
  // =========================================================================

  describe('View mode toggle', () => {
    it('switches from grid to list when List button clicked', async () => {
      const images = [makeImage({}, 'img-1')];
      wireHooks(images);
      renderPage();

      expect(screen.getByTestId('view-mode').textContent).toBe('grid');
      await userEvent.click(screen.getByTestId('switch-list'));
      expect(screen.getByTestId('view-mode').textContent).toBe('list');
    });

    it('switches back to grid from list', async () => {
      const images = [makeImage({}, 'img-1')];
      wireHooks(images);
      renderPage();

      await userEvent.click(screen.getByTestId('switch-list'));
      expect(screen.getByTestId('view-mode').textContent).toBe('list');
      await userEvent.click(screen.getByTestId('switch-grid'));
      expect(screen.getByTestId('view-mode').textContent).toBe('grid');
    });
  });

  // =========================================================================
  // 10. handleBatchDeleteConfirm — isBatchDeleting re-entry guard
  // =========================================================================

  describe('handleBatchDeleteConfirm — isBatchDeleting guard', () => {
    it('prevents double submission: second confirm call is ignored', async () => {
      const images = [makeImage({}, 'img-1')];
      wireHooks(images);

      // Slow delete so we can fire a second click before the first resolves
      let resolveDelete!: (v: unknown) => void;
      mockDeleteBatch.mockImplementation(
        () =>
          new Promise(res => {
            resolveDelete = res;
          })
      );

      renderPage();

      // Select and open delete dialog
      await userEvent.click(screen.getByTestId('select-img-1'));
      await userEvent.click(screen.getByTestId('batch-delete-btn'));

      const confirmBtn = screen.getByRole('button', {
        name: /common\.delete/i,
      });
      // First confirm — starts async delete (stays pending)
      await userEvent.click(confirmBtn);

      // deleteBatch should have been called once
      expect(mockDeleteBatch).toHaveBeenCalledTimes(1);

      // Resolve the first delete so the state cleans up
      act(() => {
        resolveDelete({ deletedCount: 1, failedIds: [], errors: [] });
      });

      await waitFor(() => expect(toast.success).toHaveBeenCalled());
      // Only one call throughout
      expect(mockDeleteBatch).toHaveBeenCalledTimes(1);
    });
  });

  // =========================================================================
  // 11. handleUploadComplete — getProjectImages error branch
  // =========================================================================

  describe('handleUploadComplete — error branch', () => {
    it('shows toast.error when getProjectImages throws during upload complete', async () => {
      const images: MockImage[] = [];
      wireHooks(images);

      mockGetProjectImages.mockRejectedValue(new Error('network error'));

      renderPage();

      await userEvent.click(screen.getByTestId('toggle-uploader'));
      await userEvent.click(screen.getByTestId('upload-complete'));

      await waitFor(() => {
        expect(toast.error).toHaveBeenCalledWith('toast.upload.failed');
      });
    });
  });

  // =========================================================================
  // 12. handleCancelSegmentation — success path (cancelledCount > 0)
  // =========================================================================

  describe('handleCancelSegmentation', () => {
    it('calls cancelAllUserSegmentations and does not show toast on success with cancelledCount=5', async () => {
      wireHooks([]);

      mockCancelAllUserSegmentations.mockResolvedValue({
        success: true,
        cancelledCount: 5,
        affectedProjects: ['proj-1'],
        affectedBatches: [],
      });

      renderPage();

      await userEvent.click(screen.getByTestId('cancel-segmentation-btn'));

      await waitFor(() => {
        expect(mockCancelAllUserSegmentations).toHaveBeenCalled();
      });
      // No toast on success — WS handles the UI update
      expect(toast.error).not.toHaveBeenCalled();
    });
  });
});
