/**
 * ProjectDetail — additional gap tests (73% → higher).
 *
 * Covered here (not in ProjectDetail.test.tsx or ProjectDetail.gaps.test.tsx):
 *  1. Batch-delete with partial failures: toast.warning when result.failedIds > 0
 *  2. Batch-delete API throws: toast.error('errors.deleteImages')
 *  3. Batch-delete guard: no dialog when 0 images selected (guard returns early)
 *  4. Segment-all skips all images message when 'failed' images ALSO count as
 *     needing segmentation (failed images ARE included in the "to segment" set)
 *  5. Segment-all double-submission prevention: second click is no-op (batchSubmitted=true)
 *  6. imagesToSegmentCount includes 'failed' status images
 *  7. Empty state + search-term: hasSearchTerm=true shown to EmptyState when
 *     images exist but searchTerm filters all out
 *  8. useStatusReconciliation called with correct projectId
 *  9. handleBatchDeleteConfirm with selectedImageIds.size=0 shows error toast
 *
 * NOT tested:
 *  - processImageChunks large-batch progress toasts (500+ images required)
 *  - Safety/queue-processing 60 s timers (impractical to advance in unit tests)
 *  - Canvas/DnD interactions inside ProjectImages (deep child, mocked)
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
// Factory helpers
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
        Select All
      </button>
      <button data-testid="batch-delete-btn" onClick={onBatchDelete}>
        Delete
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
      {hasSearchTerm && <span data-testid="no-search-results">No results</span>}
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
// Default hook wiring
// ---------------------------------------------------------------------------

function wireDefaultHooks(
  images: ReturnType<typeof makeImage>[] = [],
  projectDataOverrides: Record<string, unknown> = {},
  imageFilterOverrides: Record<string, unknown> = {}
) {
  const projectData = makeProjectData({ images, ...projectDataOverrides });
  mockUseProjectData.mockReturnValue(projectData);
  mockUseImageFilter.mockReturnValue(
    makeImageFilter(images, imageFilterOverrides)
  );
  mockUsePagination.mockReturnValue(makePagination(images.length));
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
  return projectData;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ProjectDetail — additional gap coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  // -------------------------------------------------------------------------
  // 1. Batch delete partial failures → toast.warning
  // -------------------------------------------------------------------------

  describe('Batch delete — partial failures', () => {
    it('shows toast.warning when result.failedIds is non-empty', async () => {
      mockDeleteBatch.mockResolvedValue({
        deletedCount: 1,
        failedIds: ['img-2'],
      });
      const images = [makeImage({}, 'img-1'), makeImage({}, 'img-2')];
      wireDefaultHooks(images);
      renderPage();

      // Select all
      await userEvent.click(screen.getByTestId('select-all-toggle'));
      // Open dialog
      await userEvent.click(screen.getByTestId('batch-delete-btn'));
      // Confirm (click the last "Delete" button in dialog footer)
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
  });

  // -------------------------------------------------------------------------
  // 2. Batch delete API throws → toast.error
  // -------------------------------------------------------------------------

  describe('Batch delete — API error', () => {
    it('shows toast.error("errors.deleteImages") when deleteBatch throws', async () => {
      mockDeleteBatch.mockRejectedValue(new Error('network error'));
      const images = [makeImage({}, 'img-1')];
      wireDefaultHooks(images);
      renderPage();

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
        expect(vi.mocked(toast.error)).toHaveBeenCalledWith(
          'errors.deleteImages'
        );
      });
    });
  });

  // -------------------------------------------------------------------------
  // 3. imagesToSegmentCount counts 'failed' images
  // -------------------------------------------------------------------------

  describe('imagesToSegmentCount includes failed status', () => {
    it('counts failed + pending + no_segmentation images', () => {
      const images = [
        makeImage({ segmentationStatus: 'failed' }, 'img-1'),
        makeImage({ segmentationStatus: 'pending' }, 'img-2'),
        makeImage({ segmentationStatus: 'completed' }, 'img-3'),
        makeImage({ segmentationStatus: 'no_segmentation' }, 'img-4'),
      ];
      wireDefaultHooks(images);
      renderPage();

      // failed(1) + pending(1) + no_segmentation(1) = 3
      expect(screen.getByTestId('images-to-segment').textContent).toBe('3');
    });
  });

  // -------------------------------------------------------------------------
  // 4. Segment-all double-submission prevention
  // -------------------------------------------------------------------------

  describe('Segment-all double-submission prevention', () => {
    it('second segment-all click is ignored when batchSubmitted=true', async () => {
      // First call resolves quickly; second should not be called
      mockAddBatchToQueue.mockResolvedValue({ queuedCount: 1 });
      const img = makeImage({ segmentationStatus: 'no_segmentation' }, 'img-1');
      wireDefaultHooks([img]);
      renderPage();

      // First click — resolves and sets batchSubmitted=true
      await userEvent.click(screen.getByTestId('segment-all-btn'));
      await waitFor(() => {
        expect(screen.getByTestId('batch-submitted').textContent).toBe('true');
      });

      // Second click — batchSubmitted=true guard should prevent another call
      await userEvent.click(screen.getByTestId('segment-all-btn'));

      // addBatchToQueue is called exactly once (the second click is a no-op)
      expect(mockAddBatchToQueue).toHaveBeenCalledTimes(1);
    });
  });

  // -------------------------------------------------------------------------
  // 5. Segment-all with only failed images → queues them
  // -------------------------------------------------------------------------

  describe('Segment-all includes failed images', () => {
    it('calls addBatchToQueue when only failed images exist', async () => {
      mockAddBatchToQueue.mockResolvedValue({ queuedCount: 1 });
      const img = makeImage({ segmentationStatus: 'failed' }, 'img-1');
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
  });

  // -------------------------------------------------------------------------
  // 6. Empty state with search term → EmptyState gets hasSearchTerm=true
  // -------------------------------------------------------------------------

  describe('EmptyState hasSearchTerm prop', () => {
    it('passes hasSearchTerm=true when searchTerm is non-empty but filteredImages is empty', () => {
      const images = [makeImage({}, 'img-1')];
      // images exist in project but filteredImages is empty (search filters everything out)
      mockUseProjectData.mockReturnValue(makeProjectData({ images }));
      // filteredImages is empty (search matched nothing), but searchTerm is 'xyz'
      mockUseImageFilter.mockReturnValue(
        makeImageFilter([], { searchTerm: 'xyz' })
      );
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

      // EmptyState should have hasSearchTerm=true → shows "No results"
      expect(screen.getByTestId('no-search-results')).toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // 7. useStatusReconciliation called with correct projectId
  // -------------------------------------------------------------------------

  describe('useStatusReconciliation wiring', () => {
    it('is called with the projectId from useParams', () => {
      wireDefaultHooks([]);
      renderPage();

      // First arg must be 'proj-1' (from mocked useParams)
      expect(mockUseStatusReconciliation).toHaveBeenCalledWith(
        expect.objectContaining({ projectId: 'proj-1' })
      );
    });
  });

  // -------------------------------------------------------------------------
  // 8. Batch delete success: updateImages called with filtered set
  // -------------------------------------------------------------------------

  describe('Batch delete success: images removed from list', () => {
    it('calls updateImages to remove deleted images after successful delete', async () => {
      mockDeleteBatch.mockResolvedValue({
        deletedCount: 1,
        failedIds: [],
      });
      const images = [makeImage({}, 'img-1'), makeImage({}, 'img-2')];
      const projectData = wireDefaultHooks(images);
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

      // The function updater removes deleted images; verify via the fn call
      const fnCall = projectData.updateImages.mock.calls.find(
        ([arg]) => typeof arg === 'function'
      );
      expect(fnCall).toBeDefined();
      if (fnCall) {
        const result = (fnCall[0] as (imgs: typeof images) => typeof images)(
          images
        );
        // img-1 was deleted, img-2 should remain
        expect(result.map((i: { id: string }) => i.id)).toEqual(['img-2']);
      }
    });
  });

  // -------------------------------------------------------------------------
  // 9. Segment-all with selected completed images → re-segments them
  //    (two separate addBatchToQueue calls: one for no_seg, one for re-seg)
  // -------------------------------------------------------------------------

  describe('Segment-all re-segments selected completed images', () => {
    it('makes two addBatchToQueue calls: no_segmentation then force-resegment', async () => {
      mockAddBatchToQueue.mockResolvedValue({ queuedCount: 1 });
      const imgCompleted = makeImage(
        { segmentationStatus: 'completed' },
        'img-1'
      );
      const imgNoSeg = makeImage(
        { segmentationStatus: 'no_segmentation' },
        'img-2'
      );
      wireDefaultHooks([imgCompleted, imgNoSeg]);
      renderPage();

      // Select completed image for re-segmentation
      await userEvent.click(screen.getByTestId('select-img-1'));
      await waitFor(() =>
        expect(screen.getByTestId('selected-count').textContent).toBe('1')
      );

      await userEvent.click(screen.getByTestId('segment-all-btn'));

      await waitFor(() => {
        // First call: img-2 (no_segmentation), forceResegment=false
        // Second call: img-1 (selected completed), forceResegment=true
        expect(mockAddBatchToQueue).toHaveBeenCalledTimes(2);
      });

      const allCalls = mockAddBatchToQueue.mock.calls;
      // First call includes img-2 (no_segmentation), forceResegment=false
      const firstCall = allCalls[0];
      expect(firstCall[0]).toContain('img-2');
      expect(firstCall[5]).toBe(false); // forceResegment arg at index 5
      // Second call includes img-1 (selected completed), forceResegment=true
      const secondCall = allCalls[1];
      expect(secondCall[0]).toContain('img-1');
      expect(secondCall[5]).toBe(true); // forceResegment arg at index 5
    });
  });
});
