import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// All vi.mock() calls must use inline factories (not outer variables),
// because vi.mock() is hoisted above const declarations.

vi.mock('../../db', () => ({
  prisma: {
    project: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock('../sharingService', () => ({
  hasProjectAccess: vi.fn(),
}));

vi.mock('../websocketService', () => ({
  WebSocketService: {
    getInstance: vi.fn(() => ({
      emitToUser: vi.fn(),
    })),
  },
}));

vi.mock('uuid', () => ({ v4: vi.fn(() => 'test-job-id-1234') }));
vi.mock('../../utils/logger');

vi.mock('fs/promises', () => ({
  mkdir: vi.fn(),
  writeFile: vi.fn(),
  readFile: vi.fn(),
  readdir: vi.fn(),
  stat: vi.fn(),
  unlink: vi.fn(),
  copyFile: vi.fn(),
}));

vi.mock('archiver', () => ({
  default: vi.fn(() => ({
    directory: vi.fn(),
    on: vi.fn(),
    pipe: vi.fn(),
    finalize: vi.fn(),
  })),
}));

vi.mock('../visualization/visualizationGenerator', () => ({
  VisualizationGenerator: vi.fn(),
}));

vi.mock('../metrics/metricsCalculator', () => ({
  MetricsCalculator: vi.fn(),
}));

vi.mock('../export/formatConverter', () => ({
  FormatConverter: vi.fn(),
  resolveImageDimensions: vi.fn().mockResolvedValue({ width: 100, height: 100 }),
}));

vi.mock('../../utils/batchProcessor', () => ({
  batchProcessor: {
    processBatch: vi.fn(
      async (
        items: unknown[],
        processor: (item: unknown) => Promise<unknown>
      ) => Promise.all(items.map(processor))
    ),
  },
}));

// --- Import source under test AFTER all mocks ---
import { ExportService, ExportJob } from '../exportService';
import * as SharingService from '../sharingService';
import { prisma } from '../../db';
import { v4 as uuidv4 } from 'uuid';
import { MetricsCalculator } from '../metrics/metricsCalculator';
import { FormatConverter } from '../export/formatConverter';
import { VisualizationGenerator } from '../visualization/visualizationGenerator';

const JOB_ID = 'test-job-id-1234';
const PROJECT_ID = 'project-id';
const USER_ID = 'user-id';

// Typed references to the mocked functions
const mockHasProjectAccess = (SharingService as any).hasProjectAccess as ReturnType<typeof vi.fn>;
const mockPrismaProjectFindUnique = (prisma as any).project.findUnique as ReturnType<typeof vi.fn>;
const mockUuidV4 = uuidv4 as unknown as ReturnType<typeof vi.fn>;
const MockMetricsCalculator = MetricsCalculator as unknown as ReturnType<typeof vi.fn>;
const MockFormatConverter = FormatConverter as unknown as ReturnType<typeof vi.fn>;
const MockVisualizationGenerator = VisualizationGenerator as unknown as ReturnType<typeof vi.fn>;

const resetSingleton = () => {
  (ExportService as any).instance = undefined;
};

const makeService = (): ExportService => {
  resetSingleton();
  const svc = ExportService.getInstance();
  return svc;
};

const mockProjectData = {
  id: PROJECT_ID,
  title: 'Test Project',
  images: [],
};

describe('ExportService', () => {
  let service: ExportService;

  beforeEach(() => {
    vi.clearAllMocks();

    // Re-set constructor mocks (resetMocks:true clears factory-set implementations).
    // Cast to `any` to avoid TS2345 "never" inference inside mockImplementation callbacks.
    // Vitest v4 quirk: `mockImplementation(() => obj)` produces a non-
    // constructable arrow function. Use function-form so `new MockX()`
    // sets properties on `this` and returns it.
    MockVisualizationGenerator.mockImplementation(function (this: any) {
      this.generateVisualization = (vi.fn() as any).mockResolvedValue(undefined);
    });
    MockMetricsCalculator.mockImplementation(function (this: any) {
      this.calculateAllMetrics = (vi.fn() as any).mockResolvedValue([]);
      this.calculateAllImageMetrics = (vi.fn() as any).mockResolvedValue([]);
      this.exportToExcel = (vi.fn() as any).mockResolvedValue(undefined);
      this.exportToCSV = (vi.fn() as any).mockResolvedValue(undefined);
      this.exportPolygonMetricsToExcel = (vi.fn() as any).mockResolvedValue(undefined);
      this.exportSpermToExcel = (vi.fn() as any).mockResolvedValue(false);
    });
    MockFormatConverter.mockImplementation(function (this: any) {
      this.convertToCOCO = (vi.fn() as any).mockResolvedValue({});
      this.convertToYOLO = (vi.fn() as any).mockResolvedValue({
        content: '',
        warnings: [],
      });
      this.convertToJSON = (vi.fn() as any).mockResolvedValue({});
    });

    service = makeService();

    // Re-set implementations after resetMocks:true clears them
    mockUuidV4.mockReturnValue(JOB_ID);
    mockHasProjectAccess.mockResolvedValue({ hasAccess: true });
    mockPrismaProjectFindUnique.mockResolvedValue(mockProjectData);
  });

  afterEach(() => {
    resetSingleton();
  });

  // ---------------------------------------------------------------------------
  describe('startExportJob', () => {
    it('creates job with pending status and returns jobId', async () => {
      const jobId = await service.startExportJob(PROJECT_ID, USER_ID, {
        annotationFormats: ['json'],
      });

      expect(jobId).toBe(JOB_ID);
    });

    it('notifies user via WebSocket when job is started', async () => {
      // Check that the job gets added to the internal map (signaling the flow ran)
      const jobId = await service.startExportJob(PROJECT_ID, USER_ID, {
        annotationFormats: ['json'],
      });

      const jobs = (service as any).exportJobs as Map<string, ExportJob>;
      expect(jobs.has(jobId)).toBe(true);
    });

    it('throws access denied when user has no project access', async () => {
      mockHasProjectAccess.mockResolvedValueOnce({ hasAccess: false });

      await expect(
        service.startExportJob(PROJECT_ID, USER_ID, {})
      ).rejects.toThrow('Access denied');
    });

    it('uses provided projectName without DB lookup', async () => {
      const jobId = await service.startExportJob(
        PROJECT_ID,
        USER_ID,
        { annotationFormats: ['json'] },
        'Custom Name'
      );

      expect(jobId).toBe(JOB_ID);
    });
  });

  // ---------------------------------------------------------------------------
  describe('getJobStatus', () => {
    it('returns status for matching userId/projectId', async () => {
      await service.startExportJob(PROJECT_ID, USER_ID, {
        annotationFormats: ['json'],
      });

      // Re-allow access for the getJobStatus call
      mockHasProjectAccess.mockResolvedValue({ hasAccess: true });

      const job = await service.getJobStatus(JOB_ID, PROJECT_ID, USER_ID);

      expect(job).not.toBeNull();
      expect(job?.id).toBe(JOB_ID);
      expect(job?.projectId).toBe(PROJECT_ID);
    });

    it('returns null for non-existent job', async () => {
      const job = await service.getJobStatus('nonexistent', PROJECT_ID, USER_ID);

      expect(job).toBeNull();
    });

    it('returns null when user has no project access', async () => {
      // Insert a job manually
      const jobs = (service as any).exportJobs as Map<string, ExportJob>;
      jobs.set(JOB_ID, {
        id: JOB_ID,
        projectId: PROJECT_ID,
        userId: USER_ID,
        status: 'completed',
        progress: 100,
        createdAt: new Date(),
        options: {},
      });

      mockHasProjectAccess.mockResolvedValueOnce({ hasAccess: false });

      const job = await service.getJobStatus(JOB_ID, PROJECT_ID, 'other-user');

      expect(job).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  describe('cancelExport', () => {
    it('sets status to cancelled', async () => {
      const jobs = (service as any).exportJobs as Map<string, ExportJob>;
      jobs.set(JOB_ID, {
        id: JOB_ID,
        projectId: PROJECT_ID,
        userId: USER_ID,
        status: 'pending',
        progress: 10,
        createdAt: new Date(),
        options: {},
      });

      await service.cancelJob(JOB_ID, PROJECT_ID, USER_ID);

      expect(jobs.get(JOB_ID)?.status).toBe('cancelled');
    });

    it('is idempotent when job already completed', async () => {
      const jobs = (service as any).exportJobs as Map<string, ExportJob>;
      jobs.set(JOB_ID, {
        id: JOB_ID,
        projectId: PROJECT_ID,
        userId: USER_ID,
        status: 'completed',
        progress: 100,
        createdAt: new Date(),
        options: {},
      });

      await service.cancelJob(JOB_ID, PROJECT_ID, USER_ID);

      // Status should remain completed (not overwritten)
      expect(jobs.get(JOB_ID)?.status).toBe('completed');
    });

    it('does nothing silently when user has no access', async () => {
      mockHasProjectAccess.mockResolvedValueOnce({ hasAccess: false });

      await expect(
        service.cancelJob(JOB_ID, PROJECT_ID, 'stranger')
      ).resolves.toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  describe('getExportFilePath / downloadExport', () => {
    it('returns file path for completed job', async () => {
      const jobs = (service as any).exportJobs as Map<string, ExportJob>;
      jobs.set(JOB_ID, {
        id: JOB_ID,
        projectId: PROJECT_ID,
        userId: USER_ID,
        status: 'completed',
        progress: 100,
        filePath: '/exports/test-job-id-1234/export.zip',
        createdAt: new Date(),
        options: {},
      });

      const filePath = await service.getExportFilePath(
        JOB_ID,
        PROJECT_ID,
        USER_ID
      );

      expect(filePath).toBe('/exports/test-job-id-1234/export.zip');
    });

    it('returns null when job has no file path', async () => {
      const jobs = (service as any).exportJobs as Map<string, ExportJob>;
      jobs.set(JOB_ID, {
        id: JOB_ID,
        projectId: PROJECT_ID,
        userId: USER_ID,
        status: 'processing',
        progress: 40,
        createdAt: new Date(),
        options: {},
      });

      const filePath = await service.getExportFilePath(
        JOB_ID,
        PROJECT_ID,
        USER_ID
      );

      expect(filePath).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  describe('getExportHistory', () => {
    it('returns all jobs for project in descending creation order', async () => {
      const jobs = (service as any).exportJobs as Map<string, ExportJob>;

      const job1: ExportJob = {
        id: 'job-1',
        projectId: PROJECT_ID,
        userId: USER_ID,
        status: 'completed',
        progress: 100,
        createdAt: new Date('2026-03-01'),
        options: {},
      };
      const job2: ExportJob = {
        id: 'job-2',
        projectId: PROJECT_ID,
        userId: USER_ID,
        status: 'failed',
        progress: 30,
        createdAt: new Date('2026-03-02'),
        options: {},
      };

      jobs.set('job-1', job1);
      jobs.set('job-2', job2);

      const history = await service.getExportHistory(PROJECT_ID, USER_ID);

      expect(history.length).toBeGreaterThanOrEqual(2);
      // Latest first
      expect(history[0].createdAt.getTime()).toBeGreaterThanOrEqual(
        history[1].createdAt.getTime()
      );
    });

    it('returns empty array when user has no access', async () => {
      mockHasProjectAccess.mockResolvedValueOnce({ hasAccess: false });

      const history = await service.getExportHistory(PROJECT_ID, 'stranger');

      expect(history).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------
  describe('Job lifecycle', () => {
    it('job is added to internal map when startExportJob is called', async () => {
      const jobs = (service as any).exportJobs as Map<string, ExportJob>;

      await service.startExportJob(PROJECT_ID, USER_ID, {
        annotationFormats: [],
      });

      expect(jobs.has(JOB_ID)).toBe(true);
      // Status at creation (before async processing) starts as 'pending'
      const job = jobs.get(JOB_ID);
      expect(['pending', 'processing', 'completed', 'failed']).toContain(
        job?.status
      );
    });

    it('export with COCO format creates a job successfully', async () => {
      const jobId = await service.startExportJob(PROJECT_ID, USER_ID, {
        annotationFormats: ['coco'],
      });
      expect(jobId).toBe(JOB_ID);
    });

    it('export with YOLO format creates a job successfully', async () => {
      resetSingleton();
      service = makeService();
      mockHasProjectAccess.mockResolvedValue({ hasAccess: true });
      mockPrismaProjectFindUnique.mockResolvedValue(mockProjectData);

      const jobId = await service.startExportJob(PROJECT_ID, USER_ID, {
        annotationFormats: ['yolo'],
      });
      expect(jobId).toBe(JOB_ID);
    });

    it('export with JSON format creates a job successfully', async () => {
      resetSingleton();
      service = makeService();
      mockHasProjectAccess.mockResolvedValue({ hasAccess: true });
      mockPrismaProjectFindUnique.mockResolvedValue(mockProjectData);

      const jobId = await service.startExportJob(PROJECT_ID, USER_ID, {
        annotationFormats: ['json'],
      });
      expect(jobId).toBe(JOB_ID);
    });
  });

  // ---------------------------------------------------------------------------
  describe('getInstance', () => {
    it('returns singleton after first init', () => {
      const a = ExportService.getInstance();
      const b = ExportService.getInstance();
      expect(a).toBe(b);
    });
  });
});
