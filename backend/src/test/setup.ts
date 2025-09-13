import { jest, beforeEach, afterEach } from '@jest/globals'
// import { PrismaClient } from '@prisma/client'

// Create a comprehensive Prisma mock
const createPrismaMock = () => {
  const models = ['user', 'project', 'projectImage', 'segmentationResult', 'queueItem', 'share', 'passwordResetToken'];
  const mock: Record<string, unknown> = {
    $connect: jest.fn(() => Promise.resolve()),
    $disconnect: jest.fn(() => Promise.resolve()),
    $executeRaw: jest.fn(),
    $queryRaw: jest.fn(),
    $transaction: jest.fn((cb: (mock: Record<string, unknown>) => unknown) => cb(mock)),
  };
  
  models.forEach(model => {
    mock[model] = {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      delete: jest.fn(),
      deleteMany: jest.fn(),
      count: jest.fn(),
      aggregate: jest.fn(),
      groupBy: jest.fn(),
      upsert: jest.fn(),
    };
  });
  
  return mock;
};

export const prismaMock = createPrismaMock()

// Mock Redis client
export const redisMock = {
  get: jest.fn(),
  set: jest.fn(),
  del: jest.fn(),
  exists: jest.fn(),
  expire: jest.fn(),
  flushall: jest.fn(),
  quit: jest.fn(),
  connect: jest.fn(),
  disconnect: jest.fn(),
}

// Mock Bull queue
export const queueMock = {
  add: jest.fn(),
  process: jest.fn(),
  on: jest.fn(),
  clean: jest.fn(),
  pause: jest.fn(),
  resume: jest.fn(),
  close: jest.fn(),
}

// Mock JWT
jest.mock('jsonwebtoken')

// Mock bcryptjs
jest.mock('bcryptjs')

// Mock Prisma client
jest.mock('../db', () => ({
  __esModule: true,
  prisma: createPrismaMock(),
  default: createPrismaMock(),
}))

// Mock Redis client
jest.mock('../redis/client', () => ({
  __esModule: true,
  default: redisMock,
}))

// Mock Bull queue
jest.mock('bull')

// Mock file system operations
jest.mock('fs/promises', () => ({
  readFile: jest.fn(),
  writeFile: jest.fn(),
  unlink: jest.fn(),
  mkdir: jest.fn(),
  access: jest.fn(),
  stat: jest.fn(),
}))

// Mock sharp for image processing
jest.mock('sharp')

// Mock nodemailer
jest.mock('nodemailer')

// Mock axios for external API calls
jest.mock('axios')

// Setup and teardown

beforeEach(() => {
  // mockReset(prismaMock)
  jest.clearAllMocks()
})

afterEach(() => {
  jest.clearAllMocks()
})

// Set test environment variables
process.env.NODE_ENV = 'test'
process.env.PORT = '3001'
process.env.HOST = 'localhost'
process.env.JWT_ACCESS_SECRET = 'test-jwt-access-secret-that-is-at-least-32-characters-long'
process.env.JWT_REFRESH_SECRET = 'test-jwt-refresh-secret-that-is-at-least-32-characters-long'
process.env.JWT_REFRESH_EXPIRY_REMEMBER = '30d'
process.env.DATABASE_URL = 'file:./test.db'
process.env.REDIS_URL = 'redis://localhost:6379'
process.env.ML_SERVICE_URL = 'http://localhost:8000'
process.env.SEGMENTATION_SERVICE_URL = 'http://localhost:8000'
process.env.FROM_EMAIL = 'test@example.com'
process.env.FROM_NAME = 'Test Platform'
process.env.UPLOAD_DIR = './uploads'
process.env.EMAIL_SERVICE = 'none'
process.env.SMTP_HOST = 'localhost'
process.env.SMTP_PORT = '587'
process.env.SMTP_USER = 'test'
process.env.SMTP_PASS = 'test'
process.env.SESSION_SECRET = 'test-session-secret-for-testing'
process.env.REQUIRE_EMAIL_VERIFICATION = 'false'
process.env.ALLOWED_ORIGINS = 'http://localhost:3000'
process.env.WS_ALLOWED_ORIGINS = 'http://localhost:3000'

// Suppress console logs during tests
global.console = {
  ...console,
  log: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}