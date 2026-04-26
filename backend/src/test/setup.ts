import { vi, beforeEach, afterEach } from 'vitest';
// import { PrismaClient } from '@prisma/client'

// Create a comprehensive Prisma mock
const createPrismaMock = () => {
  const models = [
    'user',
    'project',
    'projectImage',
    'segmentationResult',
    'queueItem',
    'share',
    'passwordResetToken',
  ];
  const mock: Record<string, unknown> = {
    $connect: vi.fn(() => Promise.resolve()),
    $disconnect: vi.fn(() => Promise.resolve()),
    $executeRaw: vi.fn(),
    $queryRaw: vi.fn(),
    $transaction: vi.fn((cb: (mock: Record<string, unknown>) => unknown) =>
      cb(mock)
    ),
  };

  models.forEach(model => {
    mock[model] = {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      delete: vi.fn(),
      deleteMany: vi.fn(),
      count: vi.fn(),
      aggregate: vi.fn(),
      groupBy: vi.fn(),
      upsert: vi.fn(),
    };
  });

  return mock;
};

export const prismaMock = createPrismaMock();

// Mock Redis client
export const redisMock = {
  get: vi.fn(),
  set: vi.fn(),
  del: vi.fn(),
  exists: vi.fn(),
  expire: vi.fn(),
  flushall: vi.fn(),
  quit: vi.fn(),
  connect: vi.fn(),
  disconnect: vi.fn(),
};

// Mock Bull queue
export const queueMock = {
  add: vi.fn(),
  process: vi.fn(),
  on: vi.fn(),
  clean: vi.fn(),
  pause: vi.fn(),
  resume: vi.fn(),
  close: vi.fn(),
};

// Mock JWT
vi.mock('jsonwebtoken');

// Mock bcryptjs
vi.mock('bcryptjs');

// Mock Prisma client
vi.mock('../db', () => ({
  __esModule: true,
  prisma: createPrismaMock(),
  default: createPrismaMock(),
}));

// Mock Redis client
vi.mock('../redis/client', () => ({
  __esModule: true,
  default: redisMock,
}));

// Mock Bull queue
vi.mock('bull');

// Mock file system operations
vi.mock('fs/promises', () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  unlink: vi.fn(),
  mkdir: vi.fn(),
  access: vi.fn(),
  stat: vi.fn(),
}));

// Mock sharp for image processing
vi.mock('sharp');

// Mock nodemailer
vi.mock('nodemailer');

// Mock axios for external API calls
vi.mock('axios');

// Setup and teardown

beforeEach(() => {
  // mockReset(prismaMock)
  vi.clearAllMocks();
});

afterEach(() => {
  vi.clearAllMocks();
});

// Set test environment variables
process.env.NODE_ENV = 'test';
process.env.PORT = '3001';
process.env.HOST = 'localhost';
process.env.JWT_ACCESS_SECRET =
  'test-jwt-access-secret-that-is-at-least-32-characters-long';
process.env.JWT_REFRESH_SECRET =
  'test-jwt-refresh-secret-that-is-at-least-32-characters-long';
process.env.JWT_REFRESH_EXPIRY_REMEMBER = '30d';
process.env.DATABASE_URL = 'file:./test.db';
process.env.REDIS_URL = 'redis://localhost:6379';
process.env.ML_SERVICE_URL = 'http://localhost:8000';
process.env.SEGMENTATION_SERVICE_URL = 'http://localhost:8000';
process.env.FROM_EMAIL = 'test@example.com';
process.env.FROM_NAME = 'Test Platform';
process.env.UPLOAD_DIR = './uploads';
process.env.EMAIL_SERVICE = 'none';
process.env.SMTP_HOST = 'localhost';
process.env.SMTP_PORT = '587';
process.env.SMTP_USER = 'test';
process.env.SMTP_PASS = 'test';
process.env.SESSION_SECRET = 'test-session-secret-for-testing';
process.env.REQUIRE_EMAIL_VERIFICATION = 'false';
process.env.ALLOWED_ORIGINS = 'http://localhost:3000';
process.env.WS_ALLOWED_ORIGINS = 'http://localhost:3000';

// Suppress console logs during tests
global.console = {
  ...console,
  log: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};
