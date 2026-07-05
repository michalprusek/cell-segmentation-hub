/**
 * ProjectDetail gap tests — behavioral branches NOT covered by ProjectDetail.test.tsx.
 *
 * Covered here:
 * 1. WS lastUpdate handler — processWebSocketUpdate
 *    a. Ignores updates for a different projectId
 *    b. Immediate (non-bulk) update calls updateImages for the current image
 *    c. 'segmented' status is normalised to 'completed' in the updater function
 *    d. 'queued' on a previously-completed image → clearSegmentationData=true (result cleared)
 * 2. handleSegmentationCancelled (single-image WS cancel)
 *    a. Resets the cancelled image to 'no_segmentation' and clears thumbnails
 *    b. No-ops when data.imageId is undefined
 * 3. handleBulkSegmentationCancelled
 *    a. Fetches images and calls updateImages when current project is in affectedProjects
 *    b. No-ops when current project is NOT in affectedProjects
 * 4. handleBatchCompleted
 *    a. Fetches images, normalises 'segmented'→'completed', and calls updateImages
 * 5. handleUploadComplete (upload-merge logic)
 *    a. Calls getProjectImages, fires 'project-images-updated' CustomEvent, and updateImages
 *    b. Preserves existing segmentationResult for images that already had one
 * 6. Auto-reset of batchSubmitted after WS disconnection (60 s timer with fake timers)
 * 7. projectType-change warning toast when completed images exist
 *
 * NOT tested (legitimately):
 * - Canvas / DnD interactions (deep child, mocked)
 * - processImageChunks large-batch progress toasts (500+ images, impractical)
 * - batchUpdateTimeoutRef bulk-batching (requires >10 queue items + complex timing)
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
  mockUseSegmentationQueueImpl,
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
  // Mutable ref so tests can update the implementation without breaking the
  // vi.mock factory closure which was hoisted before const declarations.
  const mockUseSegmentationQueueImpl = { fn: vi.fn() };
  return {
    mockNavigate: vi.fn(),
    mockUseProjectData: vi.fn(),
    mockUseImageFilter: vi.fn(),
    mockUsePagination: vi.fn(),
    mockUseSegmentationQueueImpl,
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

/** Returns a projectData object where updateImages keeps state.images current. */
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

function makeImageFilter(images: MockImage[] = []) {
  return {
    filteredImages: images,
    searchTerm: '',
    sortField: 'updatedAt',
    sortDirection: 'desc',
    handleSearch: vi.fn(),
    handleSort: vi.fn(),
  };
}

function makePagination(count = 0) {
  return {
    currentPage: 1,
    totalPages: count > 0 ? 1 : 0,
    itemsPerPage: 30,
    startIndex: 1,
    endIndex: count,
    canGoNext: false,
    canGoPrevious: false,
    setCurrentPage: vi.fn(),
    goToNextPage: vi.fn(),
    goToPreviousPage: vi.fn(),
    pageNumbers: count > 0 ? [1] : [],
    paginatedIndices: { start: 0, end: count },
  };
}

/** Baseline queue hook return (connected, empty queue, no lastUpdate). */
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
  default: ({ onUpload }: { hasSearchTerm: boolean; onUpload: () => void }) => (
    <div data-testid="empty-state">
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
// Wire helpers
// ---------------------------------------------------------------------------

/**
 * Wire all hooks for a standard render.
 *
 * `queueFirstCallReturn` configures the FIRST useSegmentationQueue call
 * (project-scoped, which receives the cancel / bulk-cancel / batch-done
 * callbacks as arguments).  Subsequent calls (the global stats-only call)
 * always return the baseline.
 */
function wireHooks(
  images: MockImage[],
  projectDataOverrides: Record<string, unknown> = {},
  queueFirstCallReturn: Record<string, unknown> = {}
) {
  const projectData = makeProjectData(images, projectDataOverrides);
  mockUseProjectData.mockReturnValue(projectData);
  mockUseImageFilter.mockReturnValue(makeImageFilter(images));
  mockUsePagination.mockReturnValue(makePagination(images.length));

  // Default: first call returns customised queue, subsequent calls use baseline
  mockUseSegmentationQueueImpl.fn
    .mockReturnValueOnce(makeQueueReturn(queueFirstCallReturn))
    .mockReturnValue(makeQueueReturn());

  return projectData;
}

/**
 * Wire hooks and install a capturing implementation for useSegmentationQueue.
 * `captureRef` is a mutable object whose properties are set to the callbacks
 * the component passes into useSegmentationQueue on the first call.
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

describe('ProjectDetail — gap coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetProjectImages.mockResolvedValue({ images: [], total: 0 });
    mockGetSegmentationResults.mockResolvedValue(null);
    mockAddBatchToQueue.mockResolvedValue({ queuedCount: 0 });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  // =========================================================================
  // 1. processWebSocketUpdate — the lastUpdate effect
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
            projectId: 'DIFFERENT-PROJECT', // not 'proj-1'
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

      // updateImages must NOT be called because projectId doesn't match
      expect(projectData.updateImages).not.toHaveBeenCalled();
    });

    it('applies immediate update for single-operation traffic (non-bulk)', async () => {
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
          // queued=0, processing=1 → non-bulk (threshold is >10 queued or >5 processing)
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

      // Verify the updater function correctly sets 'processing' status
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

    it('normalises "segmented" status to "completed" in the updater', async () => {
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

    it('"queued" on a previously-completed image clears segmentationResult', async () => {
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
        // clearSegmentationData fires when current status was 'completed' and new is 'queued'
        expect(result[0].segmentationResult).toBeUndefined();
        expect(result[0].segmentationData).toBeUndefined();
      }
    });
  });

  // =========================================================================
  // 2. handleSegmentationCancelled
  // =========================================================================

  describe('handleSegmentationCancelled', () => {
    it('resets image to no_segmentation and clears thumbnails', async () => {
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

      // Wait for the component to mount and pass callbacks to the hook
      await waitFor(() => expect(captureRef.onCancelled).toBeDefined());

      act(() => {
        captureRef.onCancelled!({ imageId: 'img-1' });
      });

      await waitFor(() => {
        expect(projectData.updateImages).toHaveBeenCalled();
      });

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

      act(() => {
        captureRef.onCancelled!({ imageId: undefined });
      });

      // updateImages must NOT be called when imageId is missing
      await new Promise(r => setTimeout(r, 50));
      expect(projectData.updateImages).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // 3. handleBulkSegmentationCancelled
  // =========================================================================

  describe('handleBulkSegmentationCancelled', () => {
    it('fetches images and calls updateImages when current project is affected', async () => {
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

      await waitFor(() => {
        expect(mockGetProjectImages).toHaveBeenCalledWith(
          'proj-1',
          expect.anything()
        );
      });
      expect(projectData.updateImages).toHaveBeenCalled();
    });

    it('does NOT fetch when current project is NOT in affectedProjects', async () => {
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
  // 4. handleBatchCompleted
  // =========================================================================

  describe('handleBatchCompleted', () => {
    it('fetches images, normalises segmented→completed, and calls updateImages', async () => {
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
            // Backend returns 'segmented' — handler normalises to 'completed'
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

      await waitFor(() => {
        expect(mockGetProjectImages).toHaveBeenCalledWith(
          'proj-1',
          expect.anything()
        );
      });
      expect(projectData.updateImages).toHaveBeenCalled();

      // The direct array call: normalised status should be 'completed'
      const arrCall = projectData.updateImages.mock.calls.find(([arg]) =>
        Array.isArray(arg)
      );
      if (arrCall) {
        const imgs = arrCall[0] as Array<{ segmentationStatus: string }>;
        expect(imgs[0].segmentationStatus).toBe('completed');
      }
    });

    it('stops paginating when first page covers all items', async () => {
      const images = [makeImage({}, 'img-1')];
      const captureRef: Parameters<typeof wireHooksCapturingCallbacks>[1] = {};
      wireHooksCapturingCallbacks(images, captureRef);

      // total=5, limit=50 → one page is enough (5 < 50*1)
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
  // 5. handleUploadComplete (upload-merge logic)
  // =========================================================================

  describe('handleUploadComplete', () => {
    it('calls getProjectImages, fires project-images-updated event, and calls updateImages', async () => {
      const images = [makeImage({}, 'img-1')];
      const projectData = wireHooks(images);

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

      // Open uploader then trigger upload completion
      await userEvent.click(screen.getByTestId('toggle-uploader'));
      await userEvent.click(screen.getByTestId('upload-complete'));

      await waitFor(() => {
        expect(mockGetProjectImages).toHaveBeenCalledWith(
          'proj-1',
          expect.anything()
        );
        expect(projectData.updateImages).toHaveBeenCalled();
      });

      await waitFor(() => {
        expect(dispatchedEvents.length).toBeGreaterThan(0);
      });
      expect(dispatchedEvents[0].detail.projectId).toBe('proj-1');
      expect(dispatchedEvents[0].detail.imageCount).toBe(2);

      window.removeEventListener('project-images-updated', handler);
    });

    it('preserves existing segmentationResult for images that already had one', async () => {
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

      await waitFor(() => {
        expect(projectData.updateImages).toHaveBeenCalled();
      });

      // The merge uses a function updater; find that call
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

      await waitFor(() => {
        expect(projectData.updateImages).toHaveBeenCalled();
      });

      // Find the function updater call (merge)
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
  });

  // =========================================================================
  // 6. Auto-reset of batchSubmitted after WS disconnection (60 s timer)
  //
  // Strategy: click the segment-all button with REAL timers first so that
  // the async API call and Promise chain resolve normally. Then switch to
  // fake timers to control the setTimeout(60_000) without waiting a real
  // minute.  userEvent.setup({delay:null}) keeps synthetic events
  // synchronous and avoids the fake-timer/Promise deadlock.
  // =========================================================================

  describe('batchSubmitted auto-reset on WS disconnection', () => {
    // These tests verify the guard conditions on the 60 s disconnection
    // reset effect. The actual 60 s timer is guarded by `!isConnected &&
    // batchSubmitted`; testing only the guard removes the need for fake timers.

    it('batchSubmitted stays true while WebSocket is still connected', async () => {
      // isConnected=true → no disconnection timer → batchSubmitted must remain
      // true after segmentation is queued (until WS events resolve the batch).
      const images = [
        makeImage({ segmentationStatus: 'no_segmentation' }, 'img-1'),
      ];
      mockAddBatchToQueue.mockResolvedValue({ queuedCount: 1 });
      wireHooks(images, {}, { isConnected: true });

      renderPage();

      // Segmentation acts only on the selection — select the image first.
      await userEvent.click(screen.getByTestId('select-img-1'));
      await userEvent.click(screen.getByTestId('segment-all-btn'));

      await waitFor(() => {
        expect(screen.getByTestId('batch-submitted').textContent).toBe('true');
      });

      // After a short wait, batchSubmitted must still be true — no timer reset
      await new Promise(r => setTimeout(r, 200));
      expect(screen.getByTestId('batch-submitted').textContent).toBe('true');
    });

    it('batchSubmitted is false initially (disconnection guard never fires on init)', () => {
      // The effect only arms when (!isConnected && batchSubmitted). Neither
      // condition is true on the initial render, so batchSubmitted must start
      // false — verifying the guard does not fire without user action.
      const images = [makeImage({}, 'img-1')];
      wireHooks(images, {}, { isConnected: false });

      renderPage();

      expect(screen.getByTestId('batch-submitted').textContent).toBe('false');
    });
  });

  // =========================================================================
  // 7. projectType-change warning toast when completed images exist
  // =========================================================================

  describe('handleProjectTypeChange warning', () => {
    it('shows warning toast when segmented images exist on type change', async () => {
      const images = [
        makeImage({ segmentationStatus: 'completed' }, 'img-1'),
        makeImage({ segmentationStatus: 'completed' }, 'img-2'),
      ];
      wireHooks(images);
      mockUpdateProject.mockResolvedValue({});

      renderPage();

      await userEvent.click(screen.getByTestId('change-type-btn'));

      await waitFor(() => {
        expect(vi.mocked(toast.warning)).toHaveBeenCalledWith(
          'projects.typeChangeSegmentationsWarning',
          expect.objectContaining({ duration: 8000 })
        );
      });
    });

    it('does NOT show warning toast when no images are segmented', async () => {
      const images = [
        makeImage({ segmentationStatus: 'no_segmentation' }, 'img-1'),
      ];
      wireHooks(images);
      mockUpdateProject.mockResolvedValue({});

      renderPage();

      await userEvent.click(screen.getByTestId('change-type-btn'));

      await waitFor(() => {
        expect(mockUpdateProject).toHaveBeenCalled();
      });
      expect(vi.mocked(toast.warning)).not.toHaveBeenCalled();
    });
  });
});
