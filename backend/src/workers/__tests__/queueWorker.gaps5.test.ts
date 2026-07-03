/**
 * queueWorker.gaps5.test.ts
 *
 * Covers branches still uncovered after queueWorker.parallel.test.ts:
 *
 *  A. start() — already running guard (lines 57-59)
 *     - calling start() twice → warns "already running", no double-start
 *
 *  B. stop() — not running guard (lines 93-95)
 *     - calling stop() when not started → warns "not running"
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../utils/config', () => ({
  config: {
    NODE_ENV: 'test',
    SEGMENTATION_SERVICE_URL: 'http://localhost:8000',
    JWT_ACCESS_SECRET: 'test-secret-at-least-32-chars!!',
    JWT_REFRESH_SECRET: 'test-refresh-secret-at-least-32-chars!',
    ALLOWED_ORIGINS: 'http://localhost:3000',
    FROM_EMAIL: 'test@test.com',
    EMAIL_SERVICE: 'none',
  },
}));

vi.mock('../../utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// NOTE: queueService is mocked with an explicit factory further down (its
// getInstance() must return a stub exposing setQueueWorker, which the
// QueueWorker constructor calls). A *second* bare `vi.mock('...queueService')`
// used to sit here — two registrations for the same module race, and when the
// bare auto-mock won, getInstance() returned undefined and the constructor
// crashed on `queueService.setQueueWorker` (flaky in CI). Keep only the factory.
vi.mock('../../services/segmentationService');
vi.mock('../../services/imageService');
vi.mock('@prisma/client', () => {
  const mockPrismaClient = {
    $connect: vi.fn(),
    $disconnect: vi.fn(),
    $transaction: vi.fn(),
    segmentationQueue: {
      findMany: vi.fn(),
      count: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      delete: vi.fn(),
      deleteMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      createMany: vi.fn(),
    },
    image: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      count: vi.fn(),
      deleteMany: vi.fn(),
      create: vi.fn(),
    },
    user: { findUnique: vi.fn() },
    project: { findUnique: vi.fn() },
    segmentation: { deleteMany: vi.fn() },
  };
  return {
    PrismaClient: vi.fn().mockImplementation(function (
      this: Record<string, unknown>
    ) {
      Object.assign(this, mockPrismaClient);
    }),
    Prisma: { PrismaClientKnownRequestError: class extends Error {} },
  };
});

// Mock QueueService.getInstance with a working mock
const mockGetMultipleBatches = vi.fn().mockResolvedValue([]);
const mockSetQueueWorker = vi.fn();
const mockResetStuckItems = vi.fn().mockResolvedValue(0);
const mockCheckServiceHealth = vi.fn().mockResolvedValue(true);

vi.mock('../../services/queueService', () => ({
  QueueService: {
    getInstance: vi.fn(() => ({
      getMultipleBatches: mockGetMultipleBatches,
      processMultipleBatches: vi.fn().mockResolvedValue(undefined),
      getQueueStats: vi.fn().mockResolvedValue({ queued: 0, processing: 0 }),
      resetStuckItems: mockResetStuckItems,
      checkServiceHealth: mockCheckServiceHealth,
      setQueueWorker: mockSetQueueWorker,
    })),
  },
}));

import { QueueWorker } from '../queueWorker';
import { logger } from '../../utils/logger';

const mockLogger = logger as unknown as {
  warn: ReturnType<typeof vi.fn>;
  info: ReturnType<typeof vi.fn>;
};

let queueWorker: QueueWorker;

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  mockGetMultipleBatches.mockResolvedValue([]);
  mockResetStuckItems.mockResolvedValue(0);
  mockCheckServiceHealth.mockResolvedValue(true);
});

afterEach(() => {
  vi.useRealTimers();
});

// ─── A. start() — already running guard ──────────────────────────────────────

describe('QueueWorker.start — already running', () => {
  it('warns when called while already running', () => {
    queueWorker = new QueueWorker(undefined as never, 1000);
    queueWorker.start();
    queueWorker.start(); // second call should warn

    expect(mockLogger.warn).toHaveBeenCalledWith(
      'Queue worker is already running',
      'QueueWorker'
    );
    queueWorker.stop();
  });
});

// ─── B. stop() — not running guard ────────────────────────────────────────────

describe('QueueWorker.stop — not running', () => {
  it('warns when called while not running', () => {
    queueWorker = new QueueWorker(undefined as never, 1000);
    // Never started - stopping immediately
    queueWorker.stop();

    expect(mockLogger.warn).toHaveBeenCalledWith(
      'Queue worker is not running',
      'QueueWorker'
    );
  });
});
