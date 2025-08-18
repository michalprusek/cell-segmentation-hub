// Jest types are provided by @types/jest package
/// <reference types="jest" />

// Mock Prisma client  
// export const prismaMock = mockDeep<PrismaClient>() as unknown as DeepMockProxy<PrismaClient>
export const prismaMock = {} as Record<string, jest.Mock>

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
jest.mock('../db')

// Mock Redis client
jest.mock('../redis/client')

// Mock Bull queue
jest.mock('bull')

// Mock file system operations
jest.mock('fs/promises')

// Mock sharp for image processing
jest.mock('sharp')

// Mock nodemailer
jest.mock('nodemailer')

// Mock axios for external API calls
jest.mock('axios')

// Setup and teardown
// beforeEach and afterEach are available globally in jest environment

beforeEach(() => {
  // mockReset(prismaMock)
  jest.clearAllMocks()
})

afterEach(() => {
  jest.clearAllMocks()
})

// Set test environment variables
process.env.NODE_ENV = 'test'
process.env.JWT_SECRET = 'test-jwt-secret'
process.env.JWT_REFRESH_SECRET = 'test-jwt-refresh-secret'
process.env.DATABASE_URL = 'file:./test.db'
process.env.REDIS_URL = 'redis://localhost:6379'
process.env.ML_SERVICE_URL = 'http://localhost:8000'

// Suppress console logs during tests
global.console = {
  ...console,
  log: jest.fn() as any,
  warn: jest.fn() as any,
  error: jest.fn() as any,
}