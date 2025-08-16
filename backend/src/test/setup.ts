import { PrismaClient } from '@prisma/client'
// import { mockDeep, mockReset, DeepMockProxy } from 'jest-mock-extended'

// Mock Prisma client  
// export const prismaMock = mockDeep<PrismaClient>() as unknown as DeepMockProxy<PrismaClient>
export const prismaMock = {} as any

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
jest.mock('jsonwebtoken', () => ({
  sign: jest.fn().mockReturnValue('mock-jwt-token'),
  verify: jest.fn().mockReturnValue({ id: 'user-id', email: 'test@example.com' }),
  decode: jest.fn().mockReturnValue({ id: 'user-id', email: 'test@example.com' }),
}))

// Mock bcryptjs
jest.mock('bcryptjs', () => ({
  hash: jest.fn().mockResolvedValue('hashed-password'),
  compare: jest.fn().mockResolvedValue(true),
  genSalt: jest.fn().mockResolvedValue('salt'),
}))

// Mock Prisma client
jest.mock('../lib/prisma', () => ({
  __esModule: true,
  default: prismaMock,
}))

// Mock Redis client
jest.mock('../lib/redis', () => ({
  __esModule: true,
  default: redisMock,
}))

// Mock Bull queue
jest.mock('../lib/queue', () => ({
  __esModule: true,
  segmentationQueue: queueMock,
}))

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
jest.mock('sharp', () => {
  const mockSharp = jest.fn(() => ({
    resize: jest.fn().mockReturnThis(),
    jpeg: jest.fn().mockReturnThis(),
    png: jest.fn().mockReturnThis(),
    toBuffer: jest.fn().mockResolvedValue(Buffer.from('mock-image')),
    toFile: jest.fn().mockResolvedValue(undefined),
    metadata: jest.fn().mockResolvedValue({
      width: 1000,
      height: 1000,
      format: 'jpeg'
    }),
  }))
  return mockSharp
})

// Mock nodemailer
jest.mock('nodemailer', () => ({
  createTransport: jest.fn().mockReturnValue({
    sendMail: jest.fn().mockResolvedValue({ messageId: 'mock-message-id' }),
  }),
}))

// Mock axios for external API calls
jest.mock('axios', () => ({
  create: jest.fn(() => ({
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
    delete: jest.fn(),
  })),
  get: jest.fn(),
  post: jest.fn(),
  put: jest.fn(),
  delete: jest.fn(),
}))

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
process.env.JWT_SECRET = 'test-jwt-secret'
process.env.JWT_REFRESH_SECRET = 'test-jwt-refresh-secret'
process.env.DATABASE_URL = 'file:./test.db'
process.env.REDIS_URL = 'redis://localhost:6379'
process.env.ML_SERVICE_URL = 'http://localhost:8000'

// Suppress console logs during tests
global.console = {
  ...console,
  log: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}