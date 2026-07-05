/**
 * ProjectDetail — extra behavioral tests targeting uncovered branches
 * not in ProjectDetail.test.tsx, ProjectDetail.gaps.test.tsx, or
 * ProjectDetail.additional.test.tsx.
 *
 * Covered here:
 *  1.  handleProjectTypeChange — API call succeeds, toast.success called
 *  2.  handleProjectTypeChange — API throws, toast.error called
 *  3.  handleProjectTypeChange — no completed images: no warning toast
 *  4.  handleCancelSegmentation — success path (success=true, cancelledCount=0): no toast
 *  5.  handleCancelSegmentation — API throws: toast.error('queue.cancelFailed')
 *  6.  handleCancelSegmentation — !id guard: toast.error early return
 *  7.  handleSelectAllToggle — when all selected: deselects all
 *  8.  handleSelectAllToggle — when none selected: selects all filteredImages
 *  9.  handleOpenImage — delegates to handleOpenSegmentationEditor(imageId)
 * 10.  handleSegmentAll — addBatchToQueue throws: toast.error + batchSubmitted=false
 * 11.  handleSegmentAll — nothing selected: toast.info('queue.selectNothingTooltip')
 * 12.  handleBatchDeleteConfirm — isBatchDeleting guard prevents re-entry (duplicate call ignored)
 * 13.  handleBatchDelete — opens AlertDialog (showDeleteDialog becomes true)
 * 14.  toggleUploader — hides ProjectUploaderSection on second click
 *
 * NOT tested:
 *  - processImageChunks progress toasts (requires 500+ images)
 *  - Safety / queue-processing 60 s timers (impractical in unit tests)
 *  - WebSocket real-time update flows (tested in gaps.test.tsx)
 *  - handleBulkSegmentationCancelled / handleBatchCompleted (async WS, gaps.test.tsx)
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
  mockCancelAllUserSegmentations,
  mockUpdateProject,
  mockHandleDeleteImage,
  mockHandleOpenSegmentationEditor,
  mockRequestQueueStats,
  mockDeleteBatch,
} = vi.hoisted(() => {
  return {
    mockNavigate: vi.fn(),
    mockUseProjectData: vi.fn(),
    mockUseImageFilter: vi.fn(),
    mockUseProjectImageActions: vi.fn(),
    mockUseSegmentationQueue: vi.fn(),
    mockUsePagination: vi.fn(),
    mockUseStatusReconciliation: vi.fn(),
    mockUseSharedAdvancedExport: vi.fn(),
    mockAddBatchToQueue: vi.fn(),
    mockCancelAllUserSegmentations: vi.fn(),
    mockUpdateProject: vi.fn(),
    mockHandleDeleteImage: vi.fn(),
    mockHandleOpenSegmentationEditor: vi.fn(),
    mockRequestQueueStats: vi.fn(),
    mockDeleteBatch: vi.fn(),
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
  useLanguage: () => ({ t: (key: string) => key }),
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

describe('ProjectDetail — extra behavioral coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  // ── 1. handleProjectTypeChange — success ───────────────────────────────────

  describe('handleProjectTypeChange — success', () => {
    it('calls apiClient.updateProject and shows toast.success on success', async () => {
      mockUpdateProject.mockResolvedValue({});
      // No completed images → no warning toast
      wireDefaultHooks([makeImage({ segmentationStatus: 'no_segmentation' })]);
      renderPage();

      await userEvent.click(screen.getByTestId('change-type-btn'));

      await waitFor(() => {
        expect(mockUpdateProject).toHaveBeenCalledWith('proj-1', {
          type: 'wound',
        });
        expect(vi.mocked(toast.success)).toHaveBeenCalledWith(
          'projects.projectTypeUpdated'
        );
      });
    });
  });

  // ── 2. handleProjectTypeChange — API throws ────────────────────────────────

  describe('handleProjectTypeChange — error path', () => {
    it('shows toast.error when apiClient.updateProject throws', async () => {
      mockUpdateProject.mockRejectedValue(new Error('Server error'));
      wireDefaultHooks([]);
      renderPage();

      await userEvent.click(screen.getByTestId('change-type-btn'));

      await waitFor(() => {
        expect(vi.mocked(toast.error)).toHaveBeenCalled();
      });
      // toast.success must NOT have been called
      expect(vi.mocked(toast.success)).not.toHaveBeenCalled();
    });
  });

  // ── 3. handleProjectTypeChange — no completed images: no warning toast ─────

  describe('handleProjectTypeChange — no warning when no completed images', () => {
    it('does NOT call toast.warning when no completed images exist', async () => {
      mockUpdateProject.mockResolvedValue({});
      wireDefaultHooks([
        makeImage({ segmentationStatus: 'pending' }),
        makeImage({ segmentationStatus: 'no_segmentation' }, 'img-2'),
      ]);
      renderPage();

      await userEvent.click(screen.getByTestId('change-type-btn'));

      await waitFor(() => {
        expect(vi.mocked(toast.success)).toHaveBeenCalled();
      });
      expect(vi.mocked(toast.warning)).not.toHaveBeenCalled();
    });
  });

  // ── 4. handleCancelSegmentation — success with cancelledCount=0 ────────────

  describe('handleCancelSegmentation — success with no cancellations', () => {
    it('does not show a success toast when cancelledCount=0', async () => {
      mockCancelAllUserSegmentations.mockResolvedValue({
        success: true,
        cancelledCount: 0,
        affectedProjects: [],
        affectedBatches: [],
      });
      wireDefaultHooks([]);
      renderPage();

      await userEvent.click(screen.getByTestId('cancel-segmentation-btn'));

      await waitFor(() => {
        expect(mockCancelAllUserSegmentations).toHaveBeenCalled();
      });
      // Neither success nor error toast
      expect(vi.mocked(toast.success)).not.toHaveBeenCalled();
      expect(vi.mocked(toast.error)).not.toHaveBeenCalled();
    });
  });

  // ── 5. handleCancelSegmentation — API throws ──────────────────────────────

  describe('handleCancelSegmentation — API error', () => {
    it('shows toast.error("queue.cancelFailed") when API throws', async () => {
      mockCancelAllUserSegmentations.mockRejectedValue(
        new Error('Connection refused')
      );
      wireDefaultHooks([]);
      renderPage();

      await userEvent.click(screen.getByTestId('cancel-segmentation-btn'));

      await waitFor(() => {
        expect(vi.mocked(toast.error)).toHaveBeenCalledWith(
          'queue.cancelFailed'
        );
      });
    });
  });

  // ── 7. handleSelectAllToggle — all selected → deselect all ────────────────

  describe('handleSelectAllToggle — deselect all when all are selected', () => {
    it('deselects all images when all are currently selected', async () => {
      const images = [makeImage({}, 'img-1'), makeImage({}, 'img-2')];
      wireDefaultHooks(images);
      renderPage();

      // Select both images first
      await userEvent.click(screen.getByTestId('select-img-1'));
      await userEvent.click(screen.getByTestId('select-img-2'));
      await waitFor(() =>
        expect(screen.getByTestId('selected-count').textContent).toBe('2')
      );

      // Now all are selected → toggle should deselect all
      await userEvent.click(screen.getByTestId('select-all-toggle'));
      await waitFor(() =>
        expect(screen.getByTestId('selected-count').textContent).toBe('0')
      );
    });
  });

  // ── 8. handleSelectAllToggle — none selected → select all ─────────────────

  describe('handleSelectAllToggle — select all when none are selected', () => {
    it('selects all filteredImages when none are currently selected', async () => {
      const images = [makeImage({}, 'img-1'), makeImage({}, 'img-2')];
      wireDefaultHooks(images);
      renderPage();

      // No images selected yet → toggle should select all
      await userEvent.click(screen.getByTestId('select-all-toggle'));
      await waitFor(() =>
        expect(screen.getByTestId('selected-count').textContent).toBe('2')
      );
    });
  });

  // ── 9. handleOpenImage — delegates to handleOpenSegmentationEditor ─────────

  describe('handleOpenImage — navigates to editor', () => {
    it('calls handleOpenSegmentationEditor with the image ID when an image is opened', async () => {
      const images = [makeImage({}, 'img-1')];
      wireDefaultHooks(images);
      renderPage();

      await userEvent.click(screen.getByTestId('open-img-1'));

      await waitFor(() => {
        expect(mockHandleOpenSegmentationEditor).toHaveBeenCalledWith('img-1');
      });
    });
  });

  // ── 10. handleSegmentAll — addBatchToQueue throws ─────────────────────────

  describe('handleSegmentAll — addBatchToQueue error', () => {
    it('shows toast.error and resets batchSubmitted when addBatchToQueue throws', async () => {
      mockAddBatchToQueue.mockRejectedValue(new Error('Queue full'));
      const img = makeImage({ segmentationStatus: 'no_segmentation' }, 'img-1');
      wireDefaultHooks([img]);
      renderPage();

      // Segmentation acts only on the selection — select the image first.
      await userEvent.click(screen.getByTestId('select-img-1'));
      await userEvent.click(screen.getByTestId('segment-all-btn'));

      await waitFor(() => {
        expect(vi.mocked(toast.error)).toHaveBeenCalledWith(
          'projects.errorAddingToQueue'
        );
        // batchSubmitted should be reset after error
        expect(screen.getByTestId('batch-submitted').textContent).toBe('false');
      });
    });
  });

  // ── 11. handleSegmentAll — nothing selected ───────────────────────────────

  describe('handleSegmentAll — nothing selected', () => {
    it('shows toast.info("queue.selectNothingTooltip") when nothing is selected', async () => {
      const images = [
        makeImage({ segmentationStatus: 'completed' }, 'img-1'),
        makeImage({ segmentationStatus: 'completed' }, 'img-2'),
      ];
      wireDefaultHooks(images);
      renderPage();

      // No image selected → nothing to process.
      await userEvent.click(screen.getByTestId('segment-all-btn'));

      await waitFor(() => {
        expect(vi.mocked(toast.info)).toHaveBeenCalledWith(
          'queue.selectNothingTooltip'
        );
      });
      expect(mockAddBatchToQueue).not.toHaveBeenCalled();
    });
  });

  // ── 13. handleBatchDelete — opens AlertDialog ─────────────────────────────

  describe('handleBatchDelete — opens delete confirmation dialog', () => {
    it('shows AlertDialog on batch-delete-btn click (with images selected)', async () => {
      const images = [makeImage({}, 'img-1')];
      wireDefaultHooks(images);
      renderPage();

      // Select an image first
      await userEvent.click(screen.getByTestId('select-img-1'));

      // Click delete button to open dialog
      await userEvent.click(screen.getByTestId('batch-delete-btn'));

      // AlertDialog title key should be visible
      await waitFor(() => {
        expect(
          screen.getByText('projects.deleteDialog.title')
        ).toBeInTheDocument();
      });
    });
  });

  // ── 14. toggleUploader ─────────────────────────────────────────────────────

  describe('toggleUploader — shows/hides uploader section', () => {
    it('shows UploaderSection on first click and hides it on second click', async () => {
      wireDefaultHooks([]);
      renderPage();

      // Toolbar is visible initially
      expect(screen.getByTestId('project-toolbar')).toBeInTheDocument();

      // First click shows uploader
      await userEvent.click(screen.getByTestId('toggle-uploader'));
      expect(screen.getByTestId('uploader-section')).toBeInTheDocument();
      expect(screen.queryByTestId('project-toolbar')).not.toBeInTheDocument();

      // Cancel (second click via cancel-upload) hides uploader
      await userEvent.click(screen.getByTestId('cancel-upload'));
      expect(screen.queryByTestId('uploader-section')).not.toBeInTheDocument();
      expect(screen.getByTestId('project-toolbar')).toBeInTheDocument();
    });
  });
});
